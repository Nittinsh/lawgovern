// Supabase Edge Function — director (DIN) data for a CIN, via a paid provider.
//
// WHY THIS IS SEPARATE FROM mca-lookup:
//   mca-lookup reads data.gov.in, which is free and carries COMPANY master data
//   only — name, status, class, category, registration date, address. It has no
//   director fields. Director data is public per company on mca.gov.in, but MCA
//   publishes no API for it and its terms prohibit bulk automated collection
//   from MCA21. Sites that show it at scale are licensed aggregators.
//
//   So this is a paid route by necessity. The key never leaves the server.
//
// SETUP:
//   supabase secrets set DIR_PROVIDER=<name>       e.g. zauba | surepass | attestr | custom
//   supabase secrets set DIR_API_URL=<endpoint>    the provider's director-by-CIN endpoint
//   supabase secrets set DIR_API_KEY=<key>
//   supabase secrets set DIR_AUTH_STYLE=<style>    bearer | header | query   (default: bearer)
//   supabase secrets set DIR_AUTH_HEADER=<name>    when DIR_AUTH_STYLE=header (e.g. x-api-key)
//   supabase functions deploy mca-directors
//
// The response shape differs between providers, so the mapper below reads a
// range of common field names and, when it cannot map a record, returns the raw
// payload rather than guessing. Send that payload back and the adapter becomes
// a few lines.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Designations as this app records them, so an import lands on the register's
// own vocabulary rather than the provider's.
function mapDesignation(raw: string): string {
  const s = String(raw || '').toLowerCase();
  if (s.includes('managing')) return 'managing_director';
  if (s.includes('whole') || s.includes('wholetime') || s.includes('whole-time')) return 'whole_time';
  if (s.includes('independent')) return 'independent';
  if (s.includes('nominee')) return 'nominee';
  if (s.includes('additional')) return 'additional';
  if (s.includes('alternate')) return 'alternate';
  if (s.includes('secretary')) return 'cs';
  if (s.includes('cfo') || s.includes('financial officer')) return 'cfo';
  if (s.includes('ceo') || s.includes('executive officer')) return 'ceo';
  if (s.includes('manager')) return 'manager';
  return 'director';
}

function pick(rec: Record<string, unknown>, ...names: string[]): string | null {
  for (const n of names) {
    for (const k of Object.keys(rec)) {
      if (k.toLowerCase().replace(/[^a-z]/g, '') === n.toLowerCase().replace(/[^a-z]/g, '')) {
        const v = rec[k];
        if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
      }
    }
  }
  return null;
}

function toIsoDate(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd/mm/yyyy or dd-mm-yyyy, which is how MCA renders dates
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function normalise(records: Record<string, unknown>[]) {
  return records.map((r) => {
    const din = pick(r, 'din', 'dinNumber', 'director_din', 'dinPan');
    const name = pick(r, 'name', 'directorName', 'director_name', 'fullName');
    const desig = pick(r, 'designation', 'director_designation', 'role', 'position');
    return {
      din: din ? din.replace(/\D/g, '').padStart(8, '0').slice(-8) : null,
      name,
      designation: mapDesignation(desig || ''),
      designationRaw: desig,
      appointed_on: toIsoDate(pick(r, 'appointmentDate', 'appointment_date', 'dateOfAppointment', 'appointedOn')),
      cessation_on: toIsoDate(pick(r, 'cessationDate', 'cessation_date', 'dateOfCessation', 'ceasedOn')),
      // Deliberately NOT imported: date of birth, gender, nationality, PAN,
      // address, phone, email. They are personal data this app has no need for,
      // and not collecting them is cheaper than protecting them.
    };
  }).filter((d) => d.din || d.name);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const cin = String(body?.cin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(cin)) {
      return json({ error: 'A valid 21-character CIN is required.' }, 400);
    }

    const url = Deno.env.get('DIR_API_URL');
    const key = Deno.env.get('DIR_API_KEY');
    if (!url || !key) {
      return json({
        configured: false,
        error: 'No director data provider is configured.',
        detail:
          'MCA publishes director details per company but offers no API, and its terms prohibit ' +
          'bulk collection from MCA21. A licensed provider is required. Set DIR_API_URL and ' +
          'DIR_API_KEY as Supabase secrets and redeploy this function.',
        provider: Deno.env.get('DIR_PROVIDER') || null,
      }, 503);
    }

    const style = (Deno.env.get('DIR_AUTH_STYLE') || 'bearer').toLowerCase();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let endpoint = url.replace('{cin}', encodeURIComponent(cin));
    if (style === 'bearer') headers['Authorization'] = `Bearer ${key}`;
    else if (style === 'header') headers[Deno.env.get('DIR_AUTH_HEADER') || 'x-api-key'] = key;
    else if (style === 'query') {
      endpoint += (endpoint.includes('?') ? '&' : '?') + 'api-key=' + encodeURIComponent(key);
    }
    if (!endpoint.includes(cin)) {
      endpoint += (endpoint.includes('?') ? '&' : '?') + 'cin=' + encodeURIComponent(cin);
    }

    const rr = await fetch(endpoint, { method: 'GET', headers });
    const txt = await rr.text();
    let data: any = null;
    try { data = JSON.parse(txt); } catch { /* not JSON */ }

    if (!rr.ok) {
      return json({ found: false, cin, status: rr.status, error: 'Provider rejected the request.',
                    detail: txt.slice(0, 400) }, 502);
    }

    // Find the array of directors wherever the provider put it.
    const candidates = [
      data?.directors, data?.data?.directors, data?.result?.directors,
      data?.data?.directorDetails, data?.directorDetails, data?.signatories,
      Array.isArray(data?.data) ? data.data : null,
      Array.isArray(data) ? data : null,
    ].filter(Array.isArray) as Record<string, unknown>[][];

    if (!candidates.length) {
      // Better to hand back what arrived than to invent a mapping for it.
      return json({ found: false, cin, unmapped: true,
                    detail: 'Could not find a director array in the response.',
                    raw: data ?? txt.slice(0, 1200) });
    }

    const directors = normalise(candidates[0]);
    return json({
      found: directors.length > 0,
      cin,
      count: directors.length,
      directors,
      provider: Deno.env.get('DIR_PROVIDER') || 'custom',
      note: 'Personal fields (date of birth, gender, nationality, PAN, contact) are not imported.',
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
