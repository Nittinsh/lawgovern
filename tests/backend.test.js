// ============================================================
// BACKEND CONFORMANCE — the surface nothing else tests
//
//   node tests/backend.test.js
//
// Every other test in this project runs the shipped JavaScript under Node with
// a browser shim. Not one of them touches Supabase. That leaves the entire
// backend — tables, columns, row-level security, storage, functions — checked
// only by whether the app happens to work when somebody clicks something.
//
// This checks it directly, against the live project, and answers three
// questions the frontend suite cannot:
//
//   1. MIGRATION DRIFT. The app reads columns that only exist once a migration
//      has been run. CLAUDE.md records six migrations sitting unrun at various
//      points; each one is a screen that fails at the moment somebody uses it.
//      Every column below is derived FROM index.html itself, so this list
//      cannot fall out of step with the app the way a hand-written one would.
//
//   2. DOES RLS ACTUALLY HOLD. db/025 rewrote every policy in the database. The
//      only verification so far was that the tables exist. An anonymous caller
//      reading a row from any of them is a data breach, and nothing was testing
//      for it.
//
//   3. ARE THE FUNCTIONS REACHABLE AND GUARDED. Four Edge Functions and four
//      RPCs, none of them ever tested.
//
// ── SAFETY ──────────────────────────────────────────────────
// This runs against PRODUCTION and is built not to change it.
//   * Every schema and RLS check is a SELECT with limit=0 or limit=1.
//   * The write checks deliberately use a payload that violates a foreign key
//     even if RLS were wide open, so a passing RLS check and a failing one both
//     end with nothing written. That is the point: a test that would corrupt
//     the database if it found a bug is not a test anyone should run.
//   * The anon key is read from index.html and never printed. It is public
//     anyway — it is in the shipped HTML — but there is no reason to echo it.
// ============================================================
const fs = require('fs');
const path = require('path');

const INDEX = process.env.LG_INDEX || path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(INDEX, 'utf8');

// ── credentials, from the app rather than from anywhere else ────
const URL_M = src.match(/SUPA_URL\s*=\s*'([^']+)'/);
const KEY_M = src.match(/SUPA_(?:ANON|KEY|ANON_KEY)\s*=\s*'([^']+)'/)
           || src.match(/createClient\(\s*[A-Z_]+\s*,\s*'([^']+)'/);
if (!URL_M || !KEY_M) {
  console.log('Could not read the Supabase URL or anon key out of index.html.');
  process.exit(1);
}
const BASE = URL_M[1].replace(/\/$/, '');
const KEY = KEY_M[1];
const REST = BASE + '/rest/v1';
const HEAD = { apikey: KEY, Authorization: 'Bearer ' + KEY };

// ── the expected schema, derived from index.html ────────────────
// LG_REG is the app's own definition of every register and its fields. Reading
// it here means adding a field to a register automatically adds it to this
// check — the two cannot drift.
function registersFromApp() {
  const i = src.indexOf('var LG_REG = {');
  if (i < 0) return {};
  const blk = src.slice(i, src.indexOf('\n};', i));
  const out = {};
  // Split on each register key so fields are attributed to the right table.
  const keys = [...blk.matchAll(/\n  (\w+):\s*\{/g)];
  keys.forEach((m, n) => {
    const seg = blk.slice(m.index, n + 1 < keys.length ? keys[n + 1].index : blk.length);
    const t = seg.match(/table:'(\w+)'/);
    if (!t) return;
    const cols = [...seg.matchAll(/\{f:'(\w+)'/g)].map(x => x[1]);
    out[t[1]] = [...new Set(cols.concat(['id', 'company_id', 'user_id']))];
  });
  return out;
}

// Tables the app reads that are not registers. Columns here are the ones the
// code actually names in a select or an insert, checked by hand against
// index.html — there is no machine-readable declaration of them to derive from.
const CORE = {
  companies:               ['id', 'user_id', 'org_id', 'name', 'type', 'fyend', 'capital',
                            'turnover', 'networth', 'netprofit', 'borrowings', 'cin'],
  compliance_status:       ['id', 'user_id', 'company_id', 'compliance_key', 'status',
                            'filing_ref', 'evidence_note', 'evidence_source', 'verified_by',
                            'verified_at', 'recorded_by', 'recorded_at', 'check_state',
                            'check_note', 'evidence_file', 'confidence', 'not_applicable',
                            'applies_confirmed', 'applies_confirmed_by', 'applies_confirmed_at'],
  profiles:                ['id', 'approved', 'is_admin'],
  templates:               ['id', 'category', 'template_key', 'title', 'body', 'vetted_by'],
  internal_compliances:    ['id', 'user_id'],
  internal_compliance_log: ['id', 'user_id'],
  material_events:         ['id', 'user_id', 'company_id'],
  compliance_audit:        ['id', 'user_id'],
  rule_verifications:      ['id', 'user_id', 'org_id', 'rule_id'],
  // db/025
  organisations:           ['id', 'name', 'created_by', 'created_at'],
  org_members:             ['org_id', 'user_id', 'role', 'joined_at'],
  org_invites:             ['id', 'org_id', 'email', 'role', 'accepted_at']
};

// An RPC probe MUST send the arguments the app sends. PostgREST matches on the
// signature, so calling a two-argument function with {} returns PGRST202
// "could not find the function" — indistinguishable from it not existing. The
// first version of this reported admin_set_approval as missing, and it is not:
// with its real arguments it answers "Not authorized", which is the function
// running and refusing an anonymous caller. A probe that cannot tell a missing
// function from a mistyped call is not checking the backend, it is checking
// itself.
const RPCS = {
  lg_claim_invites:  {},
  admin_list_users:  {},
  admin_set_approval:{ target_id: '00000000-0000-0000-0000-000000000000', new_status: true },
  purge_expired_documents: {}
};
const FUNCTIONS = ['ai-proxy', 'admin-actions', 'mca-lookup', 'mca-directors'];

// ── reporting ───────────────────────────────────────────────────
const R = { pass: 0, fail: 0, warn: 0, failures: [] };
let GROUP = '';
function describe(g) { GROUP = g; console.log('\n  ' + g); }
function ok(name, cond, detail) {
  if (cond) { R.pass++; console.log('    ok    ' + name); }
  else { R.fail++; R.failures.push({ group: GROUP, name, detail });
         console.log('    FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
function warn(name, detail) {
  R.warn++; console.log('    warn  ' + name + (detail ? '  — ' + detail : ''));
}

async function get(url, opts) {
  try {
    const r = await fetch(url, Object.assign({ headers: HEAD }, opts || {}));
    let body = null;
    const txt = await r.text();
    try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = txt; }
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: String(e && e.message) };
  }
}

// ── the run ─────────────────────────────────────────────────────
(async function main() {
  console.log('BACKEND CONFORMANCE');
  console.log('  project: ' + BASE.replace(/https:\/\//, ''));
  console.log('  key:     anon (public), read from index.html — never printed');
  console.log('  writes:  none. Write checks use a payload that violates a foreign');
  console.log('           key even if RLS were open, so nothing can be inserted.');

  const REG = registersFromApp();
  const ALL = Object.assign({}, CORE, REG);
  const names = Object.keys(ALL).sort();

  // ── 1. every table the app talks to exists ────────────────────
  describe('tables exist (' + names.length + ' referenced by the app)');
  const present = {};
  for (const t of names) {
    const r = await get(REST + '/' + t + '?select=*&limit=0');
    // 200 = there. 404 / PGRST205 = not there. 401/403 = there but shut, which
    // still answers the question this check asks.
    const exists = r.status === 200 || r.status === 401 || r.status === 403;
    present[t] = exists;
    ok(t, exists, exists ? '' : 'HTTP ' + r.status + ' ' +
       ((r.body && (r.body.message || r.body.code)) || ''));
  }

  // ── 2. every column the app reads exists ──────────────────────
  // This is the migration-drift check. Asking for a column that is not there
  // returns 42703, which is exactly the error the app hits at runtime — except
  // here it is a line of output instead of a broken screen.
  describe('columns exist (the migration-drift check)');
  for (const t of names) {
    if (!present[t]) { warn(t, 'table missing — columns not checked'); continue; }
    const cols = ALL[t];
    const r = await get(REST + '/' + t + '?select=' + cols.join(',') + '&limit=0');
    if (r.status === 200 || r.status === 401 || r.status === 403) {
      ok(t + ' (' + cols.length + ' columns)', true);
    } else {
      const msg = (r.body && r.body.message) || '';
      // Narrow it to the offending column so the output names the migration.
      let bad = [];
      for (const c of cols) {
        const one = await get(REST + '/' + t + '?select=' + c + '&limit=0');
        if (one.status !== 200 && one.status !== 401 && one.status !== 403) bad.push(c);
      }
      ok(t + ' (' + cols.length + ' columns)', false,
         bad.length ? 'missing: ' + bad.join(', ') : msg.slice(0, 90));
    }
  }

  // ── 2b. which migrations have actually been run ───────────────
  // CLAUDE.md tracks this by hand and gets it wrong: at the time of writing it
  // marked db/017 through db/025 "NOT YET RUN" while every one of them was
  // applied. A note in a document is a claim; a column in the database is a
  // fact. Each migration is identified by one thing only it creates.
  describe('migrations applied (by witness, not by note)');
  const MIGRATIONS = [
    ['001 financial columns',   'companies',            'networth'],
    ['003 evidence trail',      'compliance_status',    'filing_ref'],
    ['005 maker-checker',       'compliance_status',    'recorded_by'],
    ['017 applicability review','compliance_status',    'applies_confirmed'],
    ['018 meeting outcomes',    'meetings',             'approved_results'],
    ['019 charges register',    'charges',              'created_on'],
    ['020 allotments register', 'allotments',           'allotted_on'],
    ['021 beneficial interest', 'beneficial_interests', 'received_on'],
    ['022 meeting auditor',     'meetings',             'auditor_appointed'],
    ['023 rule governance',     'rule_verifications',   'rule_id'],
    ['024 pit control',         'upsi_events',          'window_closed'],
    ['025 organisations',       'companies',            'org_id']
  ];
  for (const [label, table, witness] of MIGRATIONS) {
    const r = await get(REST + '/' + table + '?select=' + witness + '&limit=0');
    const applied = r.status === 200 || r.status === 401 || r.status === 403;
    ok(label, applied, applied ? '' :
       'not applied — ' + table + '.' + witness + ' is absent. Run db/' +
       label.split(' ')[0] + '_*.sql');
  }

  // ── 3. RLS holds against an anonymous caller ──────────────────
  // The strongest check here. `companies` is known to hold real client data, so
  // a single row coming back to an unauthenticated request is a breach, not a
  // style issue.
  describe('row-level security — anonymous reads return nothing');
  for (const t of names) {
    if (!present[t]) continue;
    const r = await get(REST + '/' + t + '?select=*&limit=1');
    if (r.status === 401 || r.status === 403) { ok(t + ' — refused outright', true); continue; }
    if (r.status !== 200) { ok(t, false, 'unexpected HTTP ' + r.status); continue; }
    const rows = Array.isArray(r.body) ? r.body.length : -1;
    ok(t + ' — 0 rows to an anonymous caller', rows === 0,
       rows > 0 ? 'LEAKED ' + rows + ' ROW(S)' : 'got ' + JSON.stringify(r.body).slice(0, 60));
  }

  // ── 4. anonymous writes are refused ───────────────────────────
  // The payload names a company_id that cannot exist, so a broken policy ends
  // in a foreign-key violation rather than a row in the user's database.
  describe('row-level security — anonymous writes are refused');
  const GHOST = '00000000-0000-0000-0000-000000000000';
  // One payload per table, using ONLY columns that table actually has.
  // The first version of this sent the same object to every table, so
  // PostgREST rejected it with 400 "could not find the column" BEFORE row-level
  // security was ever consulted — six confident failures that tested nothing but
  // my own payload. A check that cannot reach the thing it is checking is worse
  // than no check, because it reports on it anyway.
  const PROBES = {
    companies:         { user_id: GHOST, org_id: GHOST, name: '__rls_probe__' },
    compliance_status: { user_id: GHOST, company_id: GHOST, compliance_key: '__rls_probe__' },
    directors:         { user_id: GHOST, company_id: GHOST, name: '__rls_probe__' },
    meetings:          { user_id: GHOST, company_id: GHOST, kind: 'board' },
    organisations:     { name: '__rls_probe__', created_by: GHOST },
    org_members:       { org_id: GHOST, user_id: GHOST, role: 'viewer' },
    rule_verifications:{ user_id: GHOST, org_id: GHOST, rule_id: '__rls_probe__' }
  };
  for (const t of Object.keys(PROBES)) {
    if (!present[t]) continue;
    const r = await get(REST + '/' + t, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json',
                               Prefer: 'return=minimal' }, HEAD),
      body: JSON.stringify(PROBES[t])
    });
    const msg = String((r.body && r.body.message) || r.body || '');
    // 401/403 is RLS refusing. A foreign-key violation means RLS let it through
    // and the constraint stopped it — still nothing written, but it is NOT a
    // pass, because the policy did not do the refusing.
    const byPolicy = r.status === 401 || r.status === 403 ||
                     /row-level security/i.test(msg);
    const byConstraint = /violates foreign key|not-null|violates check/i.test(msg);
    if (byConstraint && !byPolicy) {
      ok(t + ' — insert refused BY POLICY', false,
         'the row was stopped by a constraint, not by RLS: ' + msg.slice(0, 70));
    } else {
      ok(t + ' — insert refused', byPolicy,
         'HTTP ' + r.status + ' ' + msg.slice(0, 70));
    }
  }

  // ── 5. the evidence bucket is not public ──────────────────────
  describe('storage');
  const pub = await get(BASE + '/storage/v1/object/public/evidence/probe.pdf');
  ok('the evidence bucket does not serve files publicly',
     pub.status === 400 || pub.status === 404 || pub.status === 403,
     'HTTP ' + pub.status);
  const list = await get(BASE + '/storage/v1/object/list/evidence', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, HEAD),
    body: JSON.stringify({ prefix: '', limit: 1 })
  });
  const leaked = Array.isArray(list.body) && list.body.length > 0;
  ok('an anonymous caller cannot list evidence', !leaked,
     leaked ? 'LISTED ' + list.body.length + ' OBJECT(S)' : 'HTTP ' + list.status);

  // ── 6. database functions ─────────────────────────────────────
  describe('database functions');
  for (const fn of Object.keys(RPCS)) {
    const r = await get(REST + '/rpc/' + fn, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, HEAD),
      body: JSON.stringify(RPCS[fn])
    });
    const msg = String((r.body && (r.body.code || '') + ' ' + (r.body.message || '')) || '');
    const missing = /PGRST202|could not find the function/i.test(msg);
    // P0001 is the function's own "Not authorized" — it exists, it ran, and it
    // refused. That is a pass twice over: present, and guarded.
    const guarded = /P0001|not authorized|permission denied/i.test(msg) ||
                    r.status === 401 || r.status === 403;
    ok(fn + ' exists', !missing, missing ? 'PostgREST cannot find it' : '');
    if (!missing && fn !== 'lg_claim_invites')
      ok(fn + ' refuses an anonymous caller', guarded,
         'HTTP ' + r.status + ' ' + msg.slice(0, 60));
  }

  // ── 7. edge functions reject an unauthenticated caller ────────
  // ai-proxy holds the OpenRouter key. If it answered an anonymous POST, anyone
  // with the public anon key could spend the owner's quota.
  describe('edge functions');
  for (const fn of FUNCTIONS) {
    const r = await get(BASE + '/functions/v1/' + fn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'probe' }] })
    });
    if (r.status === 404) { warn(fn + ' not deployed', 'HTTP 404'); continue; }
    ok(fn + ' refuses an unauthenticated call',
       r.status === 401 || r.status === 403,
       'HTTP ' + r.status + ' — ' + String(JSON.stringify(r.body)).slice(0, 70));
  }

  // ── what this cannot answer ───────────────────────────────────
  console.log('\n  ' + '─'.repeat(62));
  console.log('  NOT tested here, and why');
  console.log('    Everything above runs as an ANONYMOUS caller. That proves the');
  console.log('    doors are shut. It cannot prove the right people get through:');
  console.log('      · does a member of one practice see its companies');
  console.log('      · does a member of another practice NOT see them');
  console.log('      · is a viewer refused a write the database should refuse');
  console.log('      · did db/025 backfill every company with an org_id');
  console.log('    All four need a signed-in session. Signing in means handling a');
  console.log('    password, which this must not do — so they stay manual, and the');
  console.log('    two-account maker-checker walkthrough is how they get covered.');

  console.log('\n' + '─'.repeat(64));
  console.log('  ' + R.pass + ' passed, ' + R.fail + ' failed, ' + R.warn + ' warnings');
  console.log('─'.repeat(64));
  if (R.fail) {
    console.log('');
    for (const f of R.failures) console.log('  x [' + f.group + '] ' + f.name +
      (f.detail ? '\n      ' + f.detail : ''));
    console.log('');
  }
  process.exit(R.fail ? 1 : 0);
})();
