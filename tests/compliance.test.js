// ============================================================
// COMPLIANCE REGRESSION SUITE
//
// Both independent assessments (29 Aug 2026) ask for the same thing: a formal
// suite of statutory edge cases — month-end, leap year, FY variants, event
// anchors — to prevent silent compliance errors.
//
// Almost every test below guards a bug that actually happened in this codebase.
// The section references are to CLAUDE.md, so a failure points at the write-up
// explaining why the expected value is what it is. A wrong date in a compliance
// register does not look wrong; it looks like a date. That is what makes these
// worth having.
//
//   node tests/compliance.test.js
//
// Time is frozen at 29 Aug 2026 by the harness, inside FY 2026-27.
// ============================================================
const path = require('path');
const { loadApp, describe, check, ok, report } = require('./harness');

// LG_INDEX lets the suite run against any build — used by the mutation check
// in tests/mutation.js to prove these assertions can actually fail.
const app = loadApp(process.env.LG_INDEX || path.join(__dirname, '..', 'index.html'));

// A listed and a private entity, both on a 31 March year end.
const LISTED = {
  id: 'T-LISTED', name: 'Test Listed Ltd', type: 'listed', fyend: '2026-03-31',
  capital: 1000000000, turnover: 5000000000, cin: 'L12345MH2010PLC123456', chart: {}
};
const PRIVATE = {
  id: 'T-PVT', name: 'Test Private Ltd', type: 'private', fyend: '2026-03-31',
  capital: 10000000, turnover: 50000000, cin: 'U12345MH2015PTC123456', chart: {}
};
// A December year end, to catch logic that assumes 31 March.
const DEC_FY = Object.assign({}, PRIVATE, { id: 'T-DEC', fyend: '2026-12-31' });

const rowsFor = (c) => app.getComplianceChart(c);
const find = (c, section) => rowsFor(c).filter(r => String(r.section) === section);
const dueOf = (c, section) => (find(c, section)[0] || {}).due || null;

function setRegisters(regs) {
  app.LG_REGS = Object.assign(
    { directors: [], meetings: [], charges: [], allotments: [], beneficial_interests: [] },
    regs || {});
}
setRegisters();

// ── 1. Date arithmetic ──────────────────────────────────────
describe('date arithmetic');

// §2n — months are added by calendar and clamped, never approximated in days.
check('31 Dec + 2 months clamps to 28 Feb', app.lgAddMonths('2025-12-31', 2), '2026-02-28');
check('31 Aug + 6 months clamps to 28 Feb', app.lgAddMonths('2026-08-31', 6), '2027-02-28');
check('31 Dec 2027 + 2 months hits the leap day', app.lgAddMonths('2027-12-31', 2), '2028-02-29');
check('31 Jan + 1 month clamps',              app.lgAddMonths('2026-01-31', 1), '2026-02-28');
check('mid-month is untouched',               app.lgAddMonths('2026-08-12', 2), '2026-10-12');
check('adding months crosses the year',       app.lgAddMonths('2026-11-15', 3), '2027-02-15');

// §2b — dates are formatted from local parts. toISOString() shifted every date
// back a day in IST (UTC+5:30), so 30 Sep was emitted as 29 Sep.
check('30 days from 12 Aug',  app.lodrAddDays('2026-08-12', 30), '2026-09-11');
check('15 days from 20 Aug',  app.lodrAddDays('2026-08-20', 15), '2026-09-04');
check('45 days from 30 Jun',  app.lodrAddDays('2026-06-30', 45), '2026-08-14');
check('adding days over a leap day', app.lodrAddDays('2028-02-28', 1), '2028-02-29');
check('adding days across a year end', app.lodrAddDays('2026-12-31', 1), '2027-01-01');

// ── 2. Financial year handling ──────────────────────────────
describe('financial year');

// Session history: lodrLast() walked back into the previous FY, producing a Q2
// obligation dated 21 Oct 2025 and reported as "307 days overdue".
check('Q1 end falls inside the FY in progress', app.lodrInFY(6, 30),  '2026-06-30');
check('Q2 end falls inside the FY in progress', app.lodrInFY(9, 30),  '2026-09-30');
check('Q3 end falls inside the FY in progress', app.lodrInFY(12, 31), '2026-12-31');
check('Q4 end is next March, not last',        app.lodrInFY(3, 31),  '2027-03-31');

// ── 3. A period end is not a deadline (§2k) ─────────────────
describe('period end is not a deadline');

{
  const rows = rowsFor(LISTED);
  const dated = rows.filter(r => r.due);
  const onFyEnd = dated.filter(r => r.due === '2027-03-31');

  ok('the register is not empty', rows.length > 200, rows.length);
  ok('no pile of obligations on the FY end', onFyEnd.length <= 2,
     onFyEnd.length + ' rows dated 2027-03-31');

  // Every remaining date must come from a stated offset, not from a period end.
  const derivedWithDate = dated.filter(r => r.dueConfidence === 'derived');
  check('no dated row still reports itself as derived', derivedWithDate.length, 0);

  // Quarterly occurrences survive losing their invented dates.
  const q = rows.filter(r => /Reg 13\(3\)/.test(String(r.section)));
  check('a quarterly rule keeps four occurrences', q.length, 4);
  check('and none of them carries a deadline', q.filter(r => r.due).length, 0);
  check('but each keeps its real period end',
        q.map(r => r.periodEnd).sort(),
        ['2026-06-30', '2026-09-30', '2026-12-31', '2027-03-31']);
}

// ── 4. Offsets the rules actually state (§2k stage 2) ───────
describe('stated offsets');

check('Reg 33(3)(a) — 45 days after Q1',        dueOf(LISTED, 'Reg 33(3)(a)'), '2026-08-14');
check('Reg 33(3)(b) — 45 days after Q1',        dueOf(LISTED, 'Reg 33(3)(b)'), '2026-08-14');
check('Reg 24A(2) — 60 days after the FY end',  dueOf(LISTED, 'Reg 24A(2)'),   '2026-05-30');
check('Reg 44(5) — 5 months, so 31 August',     dueOf(LISTED, 'Reg 44(5)'),    '2026-08-31');
check('Reg 31(1)(b) proviso — 21 days after the half year',
      dueOf(LISTED, 'Reg 31(1)(b) proviso'), '2026-10-21');

// Event-anchored rules must stay undated until their anchor is recorded.
check('Reg 47(1) has no date without a results meeting', dueOf(LISTED, 'Reg 47(1)'), null);
check('Reg 34(1)(b) has no date without an AGM',        dueOf(LISTED, 'Reg 34(1)(b)'), null);

// ── 5. Statutory deadlines that are simply known ────────────
describe('known statutory dates');

check('Sec 96 — AGM by 30 September',       dueOf(LISTED, 'Section 96'), '2026-09-30');
check('Sec 137 — AOC-4 by 30 October',      dueOf(LISTED, 'Section 137; Accounts Rules'), '2026-10-30');
check('Sec 405 — MSME-1 by 31 October',
      dueOf(LISTED, 'Section 405; Specified Companies Order as amended'), '2026-10-31');

// A December year end must not inherit March dates (§2c units/FY trap).
{
  const decAgm = dueOf(DEC_FY, 'Section 96');
  ok('a December year end does not inherit a March-based AGM date',
     decAgm !== '2026-09-30', 'AGM computed as ' + decAgm);
}

// ── 6. Registers drive real deadlines ───────────────────────
describe('registers');

setRegisters({
  meetings: [
    { id: 'm1', company_id: 'T-LISTED', kind: 'board', held_on: '2026-05-20',
      minutes_state: 'signed', minutes_signed_on: '2026-06-10' },
    { id: 'm2', company_id: 'T-LISTED', kind: 'board', held_on: '2026-08-05',
      approved_results: true, minutes_state: 'drafted' },
    { id: 'm3', company_id: 'T-LISTED', kind: 'agm', held_on: '2026-09-25',
      auditor_appointed: true },
    { id: 'm4', company_id: 'T-LISTED', kind: 'board', held_on: '2026-07-10' }
  ],
  charges: [
    { id: 'c1', company_id: 'T-LISTED', holder: 'HDFC Bank', created_on: '2026-08-12' },
    { id: 'c2', company_id: 'T-LISTED', holder: 'ICICI Bank', created_on: '2024-02-01',
      chg1_filed_on: '2024-02-15', satisfied_on: '2026-08-20' }
  ],
  allotments: [
    { id: 'a1', company_id: 'T-LISTED', route: 'private_placement', security: 'equity',
      allotted_on: '2026-08-20', number: 100000 },
    { id: 'a2', company_id: 'T-LISTED', route: 'rights', security: 'equity',
      allotted_on: '2026-08-20', number: 50000 },
    { id: 'a3', company_id: 'T-LISTED', route: 'preferential', security: 'debenture',
      allotted_on: '2026-07-01', number: 2000 },
    { id: 'a4', company_id: 'T-LISTED', route: 'subscribers', security: 'equity',
      allotted_on: '2026-06-01', number: 10000 }
  ],
  beneficial_interests: [
    { id: 'b1', company_id: 'T-LISTED', kind: 'bi', change_on: '2026-07-01',
      received_on: '2026-08-10', beneficial_owner: 'A Trust' },
    { id: 'b2', company_id: 'T-LISTED', kind: 'bi', change_on: '2026-08-01',
      beneficial_owner: 'Not yet received' }
  ]
});

{
  const rows = rowsFor(LISTED);
  const bySection = (s) => rows.filter(r => String(r.section) === s);
  const byForm = (f) => rows.filter(r => String(r.form) === f);

  // §2l — a deadline that runs from a meeting, computed from the meeting.
  const r47 = rows.filter(r => String(r.section) === 'Reg 47(1)');
  const q1 = r47.filter(r => /Q1/.test(r.obligation))[0];
  check('Reg 47(1) Q1 — 48 hours after the results meeting', (q1 || {}).due, '2026-08-07');
  check('later quarters stay undated with no results meeting for them',
        r47.filter(r => r.due).length, 1);
  check('Reg 34(1)(b) — 48 hours after the AGM', dueOf(LISTED, 'Reg 34(1)(b)'), '2026-09-27');

  // §2l — Section 118 minutes, one obligation per meeting, 30 days each.
  const minutes = bySection('Sec 118(1)');
  check('one minutes obligation per meeting held this FY', minutes.length, 4);
  check('minutes for the 20 May meeting fall due 19 June',
        (minutes.filter(r => /20 May/.test(r.obligation))[0] || {}).due, '2026-06-19');

  // §2q — ADT-1 from the meeting that appointed the auditor.
  const adt1 = byForm('ADT-1');
  check('ADT-1 — 15 days after the appointing meeting', (adt1[0] || {}).due, '2026-10-10');
  check('an ordinary board meeting raises no ADT-1', adt1.length, 1);

  // §2m — charges.
  check('CHG-1 — 30 days from creation',
        (rows.filter(r => r.key === 'chg-reg-c1')[0] || {}).due, '2026-09-11');
  check('CHG-4 — 30 days from satisfaction',
        (rows.filter(r => r.key === 'chg-sat-c2')[0] || {}).due, '2026-09-19');

  // §2n — allotments. The periods differ by route and by security.
  check('PAS-3 — 15 days for a private placement (s.42(8))',
        (rows.filter(r => r.key === 'allot-pas3-a1')[0] || {}).due, '2026-09-04');
  check('PAS-3 — 30 days for every other route',
        (rows.filter(r => r.key === 'allot-pas3-a2')[0] || {}).due, '2026-09-19');
  check('certificates — 2 months for shares (s.56(4)(b))',
        (rows.filter(r => r.key === 'allot-cert-a1')[0] || {}).due, '2026-10-20');
  check('certificates — 6 months for debentures (s.56(4)(d))',
        (rows.filter(r => r.key === 'allot-cert-a3')[0] || {}).due, '2027-01-01');
  check('subscribers to the memorandum raise no obligation at all',
        rows.filter(r => /allot-\w+-a4/.test(r.key)).length, 0);

  // §2o — the company's clock runs from receipt, not from the change.
  check('MGT-6 — 30 days from receipt, not from the change',
        (rows.filter(r => r.key === 'ben-b1')[0] || {}).due, '2026-09-09');
  check('a declaration not yet received raises nothing',
        rows.filter(r => r.key === 'ben-b2').length, 0);
}

// ── 7. Applicability (§2j) ──────────────────────────────────
describe('applicability');

setRegisters();
{
  const listedRows = rowsFor(LISTED);
  const privateRows = rowsFor(PRIVATE);

  ok('a listed entity carries far more than a private one',
     listedRows.length > privateRows.length * 2,
     listedRows.length + ' vs ' + privateRows.length);

  check('a private company has no LODR obligations',
        privateRows.filter(r => /LODR/.test(String(r.law))).length, 0);
  check('a private company has no PIT obligations',
        privateRows.filter(r => /PIT/.test(String(r.law))).length, 0);
  ok('a listed entity does have LODR obligations',
     listedRows.filter(r => /LODR/.test(String(r.law))).length > 100,
     listedRows.filter(r => /LODR/.test(String(r.law))).length);

  // §2j — conditions the engine cannot evaluate must be surfaced, not assumed.
  const conds = app.appConditions(LISTED);
  ok('conditional applicability is surfaced for review', conds.length > 5, conds.length);
  ok('and covers a meaningful number of obligations',
     conds.reduce((a, g) => a + g.rows.length, 0) > 20,
     conds.reduce((a, g) => a + g.rows.length, 0));
}

// ── 8. Thresholds (§2b) ─────────────────────────────────────
describe('thresholds');
{
  // Stored in RUPEES. The figures were once 10x low, so each limb is checked
  // at its boundary and just below it.
  const mk = (over) => Object.assign({}, PRIVATE, over);
  const hasCSR = (c) => rowsFor(c).some(r => /CSR|135/.test(String(r.section)));

  // Sec 135: net worth >= 500cr, turnover >= 1000cr, or net profit >= 5cr.
  ok('CSR applies at net profit of exactly Rs 5 crore',
     hasCSR(mk({ netprofit: 50000000 })), 'not applied');
  ok('CSR applies at turnover of exactly Rs 1000 crore',
     hasCSR(mk({ turnover: 10000000000 })), 'not applied');
  ok('CSR applies at net worth of exactly Rs 500 crore',
     hasCSR(mk({ networth: 5000000000 })), 'not applied');
}

// ── 9. Citation parsing (§2h) ───────────────────────────────
describe('citation parsing');
{
  const p = app.trkParseCites;
  // A case-insensitive [A-Z] with \s* before it swallowed the next word's first
  // letter: "Regulation 30 of LODR" parsed as regulation "30O".
  check('"Regulation 30 of LODR" is regulation 30', p('Regulation 30 of LODR').regs, ['30']);
  check('"Section 117 and Rule 24" splits correctly',
        [p('Section 117 and Rule 24').secs, p('Section 117 and Rule 24').rules],
        [['117'], ['24']]);
  check('a real suffix survives', p('Section 129A of the Companies Act').secs, ['129A']);
  check('a range yields both ends', p('Sections 73-76A of the Act').secs, ['73', '76A']);
  check('prose with no citation yields none', p('SEBI Board Meeting outcome').any, false);
}

// ── 10. Event and minutes matching (§2f, §2g) ───────────────
describe('event matching');
{
  // A private company is never shown LODR disclosures — they are not its
  // obligations, so listing them would be wrong, not merely noisy.
  check('a private company gets no LODR disclosures',
        app.impAssess('a director resigned', PRIVATE).disclosures.length, 0);
  ok('a listed entity does get them',
     app.impAssess('a director resigned', LISTED).disclosures.length > 0,
     'none');
  check('unintelligible text resolves to no concept',
        app.impAssess('the weather was nice today', LISTED).concepts.length, 0);

  // §2g — minutes are written in the passive voice.
  const approved = app.mgt14Assess(
    'RESOLVED THAT the audited financial statements of the Company for the financial year ' +
    'ended 31 March 2026, together with the Board\'s Report, be and are hereby approved.', LISTED);
  ok('179(3)(g) fires on an approval of accounts written passively',
     approved && approved.hits.some(h => h.limb === '179(3)(g)'),
     approved ? approved.hits.map(h => h.limb).join(',') : 'no hits');

  // The private-company exemption covers the 179(3) route only.
  const borrow = app.mgt14Assess('RESOLVED THAT the Company do borrow Rs 5 crore.', PRIVATE);
  ok('a private company borrowing flags the 117(3)(g) exemption',
     borrow && borrow.privateExempt === true, borrow ? borrow.privateExempt : 'no hits');
  const special = app.mgt14Assess(
    'RESOLVED THAT as a SPECIAL RESOLUTION the Articles be altered.', PRIVATE);
  ok('but a special resolution is still filed by a private company',
     special && special.privateExempt === false,
     special ? special.privateExempt : 'no hits');

  // §2g — RESOLVED FURTHER THAT continues the resolution above it.
  const split = app.impSplitMinutes(
    'ITEM NO. 1 — ACCOUNTS\nRESOLVED THAT the accounts be approved.\n\n' +
    'ITEM NO. 2 — BORROWING\nRESOLVED THAT the Company do borrow Rs 50 crore.\n' +
    'RESOLVED FURTHER THAT a charge be created over the plant.');
  check('minutes split into two decisions', split.length, 2);
  // The bug this guards: splitting before the LINE holding "RESOLVED THAT"
  // stranded each ITEM heading and handed the NEXT item's heading to the
  // PREVIOUS resolution — so the accounts resolution was reported as needing
  // MGT-14 under 179(3)(d), to borrow monies. Asserting only the chunk count
  // does not discriminate; asserting where each heading lands does.
  ok('the next item heading does not leak into the first decision',
     !/ITEM NO\. 2|BORROWING/.test(split[0]), split[0].slice(0, 90));
  ok('the second decision owns its own heading',
     /ITEM NO\. 2/.test(split[1]) && /BORROWING/.test(split[1]), split[1].slice(0, 90));
  ok('RESOLVED FURTHER THAT stays with its own resolution',
     /RESOLVED FURTHER/.test(split[1]) && !/RESOLVED FURTHER/.test(split[0]),
     split.map(s => s.slice(0, 30)));
}

// ── 11. Status resolution (§2d, §2k) ────────────────────────
describe('status');
{
  const rows = rowsFor(LISTED);
  const states = {};
  rows.forEach(r => {
    const st = app.lgResolveStatus(r, LISTED);
    states[st.state] = (states[st.state] || 0) + 1;
  });

  // The engine may never claim a breach: no filing source is connected.
  check('nothing is ever reported as a breach', states.BREACH || 0, 0);
  ok('undated obligations are carried as standing or no-deadline',
     (states.STANDING || 0) + (states.NO_DEADLINE || 0) > 100,
     JSON.stringify(states));

  // §2k — null >= 0 is true in JavaScript, so an undated row must never be
  // counted by a date-driven bucket.
  const undated = rows.filter(r => !r.due);
  const leaked = undated.filter(r => !app.lgNoDate(app.lgResolveStatus(r, LISTED).state));
  check('no undated row escapes the no-date guard', leaked.length, 0);

  // The two undated states are different facts and must be counted separately —
  // asserting them together let one collapse into the other unnoticed.
  ok('some obligations are STANDING — no deadline exists',
     (states.STANDING || 0) > 20, states.STANDING || 0);
  ok('others are NO_DEADLINE — a period recurs but no deadline is recorded',
     (states.NO_DEADLINE || 0) > 20, states.NO_DEADLINE || 0);
}

// ── 11b. Not applicable, as decided by a person (§2j) ───────
describe('not applicable');
{
  const rows = rowsFor(LISTED);
  const target = rows.filter(r => r.due)[0] || rows[0];

  const marked = Object.assign({}, LISTED, {
    chart: { [target.key]: { notApplicable: true, naReason: 'No subsidiaries', naBy: 'test' } }
  });

  // getComplianceChart is what copies notApplicable from the chart onto the row,
  // and lgResolveStatus reads it from the row — so the row has to come from the
  // marked company, not from the unmarked one.
  const markedRow = app.getComplianceChart(marked, { includeNA: true })
    .filter(r => r.key === target.key)[0];

  ok('the row carries the user decision', !!(markedRow && markedRow.userNA),
     markedRow ? 'userNA=' + markedRow.userNA : 'row not found');

  // The status engine must honour it...
  check('a row the user ruled out resolves to NOT_APPLICABLE',
        app.lgResolveStatus(markedRow, marked).state, 'NOT_APPLICABLE');
  check('and carries the reason given',
        app.lgResolveStatus(markedRow, marked).naReason, 'No subsidiaries');

  // ...and the register must drop it, which is what makes the coverage
  // denominator shrink when a condition is ruled out.
  const after = app.getComplianceChart(marked);
  check('and the register no longer returns it', after.filter(r => r.key === target.key).length, 0);
  check('the register shrinks by exactly that row', after.length, rows.length - 1);

  // ...unless it is asked for explicitly, which the applicability review needs.
  const withNA = app.getComplianceChart(marked, { includeNA: true });
  check('includeNA brings it back', withNA.filter(r => r.key === target.key).length, 1);
}

// ── 11c. The PIT trading window (§2w) ───────────────────────
// Schedule B cl. 4(2): closed from the end of every quarter until 48 hours
// after the declaration of financial results. cl. 5: reopening no earlier than
// 48 hours after the information becomes generally available.
describe('PIT trading window');
{
  const win = (regs) => {
    app.LG_REGS = Object.assign(
      { directors: [], meetings: [], charges: [], allotments: [],
        beneficial_interests: [], designated_persons: [], upsi_events: [],
        upsi_access: [], pre_clearances: [] }, regs || {});
    return app.pitWindow(LISTED);
  };
  const board = (held, results) => ({
    id: 'w1', company_id: 'T-LISTED', kind: 'board', held_on: held,
    approved_results: results !== false });

  // Frozen at 29 Aug 2026, so the quarter in question ended 30 June.
  check('the quarter end it works from', win({}).quarterEnd, '2026-06-30');

  check('closed while no results meeting has been recorded since the quarter end',
        win({}).state, 'closed');
  check('and it cites the clause',
        win({}).because[0].cite, 'Schedule B cl. 4(2)');

  check('a non-results board meeting does not reopen it',
        win({ meetings: [board('2026-08-05', false)] }).state, 'closed');

  check('results approved 5 Aug reopened it on 7 Aug',
        win({ meetings: [board('2026-08-05')] }).state, 'open');
  check('and the reopening date is 48 hours after',
        win({ meetings: [board('2026-08-05')] }).reopensOn, '2026-08-07');

  check('results approved yesterday leave it closed',
        win({ meetings: [board('2026-08-28')] }).state, 'closed');

  // An open UPSI item the compliance officer has marked as closing it.
  const withUpsi = (u) => win({
    meetings: [board('2026-08-05')],
    upsi_events: [Object.assign({ id: 'u1', company_id: 'T-LISTED',
      particulars: 'Proposed acquisition' }, u)] });

  check('unpublished UPSI marked as closing holds it shut',
        withUpsi({ arose_on: '2026-08-20', window_closed: true }).state, 'closed');
  check('cited to the clause that makes it a judgement',
        withUpsi({ arose_on: '2026-08-20', window_closed: true }).because[0].cite,
        'Schedule B cl. 4(1)');

  // The 2025 proviso: UPSI not emanating from within the company need not close it.
  check('UPSI not marked as closing leaves it open',
        withUpsi({ arose_on: '2026-08-20', window_closed: false }).state, 'open');

  check('published yesterday, still inside the 48 hours',
        withUpsi({ published_on: '2026-08-28', window_closed: true }).state, 'closed');
  check('and cites the reopening clause',
        withUpsi({ published_on: '2026-08-28', window_closed: true }).because[0].cite,
        'Schedule B cl. 5');
  check('published long enough ago, it reopens',
        withUpsi({ published_on: '2026-08-01', window_closed: true }).state, 'open');
}

setRegisters();

// ── 12. Dashboard invariants ────────────────────────────────
describe('dashboard invariants');
{
  app.CLIENTS = [LISTED, PRIVATE];
  const s = app.ccComputeStats();

  check('the health gauge measures coverage, never a breach claim', s.breach, 0);

  // The legend must partition the whole. It has failed to three times.
  const scheduled = (s.upcoming || 0) + (s.dueThisWeek || 0);
  const bands = (s.confirmed || 0) + (s.pendingConf || 0) + (s.pastDue || 0) +
                scheduled + (s.standing || 0) + (s.noDeadline || 0) + (s.notApplicable || 0);
  check('the coverage legend sums to the total', bands, s.totalObligations);

  const byLaw = {};
  [LISTED, PRIVATE].forEach(c => rowsFor(c).forEach(r => {
    byLaw[r.law] = (byLaw[r.law] || 0) + 1;
  }));
  check('the by-law legend sums to the total',
        Object.values(byLaw).reduce((a, b) => a + b, 0), s.totalObligations);
}

process.exit(report());
