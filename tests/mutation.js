// ============================================================
// MUTATION CHECK — does the suite actually catch anything?
//
// A regression suite that passes is not evidence of much; a suite that cannot
// fail is worse than none, because it buys confidence it has not earned. This
// deliberately reintroduces bugs that really happened in this codebase, runs
// the suite against each broken build, and reports whether it noticed.
//
// It found a real weakness the first time it ran: the minutes-splitting test
// asserted only the number of decisions, and both the correct and the broken
// splitter produced two on that input. The assertion now checks where each item
// heading lands, which is what the bug actually got wrong.
//
//   node tests/mutation.js
//
// index.html is never modified — each mutant is written to a temp copy and the
// suite is pointed at it through LG_INDEX.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const TMP = path.join(os.tmpdir(), 'lawgovern-mutants');

// Each entry is a bug that actually shipped here once, with the CLAUDE.md
// section that explains it.
const MUTATIONS = [
  { name: 'month clamping removed (§2n — 31 Dec + 2m became 3 Mar)',
    from: 'return lodrFmt(y, m + 1, Math.min(p[2], last));',
    to:   'return lodrFmt(y, m + 1, p[2]);' },

  { name: 'citation suffix allows a space (§2h — "Regulation 30 of" parsed as 30O)',
    from: 'var reReg = /\\bReg(?:ulation)?s?\\.?\\s*(\\d+[A-Z]?)(?![A-Za-z])/gi;',
    to:   'var reReg = /\\bReg(?:ulation)?s?\\.?\\s*(\\d+\\s*[A-Z]?)/gi;' },

  { name: 'period ends emitted as deadlines (§2k — 63 obligations on 31 Mar 2027)',
    from: 'return lgHasDeadline(rule) ? dates : lgStripDeadlines(dates);\n}\n\nfunction cmDueDates',
    to:   'return dates;\n}\n\nfunction cmDueDates' },

  { name: 'PAS-3 private placement widened to 30 days (§2n — s.42(8) says fifteen)',
    from: 'due: lodrAddDays(on, pp ? 15 : 30),',
    to:   'due: lodrAddDays(on, 30),' },

  { name: 'subscribers raise a PAS-3 again (§2n — a filing that is not owed)',
    from: "    if(route === 'subscribers') return;",
    to:   '    if(false) return;' },

  { name: 'minutes split on every RESOLVED (§2g — headings leaked between items)',
    from: '  if(heads && heads.length >= 2){',
    to:   '  if(false){' },

  { name: 'MGT-6 dated from the change, not receipt (§2o — overdue before it arrived)',
    from: "    if(!b.received_on) return;               // no receipt, nothing to file",
    to:   "    if(!b.received_on && !b.change_on) return;" },

  { name: 'the no-date guard drops back to a bare comparison (§2k — null >= 0 is true)',
    from: "  return state === 'STANDING' || state === 'NO_DEADLINE';",
    to:   "  return state === 'STANDING';" },

  // ── status transitions ──────────────────────────────────────
  // The status engine is where the product makes its claims — filed, overdue,
  // or nothing known — and those are the claims a Company Secretary acts on.

  { name: 'a period with no deadline collapses back into STANDING (§2k)',
    from: "    out.state = out.autoState = row.periodEnd ? 'NO_DEADLINE' : 'STANDING';",
    to:   "    out.state = out.autoState = 'STANDING';" },

  { name: 'a user marking an obligation not applicable stops being honoured (§2j)',
    from: '  if(row.applicable === false || row.userNA){',
    to:   '  if(row.applicable === false){' },

  { name: 'the register stops excluding rows ruled out by the user (§2j)',
    from: '    if(r.userNA && !(opts && opts.includeNA)) return false;',
    to:   '    if(false) return false;' },

  // NOT a mutation: "a private company starts receiving LODR obligations" was
  // tried three ways and passed every time, because the exclusion is guarded
  // twice independently — the outer gate never calls lodrObligations for an
  // unlisted entity, and lodrApplies refuses every rule anyway since
  // lodrListingTypes returns nothing for one. Breaking either alone changes
  // nothing. That is a property worth having, so it is recorded here rather
  // than worked around by mutating both at once until something fails.

  { name: 'the trading window reopens on the results date, not 48 hours after (§2w)',
    from: '      var reopen = lodrAddDays(String(results.held_on), 2);',
    to:   '      var reopen = String(results.held_on);' },

  { name: 'an unpublished UPSI item stops holding the window shut (§2w cl. 4(1))',
    from: '    if(!u.window_closed) return false;',
    to:   '    return false;' },

  { name: 'any board meeting reopens the window, not only a results one (§2w)',
    from: '      return m.approved_results === true && m.held_on && String(m.held_on) >= qEnd;',
    to:   '      return m.held_on && String(m.held_on) >= qEnd;' },

  // ── the statutory calculators ───────────────────────────────
  // A wrong figure looks exactly like a right one, which is why each of these
  // reverses a direction or moves a boundary rather than breaking the code.

  { name: 'a s.198(5) tax add-back is deducted instead (§2y — sign reversed)',
    from: "       's.198(5)(a)', calcNum(v.a5a), 1);",
    to:   "       's.198(5)(a)', calcNum(v.a5a), -1);" },

  { name: 'a s.198(3) credit is added rather than removed (§2y)',
    from: "       's.198(3)(a)', calcNum(v.l3a), -1);",
    to:   "       's.198(3)(a)', calcNum(v.l3a), 1);" },

  { name: "s.197 stops adding directors' remuneration back (§2y — every ceiling understated)",
    from: '  var base = calcNum(net198) + calcNum(dirRem);',
    to:   '  var base = calcNum(net198);' },

  { name: 's.197 binds a private company too (§2y — a ceiling that does not exist)',
    from: '    applies: isPublic !== false,',
    to:   '    applies: true,' },

  { name: 'the CSR committee threshold turns inclusive (§2y — s.135(9) says "does not exceed")',
    from: '    committeeRequired: spend > 5000000,',
    to:   '    committeeRequired: spend >= 5000000,' },

  { name: 's.186 takes the smaller limb, not "whichever is more" (§2y)',
    from: '  var limit = Math.max(a, b);',
    to:   '  var limit = Math.min(a, b);' },

  { name: 's.149(4) rounds the one-third down (§2y — the Explanation rounds up)',
    from: '    var need = Math.ceil(n / 3);',
    to:   '    var need = Math.floor(n / 3);' },

  { name: 'a ceased director is still counted on the board (§2y)',
    from: '  var inOffice = (directors || []).filter(function(d){ return !d.cessation_on; });',
    to:   '  var inOffice = (directors || []);' },

  { name: 'an untested composition condition reports as satisfied (§2y)',
    from: "    have:'not recorded', ok:false, evaluable:false,",
    to:   "    have:'not recorded', ok:true, evaluable:true," },

  // ── entity class ────────────────────────────────────────────
  // Two of these three were live in the shipped product. Both told a real
  // client something confident and wrong about a section that does not reach it.

  { name: 'an LLP starts receiving Companies Act obligations again (§2z)',
    from: "  return (c && c.type === 'llp') ? 'llp' : 'companies_act';",
    to:   "  return 'companies_act';" },

  { name: 'a One Person Company is told to hold an AGM again (§2z — s.96(1))',
    from: "  if(c.type === 'opc'){\n    out.agm = 'A One Person Company holds no annual general meeting",
    to:   "  if(false){\n    out.agm = 'A One Person Company holds no annual general meeting" },

  { name: 'the small-company size test reaches a public company (§2z — s.2(85))',
    from: "  if(c.type !== 'private') return false;",
    to:   "  if(c.type === 'llp') return false;" },

  { name: 'the s.2(85) holding/subsidiary proviso stops applying (§2z)',
    from: '  if(c.is_holding === true || c.is_subsidiary === true) return false;',
    to:   '  if(false) return false;' },

  // ── the newer calculators ───────────────────────────────────

  { name: 's.180 stops excluding temporary bank loans (§2z — the Explanation)',
    from: '  var counted = calcNum(alreadyBorrowed) - calcNum(temporary);',
    to:   '  var counted = calcNum(alreadyBorrowed);' },

  { name: 'the private-company deposit limit is halved (§2z — Rule 3(3) says 100%)',
    from: '  var limit = cap;                   // Rule 3(3): one hundred per cent',
    to:   '  var limit = cap / 2;' },

  { name: "a director's money is excluded without the declaration (§2z)",
    from: "    if(!declaration) r.verdict = 'conditional';",
    to:   '    if(false) r.verdict = 0;' },

  { name: 'the LLP fee is priced from rules that are not held (§2z)',
    from: '  return {form:f, days: days > 0 ? days : 0, late: days > 0, unpriced:true};',
    to:   '  return {form:f, days: days > 0 ? days : 0, late: days > 0, fee: days * 100};' },

  // ── access control ──────────────────────────────────────────
  // The 30 August assessment asked for mutation coverage on auth. There was
  // none to write until there were roles. A mistake here is not a wrong figure
  // on a screen — it is somebody certifying something they should not.

  { name: 'a viewer gains write access (§3a)',
    from: "function lgCanWrite(){ return CURRENT_ROLE !== 'viewer'; }",
    to:   'function lgCanWrite(){ return true; }' },

  { name: 'a member can manage people (§3a)',
    from: "function lgCanAdmin(){ return CURRENT_ROLE === 'owner' || CURRENT_ROLE === 'admin'; }",
    to:   "function lgCanAdmin(){ return CURRENT_ROLE !== 'viewer'; }" },

  { name: 'a viewer may confirm a filing (§3a — certifying without being able to write)',
    from: "  if(typeof lgCanWrite === 'function' && !lgCanWrite())",
    to:   '  if(false)' },

  { name: 'another organisation\'s companies leak onto the screen (§3a)',
    from: '    return !r.org_id || String(r.org_id) === String(CURRENT_ORG);',
    to:   '    return true;' },

  { name: 'a row with no organisation is dropped, emptying a pre-migration database (§3a)',
    from: '    return !r.org_id || String(r.org_id) === String(CURRENT_ORG);',
    to:   '    return String(r.org_id) === String(CURRENT_ORG);' },

  // ── the access check (§3c) ──────────────────────────────────
  // This is the tenant-isolation proof a customer runs on their own data. If it
  // can be made to report a pass while the isolation is broken it is worse than
  // not shipping it, because somebody would rely on it.

  { name: 'the access check stops noticing an unanchored company (§3c)',
    from: '    var unanchored = rows.filter(function(r){ return !r.org_id; });',
    to:   '    var unanchored = [];' },

  { name: 'the access check stops noticing a foreign row (§3c)',
    from: '      var foreign = rows.filter(function(r){ return r.org_id && !mine[String(r.org_id)]; });',
    to:   '      var foreign = [];' },

  { name: 'a constraint refusal counts as a policy refusal for a viewer (§3c)',
    from: "    var byPolicy = /row-level security|violates row-level/i.test(msg);",
    to:   "    var byPolicy = /violates/i.test(msg);" },

  { name: 'the cross-tenant probe reports a leak as clean (§3c)',
    from: "        seen.length === 0 ? 'pass' : 'fail',",
    to:   "        'pass'," },

  // ── companion deadlines (§3d) ───────────────────────────────
  // A companion takes another filing's date. Getting the anchor wrong produces
  // a date that looks entirely reasonable and is months out — the same failure
  // as the 31 March dates, arriving by a different road.

  // NOT a mutation: "a companion with no anchor gets a date anyway" cannot be
  // caught, and the reason is worth keeping. Removing `if(!due || !src) return`
  // makes the next line read src.section on a null, which throws; the row then
  // ends with no date and no companion — exactly what the guard produces. Two
  // mechanisms, one visible result, so no assertion can separate them. Same
  // shape as the doubly-guarded LODR exclusion in §2x.
  //
  // The exception did expose a real fragility, now fixed: it aborted the whole
  // loop, silently skipping every companion after it. Each row is resolved
  // inside its own guard, and LG_COMPANION_STATS records failures.

  { name: 'the annual report stops being 21 days before the AGM (§3d)',
    from: "      due = lgMinusDays(A.agm.due, 21); src = A.agm;",
    to:   "      due = A.agm.due; src = A.agm;" },

  { name: 'a quarterly companion follows the year instead of its own quarter (§3d)',
    from: '        if(row.periodEnd && String(A.results[i].periodEnd) === String(row.periodEnd)) same = A.results[i];',
    to:   '        same = null;' },

  // ── the SEBI-specified group (§3e) ──────────────────────────

  // ── the financial year in view (§3k, §3l) ───────────────────

  { name: 'a continuous obligation gets filtered out by the year (§3k)',
    from: '    if(!r.periodEnd) return true;',
    to:   '    if(!r.periodEnd) return false;' },

  { name: 'the year filter reads the due date instead of the period (§3k)',
    from: '    return lgFyOfPeriod(r.periodEnd, fyMonth, fyDay) === LG_FY;',
    to:   '    return lgFyOfPeriod(r.due, fyMonth, fyDay) === LG_FY;' },

  { name: 'allYears stops bypassing the filter, hiding years from the selector (§3k)',
    from: "  if(!(opts && opts.allYears) && typeof lgApplyFyFilter === 'function'){",
    to:   "  if(typeof lgApplyFyFilter === 'function'){" },

  { name: 'AOC-4 goes back to being filed under the AGM year (§3l)',
    from: "               periodEnd: lodrLast(agmFy.month, agmFy.day),",
    to:   "               periodEnd: agmIso," },

  { name: 'a period ending on the year-end date rolls into the next year (§3k)',
    from: '  var closesThisYear = (m < fyMonth) || (m === fyMonth && d <= fyDay);',
    to:   '  var closesThisYear = (m < fyMonth);' },

  // ── what the first real back-test found (§3j) ───────────────
  // Both mutations return the product to SILENCE about something it assumed.
  // That is the failure mode: every one of these looked normal on screen.

  { name: 'a missing year end stops being marked as assumed (§3j)',
    from: "    rows.forEach(function(r){ if(r.due) r.fyAssumed = true; });",
    to:   "    rows.forEach(function(r){ if(r.due) r.fyAssumed = false; });" },

  { name: 'reading a real year end still marks it assumed (§3j — cries wolf)',
    from: "  if(fyRaw.length===3 && fyRaw[1]>=1 && fyRaw[1]<=12){ fyMonth=fyRaw[1]; fyDay=fyRaw[2]; fyAssumed=false; }        // YYYY-MM-DD",
    to:   "  if(fyRaw.length===3 && fyRaw[1]>=1 && fyRaw[1]<=12){ fyMonth=fyRaw[1]; fyDay=fyRaw[2]; }        // YYYY-MM-DD" },

  { name: 'the assumed year end is downgraded from a defect to a gap (§3j)',
    from: "      btAdd(F,'fail','BASIS',c.name,'Every annual date rests on an ASSUMED year end',",
    to:   "      btAdd(F,'warn','BASIS',c.name,'Every annual date rests on an ASSUMED year end'," },

  { name: 'the AGM-anchor window widens until nothing disagrees (§3j)',
    from: "        if(gap > 120 || gap < 0)",
    to:   "        if(gap > 1200 || gap < 0)" },

  // ── the late-filing fee and the penalty beside it (§3m) ─────
  // Every mutation here yields a plausible figure, which is exactly the
  // failure this calculator shipped with: a card reading "Additional fee
  // Rs 6,200" that a CS would have repeated to a director, when the real
  // exposure was that plus Rs 16,100 on the company and Rs 16,100 on its
  // officers under s.92(5).

  { name: 'the maximum is computed and then not applied (§3m)',
    from: '  o.amount = o.capped ? leg.cap : raw;',
    to:   '  o.amount = raw;' },

  { name: 'the s.92(5) two-lakh maximum removed altogether (§3m)',
    from: "    co: {who:'The company', base:10000, day:100, dayFrom:'after-first', cap:200000},\n    off:{who:'Every officer in default', base:10000, day:100, dayFrom:'after-first', cap:50000} } },\n\n{ key:'aoc4'",
    to:   "    co: {who:'The company', base:10000, day:100, dayFrom:'after-first', cap:null},\n    off:{who:'Every officer in default', base:10000, day:100, dayFrom:'after-first', cap:50000} } },\n\n{ key:'aoc4'" },

  { name: 'the maximum is applied to the FEE as well (§3m — the Act caps no fee)',
    from: "  if(f.fee) out.fee = {perDay:f.fee.perDay, section:f.fee.section, amount: days * f.fee.perDay};",
    to:   "  if(f.fee) out.fee = {perDay:f.fee.perDay, section:f.fee.section, amount: Math.min(200000, days * f.fee.perDay)};" },

  { name: 'one day-count for both legs of s.137(3) (§3m — the sub-section uses two)',
    from: "  var n = leg.dayFrom === 'each-day' ? days : Math.max(0, days - 1);",
    to:   "  var n = Math.max(0, days - 1);" },

  { name: 'the day the maximum bit is projected instead of reported (§3m)',
    from: "    if(cd != null && days >= cd) out.pen.coCapDate = lodrAddDays(dueOn, cd);",
    to:   "    if(cd != null) out.pen.coCapDate = lodrAddDays(dueOn, cd);" },

  { name: 'the additional fee is guessed for forms the Fees Rules price (§3m)',
    from: "{ key:'other', label:'Any other form — where the Act fixes no penalty of its own',\n  section:'', match:null,",
    to:   "{ key:'other', label:'Any other form — where the Act fixes no penalty of its own',\n  section:'', match:null, fee:{section:'403', perDay:100}," },

  { name: 's.450 stops saying it is a residual (§3m)',
    from: "  pen:{ cite:'s.450', residual:true,",
    to:   "  pen:{ cite:'s.450',",
    note: 'A residual read as the answer prices a form whose own section says otherwise.' },

  { name: 'MGT-7 takes its due date from s.92(2) as well (§3m — that is MGT-8)',
    from: "  section:'Section 92(4)', match:/^Sec(?:tion)?s?\\.?\\s*92(?!\\s*\\()/i,",
    to:   "  section:'Section 92(4)', match:/^Sec(?:tion)?s?\\.?\\s*92/i," },

  { name: 'INC-22 matches section 128 and 123 too (§3m)',
    from: "  section:'Section 12', match:/^Sec(?:tion)?s?\\.?\\s*12(?!\\d)\\b/i,",
    to:   "  section:'Section 12', match:/^Sec(?:tion)?s?\\.?\\s*12/i," },

  { name: 'the assumed year end is dropped from the due date offered (§3m/§3j)',
    from: "              periodEnd:r.periodEnd || '', fyAssumed:!!r.fyAssumed, shared:[]});",
    to:   "              periodEnd:r.periodEnd || '', fyAssumed:false, shared:[]});" },

  { name: 'the dedupe swallows a row without counting it (§3m)',
    from: "    if(seen[r.due] != null){ out[seen[r.due]].shared.push(String(r.section || '')); return; }",
    to:   "    if(seen[r.due] != null){ return; }",
    note: 'This is the mechanism that hid the s.92(2) mutation: a row absorbed '+
          'into another produced output identical to the correct build.' },

  { name: 's.86(1) is treated as a daily penalty (§3m — it is a fixed amount)',
    from: "    co: {who:'The company', kind:'flat', base:500000},",
    to:   "    co: {who:'The company', base:500000, day:1000, dayFrom:'each-day', cap:null}," },

  { name: 'a court-fixed fine is presented as a computed amount (§3m)',
    from: "  if(o.kind === 'fine'){ o.min = leg.min; o.max = leg.max; return o; }",
    to:   "  if(o.kind === 'fine'){ o.min = leg.min; o.max = leg.max; o.amount = leg.min; return o; }" },

  // ── the export (§3h) ──────────────────────────────────────────────
  // An export that drops a table silently is worse than none: it looks like a
  // backup. Both mutations make the drop invisible rather than breaking it.

  { name: 'a table that fails to read is skipped instead of recorded (§3h)',
    from: "      out.errors[spec.t] = String((e && e.message) || e);",
    to:   "      out.errors[spec.t] = undefined;" },

  { name: 'a failed table is counted as zero rows rather than unknown (§3h)',
    from: "      out.counts[spec.t] = null;",
    to:   "      out.counts[spec.t] = 0;" },

  { name: 'the export stops saying what it leaves out (§3h)',
    from: "      notIncluded: [",
    to:   "      notIncluded: [].concat([" },

  // ── Integrated Filing (§3f) ─────────────────────────────────
  // Governance is 30 days from the quarter end, Financial is 45. Swapping them
  // gives every affected row a completely plausible date that is a fortnight
  // wrong in one direction or the other — the hardest kind of error to notice.

  { name: 'Governance filings take the 45-day Financial period (§3f)',
    from: "  'LODR-REG-13-3': {\n    due:{days:30},",
    to:   "  'LODR-REG-13-3': {\n    due:{days:45}," },

  { name: 'the deviation statement takes the 30-day Governance period (§3f)',
    from: "  'LODR-REG-32-1': {\n    due:{days:45},",
    to:   "  'LODR-REG-32-1': {\n    due:{days:30}," },

  { name: 'the cyber-security disclosure stops following clause (a) (§3f)',
    from: "  'LODR-REG-27-2-BA': {\n    due:{days:30},",
    to:   "  'LODR-REG-27-2-BA': {\n    due:{days:45}," },

  { name: 'Reg 91C loses the period the 2025 amendment gave it (§3e)',
    from: "  'LODR-REG-91C-91E': {",
    to:   "  'LODR-REG-91C-DISABLED': {" },

  { name: 'an explanation is offered for a row that already has a date (§3e)',
    from: '  if(!row || row.due) return null;',
    to:   '  if(!row) return null;' },

  { name: '"with the annual results" picks the first quarter it finds (§3d)',
    from: "      if(yr){ due = yr.due; src = yr; label = 'the year-end Reg 33(3)(a) results submission'; }",
    to:   "      if(A.results[0]){ due = A.results[0].due; src = A.results[0]; label = 'results'; }" },

  // NOT a mutation any more: the agmPlus2 branch was removed. Reg 34(1)(b) runs
  // from the AGM actually held, which §2l takes from the meetings register, so
  // it is not a companion at all. The suite asserts it stays undated instead.
];

const src = fs.readFileSync(INDEX, 'utf8');
fs.mkdirSync(TMP, { recursive: true });

// A clean build must pass, or nothing below means anything.
let r = spawnSync(process.execPath, [path.join(__dirname, 'compliance.test.js')],
                  { encoding: 'utf8' });
if (r.status !== 0) {
  console.log('The suite does not pass against the current build — fix that first.\n');
  console.log(r.stdout);
  process.exit(1);
}
console.log('baseline: suite passes against the current build\n');

let caught = 0, missed = 0, skipped = 0;
for (const m of MUTATIONS) {
  const n = src.split(m.from).length - 1;
  if (n !== 1) {
    console.log(`  SKIPPED  ${m.name}\n           anchor matched ${n} times — the code moved`);
    skipped++;
    continue;
  }
  const mutant = path.join(TMP, 'index.html');
  fs.writeFileSync(mutant, src.replace(m.from, m.to));
  const run = spawnSync(process.execPath, [path.join(__dirname, 'compliance.test.js')],
                        { encoding: 'utf8', env: Object.assign({}, process.env, { LG_INDEX: mutant }) });
  // A mutant can also crash rather than fail assertions — still caught, but
  // there is no "N FAILED" line to read.
  const hits = (run.stdout.match(/(\d+) FAILED/) || [])[1];
  const how = hits ? `${hits} assertion(s) failed` : 'the mutant crashed under the suite';
  if (run.status !== 0) {
    console.log(`  caught   ${m.name}\n           ${how}`);
    caught++;
  } else {
    console.log(`  MISSED   ${m.name}\n           the suite passed against a build with this bug in it`);
    missed++;
  }
}

console.log('\n' + '─'.repeat(64));
console.log(`  ${caught} caught, ${missed} missed, ${skipped} skipped`);
console.log('─'.repeat(64));
if (missed) {
  console.log('\n  A missed mutation means the suite has a blind spot, not that the');
  console.log('  bug is harmless. Strengthen the assertion rather than deleting the row.\n');
}
process.exit(missed ? 1 : 0);
