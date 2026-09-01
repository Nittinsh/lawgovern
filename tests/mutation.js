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

  { name: 's.403 prices a form whose fee rules are not held (§2y)',
    from: '  if(!f[3]) return {form:f, days:days, late:true, unpriced:true};',
    to:   '  if(false) return {form:f, days:days, late:true, unpriced:true};' },

  { name: 's.149(4) rounds the one-third down (§2y — the Explanation rounds up)',
    from: '    var need = Math.ceil(n / 3);',
    to:   '    var need = Math.floor(n / 3);' },

  { name: 'a ceased director is still counted on the board (§2y)',
    from: '  var inOffice = (directors || []).filter(function(d){ return !d.cessation_on; });',
    to:   '  var inOffice = (directors || []);' },

  { name: 'an untested composition condition reports as satisfied (§2y)',
    from: "    have:'not recorded', ok:false, evaluable:false,",
    to:   "    have:'not recorded', ok:true, evaluable:true," }
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
