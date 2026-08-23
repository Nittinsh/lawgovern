// Supabase Edge Function — free MCA company master data via data.gov.in (OGD).
//
// WHY THIS EXISTS: api.data.gov.in sends no CORS headers, so the browser cannot
// call it directly (verified). This proxies the call and keeps the key server-side,
// exactly like the existing ai-proxy.
//
// SETUP
//   1. Get a FREE API key: https://data.gov.in -> register -> My Account -> API key.
//      The key printed in the data.gov.in docs is a shared sample: it is capped at
//      10 records and is usually rate-limited (HTTP 429). Use your own.
//   2. supabase secrets set OGD_API_KEY=xxxxxxxx
//      (optional) supabase secrets set OGD_RESOURCE_IDS=id1,id2   -- defaults below
//   3. supabase functions deploy mca-lookup
//
// RETURNS: name, status, class, category, date of registration, registered
// address, authorised capital, PAID-UP CAPITAL.
// DOES NOT RETURN: turnover, net worth, net profit — those are not in the OGD
// master dataset; they live in filed financial statements, which MCA charges for.
//
// DIAGNOSTICS: POST {"cin":"...","debug":true} to see the raw field names the
// dataset actually uses, which is useful if OGD renames columns.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// "Registrars of Companies (RoC)-wise Company Master Data" on data.gov.in.
const DEFAULT_RESOURCES = ['4dbe5667-7b6b-41d7-82af-211562424d9a'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const cinRaw = String(body?.cin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const debug = body?.debug === true;

    if (!/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(cinRaw)) {
      return json({ error: 'A valid 21-character CIN is required.' }, 400);
    }

    const key = Deno.env.get('OGD_API_KEY');
    if (!key) {
      return json({ error: 'Server not configured: set OGD_API_KEY.' }, 500);
    }

    // Diagnostic: {"cin":"<any valid CIN>","catalog":"director"} searches the
    // OGD catalogue rather than one resource. It answers from the source
    // whether a director or DIN dataset is published at all. The company master
    // data resource this function normally reads carries no director fields,
    // and every DIN API found elsewhere is a paid third party.
    if (typeof body?.catalog === 'string') {
      const term = (body.catalog || 'director').trim();
      const endpoints = [
        `https://api.data.gov.in/catalog?api-key=${encodeURIComponent(key)}` +
          `&format=json&filters[title]=${encodeURIComponent(term)}&limit=20`,
        `https://api.data.gov.in/lists?api-key=${encodeURIComponent(key)}` +
          `&format=json&filters[title]=${encodeURIComponent(term)}&limit=20`,
      ];
      const tried: unknown[] = [];
      for (const u of endpoints) {
        try {
          const rr = await fetch(u);
          const txt = await rr.text();
          let dd: any = null;
          try { dd = JSON.parse(txt); } catch { /* an HTML error page */ }
          const items = dd?.records ?? dd?.data ?? dd?.result ?? null;
          tried.push({
            endpoint: u.replace(/api-key=[^&]+/, 'api-key=***'),
            status: rr.status,
            count: Array.isArray(items) ? items.length : null,
            titles: Array.isArray(items)
              ? items.slice(0, 20).map((x: any) => x?.title ?? x?.name ?? null)
              : null,
            note: Array.isArray(items) ? null : txt.slice(0, 200),
          });
        } catch (e) {
          tried.push({
            endpoint: u.replace(/api-key=[^&]+/, 'api-key=***'),
            error: String(e),
          });
        }
      }
      return json({ searched: term, tried });
    }

    // Diagnostic: {"sample":true} returns the dataset's real column names and a
    // couple of rows, without filtering. Used to work out how CIN is stored.
    if (body?.sample === true) {
      const ids0 = (Deno.env.get('OGD_RESOURCE_IDS') || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      const id0 = (ids0.length ? ids0 : DEFAULT_RESOURCES)[0];
      const u = `https://api.data.gov.in/resource/${id0}` +
        `?api-key=${encodeURIComponent(key)}&format=json&limit=2`;
      const rr = await fetch(u);
      const dd = await rr.json().catch(() => null);
      return json({
        sample: true,
        resourceId: id0,
        httpStatus: rr.status,
        total: dd?.total ?? null,
        count: dd?.count ?? null,
        fieldMeta: dd?.field ?? null,
        columnNames: dd?.records?.[0] ? Object.keys(dd.records[0]) : null,
        firstRecord: dd?.records?.[0] ?? null,
        message: dd?.message ?? null,
      });
    }

    // Diagnostic: {"selftest":true} pulls one real record, then filters on that
    // record's own CIN. If the round trip fails, filtering itself is the problem
    // rather than the CIN we were given.
    if (body?.selftest === true) {
      const id0 = DEFAULT_RESOURCES[0];
      const base = `https://api.data.gov.in/resource/${id0}?api-key=${encodeURIComponent(key)}&format=json`;
      const one = await (await fetch(`${base}&limit=1&offset=5`)).json().catch(() => null);
      const seed = one?.records?.[0]?.CIN;
      if (!seed) return json({ selftest: true, error: 'could not read a seed record' });

      const attempts: Record<string, unknown> = {};
      const variants: [string, string][] = [
        ['filters[CIN]',        `${base}&limit=1&filters[CIN]=${encodeURIComponent(seed)}`],
        ['filters%5BCIN%5D',    `${base}&limit=1&filters%5BCIN%5D=${encodeURIComponent(seed)}`],
        ['q',                   `${base}&limit=1&q=${encodeURIComponent(seed)}`],
        ['search[CIN]',         `${base}&limit=1&search[CIN]=${encodeURIComponent(seed)}`],
      ];
      for (const [label, u] of variants) {
        try {
          const rr = await fetch(u);
          const dd = await rr.json().catch(() => null);
          attempts[label] = {
            http: rr.status,
            count: dd?.count ?? null,
            got: dd?.records?.[0]?.CIN ?? null,
            matched: dd?.records?.[0]?.CIN === seed,
          };
        } catch (e) { attempts[label] = { error: String(e) }; }
      }
      return json({ selftest: true, seedCin: seed, attempts });
    }
    const ids = (Deno.env.get('OGD_RESOURCE_IDS') || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const resources = ids.length ? ids : DEFAULT_RESOURCES;

    let sawRateLimit = false;
    const tried: string[] = [];

    for (const id of resources) {
      // The column name has varied across OGD revisions; try the usual spellings.
      for (const field of ['CIN', 'cin', 'corporate_identification_number']) {
        const url = `https://api.data.gov.in/resource/${id}` +
          `?api-key=${encodeURIComponent(key)}&format=json&limit=1` +
          `&filters[${encodeURIComponent(field)}]=${encodeURIComponent(cinRaw)}`;

        let r: Response;
        try {
          r = await fetch(url);
        } catch (_) {
          tried.push(`${id}/${field}: network error`);
          continue;
        }

        if (r.status === 429) { sawRateLimit = true; tried.push(`${id}/${field}: 429`); continue; }
        if (!r.ok) { tried.push(`${id}/${field}: HTTP ${r.status}`); continue; }

        const data = await r.json().catch(() => null);
        const rec = data?.records?.[0];
        if (!rec) { tried.push(`${id}/${field}: no match`); continue; }

        // Field names vary in case and punctuation; normalise before matching.
        const pick = (...names: string[]) => {
          for (const n of names) {
            const want = n.toLowerCase().replace(/[^a-z]/g, '');
            for (const k of Object.keys(rec)) {
              if (k.toLowerCase().replace(/[^a-z]/g, '') === want) {
                const v = rec[k];
                if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
              }
            }
          }
          return null;
        };

        return json({
          found: true,
          source: 'data.gov.in (MCA Company Master Data)',
          resourceId: id,
          cin: cinRaw,
          name:         pick('CompanyName', 'company_name'),
          status:       pick('CompanyStatus', 'company_status', 'CompanyStatusForEfiling'),
          companyClass: pick('CompanyClass', 'company_class'),
          category:     pick('CompanyCategory', 'company_category'),
          subCategory:  pick('CompanySubCategory', 'company_sub_category'),
          registeredOn: pick('DateOfRegistration', 'date_of_registration', 'CompanyRegistrationdate_date'),
          roc:          pick('RegistrarOfCompanies', 'registrar_of_companies'),
          activity:     pick('PrincipalBusinessActivity', 'principal_business_activity'),
          state:        pick('RegisteredState', 'registered_state', 'CompanyStateCode'),
          address:      pick('RegisteredOfficeAddress', 'registered_office_address'),
          // Already in RUPEES in the OGD dataset — matches our storage convention.
          authorizedCapital: numOrNull(pick('AuthorizedCapital', 'authorized_capital', 'AuthorisedCapital')),
          paidUpCapital:     numOrNull(pick('PaidupCapital', 'paidup_capital', 'PaidUpCapital')),
          // Stated explicitly so the caller never mistakes silence for zero.
          turnover: null, networth: null, netprofit: null,
          note: 'Turnover, net worth and net profit are not published in this dataset.',
          ...(debug ? { rawFields: Object.keys(rec), raw: rec } : {}),
        });
      }
    }

    if (sawRateLimit) {
      return json({
        error: 'rate_limited',
        message: 'data.gov.in refused the request (429). If you are using the sample key ' +
                 'from their documentation, register for your own free key — the sample one ' +
                 'is shared by everyone and is throttled.',
        tried,
      }, 429);
    }

    return json({ found: false, cin: cinRaw, error: 'CIN not found in the configured resources.', tried }, 404);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function numOrNull(v: string | null) {
  if (v === null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
