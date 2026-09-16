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

  // Quarterly occurrences survive losing their invented dates. Reg 17(3) is the
  // example because it is genuinely undated — the regulation says the board
  // reviews compliance reports "periodically" and fixes no interval. (Reg 13(3)
  // stood here until §3f, when the Master Circular supplied its period.)
  const q = rows.filter(r => /Reg 17\(3\)/.test(String(r.section)));
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

// ── 11d. Statutory calculators ──────────────────────────────
// Every figure here traces to a section in reference/companies-act-2013.
const CR = 10000000;

describe('section 198 — calculation of profits');
{
  // s.198(1): credit for (2), none for (3); (4) deducted, (5) not deducted.
  const r = app.calc198Compute({
    pbt: 10 * CR,     // profit before tax per the books
    a5a: 2 * CR,      // income-tax charged — s.198(5)(a), added back
    l3c: 1 * CR,      // capital profits credited — s.198(3)(c), removed
    l4l: 0.5 * CR     // earlier years' excess of expenditure — s.198(4)(l)
  });
  check('net profit under s.198', r.total, 10.5 * CR);
  check('the working shows every line that moved', r.lines.length, 4);
  check('the first line is the starting point', r.lines[0].base, true);

  // Direction matters more than magnitude: a (5) item that subtracts, or a (3)
  // item that adds, produces a plausible number that is wrong.
  check('a s.198(5) item is ADDED back',
        app.calc198Compute({ pbt: 100, a5a: 50 }).total, 150);
  check('a s.198(3) credit is REMOVED',
        app.calc198Compute({ pbt: 100, l3a: 50 }).total, 50);
  check('a s.198(4) deduction is SUBTRACTED',
        app.calc198Compute({ pbt: 100, l4k: 50 }).total, 50);
  check('a s.198(2) subsidy is ADDED', app.calc198Compute({ pbt: 100, a2: 50 }).total, 150);
  check('an empty working returns the profit unchanged',
        app.calc198Compute({ pbt: 100 }).total, 100);
}

describe('section 197 — managerial remuneration');
{
  // s.197(1) computes on the s.198 figure "except that the remuneration of the
  // directors shall not be deducted from the gross profits".
  const L = app.calc197Limits(10 * CR, 2 * CR, true, true);
  check('remuneration charged is added back to the base', L.base, 12 * CR);
  check('overall ceiling is eleven per cent', L.rows[0].amt, 1.32 * CR);
  check('one managing or whole-time director — five per cent', L.rows[1].amt, 0.6 * CR);
  check('more than one, taken together — ten per cent', L.rows[2].amt, 1.2 * CR);

  // The fourth row switches rate on whether an MD/WTD/manager exists.
  check('non-executives get one per cent where there is an MD or WTD',
        L.rows[3].pct, 1);
  check('and three per cent where there is not',
        app.calc197Limits(10 * CR, 0, false, true).rows[3].pct, 3);
  check('the citation follows the rate',
        app.calc197Limits(1, 0, false, true).rows[3].cite,
        's.197(1), second proviso (ii)(B)');

  // s.197(1) binds a PUBLIC company. Applying it to a private one would be a
  // ceiling that does not exist.
  check('it does not bind a private company',
        app.calc197Limits(10 * CR, 0, true, false).applies, false);
  check('it binds a public one', app.calc197Limits(10 * CR, 0, true, true).applies, true);
}

describe('section 135 — CSR spend');
{
  // The Explanation to s.135: net profit "shall be calculated in accordance
  // with the provisions of section 198".
  const C = app.calcCSRSpend(10 * CR, 8 * CR, 6 * CR, 3);
  check('average of the three preceding years', C.average, 8 * CR);
  check('two per cent of that average', C.spend, 0.16 * CR);

  // s.135(9): no Committee where the amount "does not exceed fifty lakh
  // rupees" — so exactly fifty lakh is on the no-Committee side.
  check('a spend of exactly fifty lakh needs no CSR Committee',
        app.calcCSRSpend(25 * CR, 25 * CR, 25 * CR, 3).committeeRequired, false);
  check('and the spend at that point is fifty lakh',
        app.calcCSRSpend(25 * CR, 25 * CR, 25 * CR, 3).spend, 5000000);
  check('a rupee more does need one',
        app.calcCSRSpend(25 * CR, 25 * CR, 25.0001 * CR, 3).committeeRequired, true);

  // The 2019 insertion: a company that has not completed three years averages
  // over the years it has.
  check('fewer than three years averages over those it has',
        app.calcCSRSpend(30 * CR, 0, 0, 1).average, 30 * CR);
  check('a loss-making average produces no minimum spend',
        app.calcCSRSpend(-5 * CR, -5 * CR, -5 * CR, 3).negative, true);
}

describe('section 186 — loan and investment limit');
{
  // "sixty per cent. of its paid-up share capital, free reserves and securities
  // premium account or one hundred per cent. of its free reserves and
  // securities premium account, whichever is more."
  const M = app.calc186Limit(10 * CR, 2 * CR, 1 * CR, 5 * CR, 4 * CR);
  check('sixty per cent limb', M.sixty, 7.8 * CR);
  check('one hundred per cent limb', M.hundred, 3 * CR);
  check('the limit is the larger', M.limit, 7.8 * CR);
  check('and it says which limb won', M.which, 'sixty');
  check('nine crore against a 7.8 crore limit exceeds it', M.exceeds, true);
  check('headroom is negative by the excess', M.headroom, -1.2 * CR);

  // Both limbs must be able to win, or "whichever is more" is not implemented.
  const M2 = app.calc186Limit(1 * CR, 20 * CR, 0, 0, 0);
  check('free reserves can carry the hundred per cent limb', M2.which, 'hundred');
  check('and the limit follows it', M2.limit, 20 * CR);
}

describe('section 403 — the fee, and the penalty beside it');
{
  check('a filing made before the due date attracts none',
        app.calc403Fee('mgt7', '2026-10-30', '2026-10-20').late, false);
  const F = app.calc403Fee('mgt7', '2026-10-30', '2026-11-29');
  check('days late are counted from the due date', F.days, 30);
  check('at one hundred rupees a day — first proviso to s.403(1)', F.fee.amount, 3000);
  check('and the section it is filed under is named', F.fee.section, '92');
  check('AOC-4 is priced under section 137',
        app.calc403Fee('aoc4', '2026-10-30', '2026-11-29').fee.section, '137');
  check('missing dates are refused', !!app.calc403Fee('mgt7', '', '').error, true);
  check('an unknown form is refused', !!app.calc403Fee('zzz', '2026-10-30', '2026-11-29').error, true);

  // ── the FEE is refused for other forms; the PENALTY is not ──
  // This is the whole change. The Fees Rules are not in reference/, so the fee
  // still cannot be priced for any form but s.92 and s.137 — but the penalty is
  // in the Act, and refusing THAT as well was the defect. Both halves are
  // asserted, because asserting only the first is what let it stand.
  const O = app.calc403Fee('other', '2026-10-30', '2026-11-29');
  check('the additional fee is refused for any other form', O.feeUnpriced, true);
  check('and no fee figure is invented', O.fee, undefined);
  check('but the penalty IS computed', O.pen.co.amount, 10000 + 29 * 1000);
  check('and it still says how late it is', O.days, 30);

  // ── the maximum, which is the thing that was missing ──
  const LONG = app.calc403Fee('mgt7', '2016-11-29', '2027-11-01');
  check('the company penalty stops at two lakh — s.92(5)', LONG.pen.co.amount, 200000);
  check('and reports that it was capped', LONG.pen.co.capped, true);
  check('the officer penalty stops at fifty thousand', LONG.pen.off.amount, 50000);
  check('the uncapped figure is kept, so the working can show what was cut',
        LONG.pen.co.uncapped, 10000 + (LONG.days - 1) * 100);
  check('the fee has NO maximum and keeps running past it',
        LONG.fee.amount, LONG.days * 100);
  check('the day the cap bit is named', LONG.pen.coCapDate, '2022-02-12');
  check('a penalty short of its cap does not claim one', F.pen.co.capped, false);
  check('and names no cap date', F.pen.coCapDate, undefined);

  // ── "each day" vs "each day after the first" ──
  // Both counts live inside s.137(3): the company pays for every day, the MD
  // and CFO for each day after the first. One day of penalty separates them,
  // and a uniform implementation gets one of the two legs wrong every time.
  const A1 = app.calc403Fee('aoc4', '2026-10-30', '2026-10-31');   // one day late
  check('s.137(3), company — the first day already carries a day of penalty',
        A1.pen.co.amount, 10100);
  check('s.137(3), officers — the first day carries none',
        A1.pen.off.amount, 10000);
  check('s.92(5) counts both legs after the first',
        app.calc403Fee('mgt7', '2026-10-30', '2026-10-31').pen.co.amount, 10000);
  check('and the leg records which count it used', A1.pen.co.dayFrom, 'each-day');
  check('while its own officer leg records the other', A1.pen.off.dayFrom, 'after-first');

  // ── the three shapes the Act actually uses ──
  const CH = app.calc403Fee('chg', '2026-10-30', '2026-11-29');
  check('s.86(1) is a fixed amount, not a daily one', CH.pen.co.kind, 'flat');
  check('five lakh on the company from the first day', CH.pen.co.amount, 500000);
  check('and it does not grow with the delay',
        app.calc403Fee('chg', '2016-10-30', '2026-11-29').pen.co.amount, 500000);
  check('a flat penalty claims no maximum', CH.pen.co.cap, undefined);

  const AD = app.calc403Fee('adt1', '2026-10-30', '2026-11-29');
  check('s.147(1) is a FINE, fixed by a court, not a penalty', AD.pen.kind, 'fine');
  check('so it is stated as a range', AD.pen.co.min, 25000);
  check('and its ceiling is the top of that range', AD.pen.co.max, 500000);
  check('a fine has no computed amount, because there is not one to compute',
        AD.pen.co.amount, undefined);

  // ── every form in the table answers something ──
  // The user's complaint was that choosing anything but two forms produced
  // nothing. Every entry must now yield either a fee or a penalty.
  let silent = [];
  app.CALC_FEE_FORMS.forEach(f => {
    const R = app.calc403Fee(f.key, '2026-10-30', '2026-11-29');
    if (!R.fee && !R.pen) silent.push(f.key);
  });
  check('no form on the list answers with nothing', silent.join(','), '');
  check('and only s.92 and s.137 filings carry a fee',
        app.CALC_FEE_FORMS.filter(f => f.fee).map(f => f.key).join(','), 'mgt7,aoc4');

  // Every penalty quotes the provision it comes from. A figure a client cannot
  // trace is a figure the CS cannot sign — and these are figures a CS repeats
  // to a director.
  let unquoted = [];
  app.CALC_FEE_FORMS.forEach(f => {
    if (f.pen && (!f.pen.words || f.pen.words.length < 80)) unquoted.push(f.key);
    if (f.pen && !f.pen.cite) unquoted.push(f.key + ':cite');
  });
  check('every penalty quotes its own provision', unquoted.join(','), '');

  // s.450 is a residual and must say so, or it will be read as the answer for a
  // form whose own section states a different one.
  check('s.450 is flagged as a residual', app.calc403Form('other').pen.residual, true);
  check('and the forms with their own penalty are not',
        !!app.calc403Form('mgt7').pen.residual, false);
}

describe('section 403 — the due date comes from the register');
{
  // A hand-typed due date is a date with nothing behind it — the §2k defect
  // arriving through the keyboard. The register already computes these.
  const c = { id: 'FEE-1', name: 'Fee Test Pvt Ltd', type: 'private',
              fyend: '2026-03-31', capital: 5e7, turnover: 2e8,
              cin: 'U12345MH2015PTC000001' };

  const m7 = app.calc403DueOptions(c, 'mgt7');
  check('MGT-7 takes its due date from the register', m7.length, 1);
  check('and it is the date the register shows', m7[0].due, '2026-11-29');
  check('the section it came from travels with it', m7[0].section, 'Section 92');
  check('so does the period it reports on', m7[0].periodEnd, '2026-03-31');

  const a4 = app.calc403DueOptions(c, 'aoc4');
  check('AOC-4 finds its own date', a4[0].due, '2026-10-30');
  check('and the three s.137 rows sharing that date collapse to one', a4.length, 1);

  // s.92(2) is the MGT-8 certification, not the annual return. Dating MGT-7
  // from it would be right by accident today and wrong the moment the two
  // diverge.
  // Tested through the MATCHER, not through the output. The MGT-8
  // certification falls due on the same day as the annual return, so a matcher
  // widened onto s.92(2) produces output identical to the correct one — the
  // mutation check found that blind spot, and it is the §3e lesson again: when
  // the data cannot exercise a guard, test the guard's contract.
  const hitsFor = (s) => app.CALC_FEE_FORMS.filter(f => f.match && f.match.test(s))
                            .map(f => f.key).join(',');
  check('s.92(2) is the MGT-8 certification, not the annual return',
        hitsFor('Section 92(2); Rule 11(2)'), '');
  check('and no MGT-7 option is offered under it',
        m7.filter(o => /92\(2\)/.test(o.section)).length, 0);
  check('nothing else of MGT-7s is hiding behind that date', m7[0].shared.length, 0);
  // AOC-4 is the case where rows really do share one: the accounts row and the
  // XBRL row both cite s.137 and fall due together. They collapse to a single
  // option and the count is KEPT, so a row swallowed by the dedupe cannot go
  // unnoticed the way the s.92(2) mutation did.
  check('the two s.137 rows collapse to one option', a4.length, 1);
  check('and the one it absorbed is counted', a4[0].shared.length, 1);
  check('the consolidated row cites s.129(3) and is not absorbed into it',
        hitsFor('Section 129(3); Accounts Rules'), '');

  // An event-driven obligation is correctly undated until the event is
  // recorded (§2m, §2n), so the calculator must find nothing rather than
  // supply something.
  check('an event-driven form offers no date until the event is recorded',
        app.calc403DueOptions(c, 'chg').length, 0);
  check('and the form with no section at all offers none',
        app.calc403DueOptions(c, 'other').length, 0);
  check('no company, no options', app.calc403DueOptions(null, 'mgt7').length, 0);

  // §3j: a date computed from a year end nobody entered must carry the warning
  // through to this screen too. It is the same date and the same assumption.
  const noFy = Object.assign({}, c, { fyend: null });
  check('an assumed year end is flagged on the due date offered here',
        app.calc403DueOptions(noFy, 'mgt7')[0].fyAssumed, true);
  check('and is not flagged when the year end is recorded',
        !!m7[0].fyAssumed, false);

  // The matchers decide which register rows belong to which form, and a
  // mismatch would price one filing against another's deadline. Checked
  // against the section strings the register actually emits.
  const hits = hitsFor;
  check('Section 92 is MGT-7 alone', hits('Section 92'), 'mgt7');
  check('Section 137; XBRL Rules is AOC-4', hits('Section 137; XBRL Rules'), 'aoc4');
  check('Section 129(3) is neither', hits('Section 129(3); Accounts Rules'), '');
  check('Section 128 is not mistaken for section 12',
        hits('Section 128; Accounts Rules'), '');
  check('Sections 123-125 is not mistaken for section 12',
        hits('Sections 123-125; IEPF Rules'), '');
  check('Sections 12, 15 is INC-22', hits('Sections 12, 15'), 'inc22');
  check('the register-derived Sec 82(1) reaches the charge forms',
        hits('Sec 82(1)'), 'chg');
  check('Sections 168, 170 is DIR-12', hits('Sections 168, 170 and rules'), 'dir12');
  check('Section 96 belongs to no form on this screen', hits('Section 96'), '');

  // No section string may resolve to two forms. A due date offered under two
  // different penalties is a fork the screen has no way to show.
  let ambiguous = [];
  ['Section 92', 'Section 92(2); Rule 11(2)', 'Section 137; Accounts Rules',
   'Section 137; XBRL Rules', 'Section 129(3); Accounts Rules',
   'Section 117 and applicable exemptions', 'Sections 168, 170 and rules',
   'Sections 39, 42; PAS Rules', 'Sections 77-87', 'Section 82', 'Sec 77(1)',
   'Sec 82(1)', 'Section 89', 'Section 90; SBO Rules', 'Sections 12, 15',
   'Section 405; Specified Companies Order as amended', 'Section 128; Accounts Rules',
   'Sections 123-125; IEPF Rules', 'Section 139', 'Sec 139(1), third proviso',
   'Section 96', 'Section 121', 'Section 134; Accounts Rules', 'Sec 118(1)',
   'Sec 173(1)', 'Section 135; CSR Rules'].forEach(s => {
    if (hits(s).split(',').filter(Boolean).length > 1) ambiguous.push(s);
  });
  check('no register section resolves to two forms', ambiguous.join(' | '), '');
}

describe('the spreadsheet importer — every figure arrives through here');
{
  const money = (s) => app.bulkMoney(s);
  const val   = (s) => money(s).value;

  // ── the bug this had for as long as it existed ────────────────
  // parseFloat("250lakh") is 250. It reads the leading digits and throws the
  // rest away, so a figure naming any unit but crore was stored as crore.
  // Rs 250 lakh is Rs 2.5 crore; read as 250 crore it crosses the s.204 MR-3
  // turnover limb and tells a client it owes a secretarial audit it does not.
  check('lakh is converted, not read as crore', val('250 lakh'), 2.5);
  check('and is nowhere near the figure it used to store', val('250 lakh') === 250, false);
  check('lac spelling too', val('250 lac'), 2.5);
  check('million', val('250 million'), 25);
  check('mn', val('250 mn'), 25);
  check('billion', val('2.5 bn'), 250);
  check('thousand', val('50 thousand'), 0.005);
  check('crore stays crore', val('250 crore'), 250);
  check('cr abbreviated', val('250 cr'), 250);
  check('a bare number is already crore', val('250'), 250);

  // ── refused, not partly read ──────────────────────────────────
  // The strict full-string test is the whole fix: the useful failure is "that
  // is not a number", never a plausible wrong figure.
  check('an unknown unit is refused', !!money('250 furlongs').issue, true);
  check('and yields no value at all', val('250 furlongs'), undefined);
  check('NIL is refused', !!money('NIL').issue, true);
  check('a dash is refused', !!money('-').issue, true);
  check('letters alone are refused', !!money('n/a').issue, true);
  check('the message names what was typed', /250 furlongs/.test(money('250 furlongs').issue), true);
  check('an empty cell is empty, not an error', money('').empty, true);
  check('and carries no issue', money('   ').issue, undefined);

  // ── what people actually type in Indian sheets ────────────────
  check('a rupee sign', val('₹250'), 250);
  check('Rs. with a stop', val('Rs. 250 crore'), 250);
  check('INR', val('INR 250'), 250);
  check('comma grouping', val('1,25,000'), 125000);
  check('a loss in brackets is negative', val('(12.5)'), -12.5);
  check('a signed negative', val('-12.5'), -12.5);
  check('decimals survive', val('2.75'), 2.75);

  // ── a wrong unit can still be a valid number ──────────────────
  // Pasting rupees into a crore column produces a figure the parser cannot
  // fault, so the size is questioned separately — and questioned, not refused.
  const big = app.bulkParse('Name,Turnover\nAcme,2500000000');
  check('rupees in a crore column are questioned',
        /rupees rather than crore/.test(big.rows[0]._issues.join(' ')), true);
  check('but the row is still imported', big.rows[0].turnover, 2500000000);
  const ok = app.bulkParse('Name,Turnover\nAcme,250');
  check('an ordinary figure is not questioned', ok.rows[0]._issues.length, 0);

  // ── the splitter ──────────────────────────────────────────────
  check('a quoted comma stays inside the field',
        app.bulkSplit('"Acme, Bharat & Co",250')[0], 'Acme, Bharat & Co');
  check('and the next field is intact', app.bulkSplit('"Acme, Bharat & Co",250')[1], '250');
  // Assembled from a constant so this file never holds three double-quotes in
  // a row. The patch script that produced it is a Python triple-quoted string,
  // and writing the sequence out — even inside a comment — closed it early.
  const dq = String.fromCharCode(34);
  check('a doubled quote is one quote',
        app.bulkSplit(dq + 'He said ' + dq + dq + 'yes' + dq + dq + dq + ',1')[0],
        'He said ' + dq + 'yes' + dq);
  check('a tab wins over commas — Excel pastes tabs',
        app.bulkSplit('A,B\tC,D').length, 2);

  // An unquoted grouped number makes more cells than headers, and the surplus
  // was dropped in silence: "2,50,00,000" arrived as "2".
  const wide = app.bulkParse('Name,Turnover\nAcme,2,50,00,000');
  check('a row wider than its header says so',
        /out of step|needs quotes/.test(wide.rows[0]._issues.join(' ')), true);
  const quoted = app.bulkParse('Name,Turnover\nAcme,"2,50,00,000"');
  check('quoted, the same figure reads whole', quoted.rows[0].turnover, 25000000);

  // ── headers, type and CIN ─────────────────────────────────────
  const al = app.bulkParse('Company Name,CIN No,Paid-up Capital,FY End\n' +
                           'Acme,U74999MH2015PTC123456,50,2026-03-31');
  check('header aliases resolve', al.rows[0].name, 'Acme');
  check('capital by alias', al.rows[0].capital, 50);
  check('the financial year end comes across', al.rows[0].fyend, '2026-03-31');
  check('the CIN fills in the type', al.rows[0].type, 'private');

  const bad = app.bulkParse('Name,CIN\nAcme,NOTACIN');
  check('a malformed CIN is flagged', /CIN:/.test(bad.rows[0]._issues.join(' ')), true);
  check('and the row survives to be corrected', bad.rows[0].name, 'Acme');

  const ut = app.bulkParse('Name,Type\nAcme,Partnership Firm');
  check('an unrecognised type defaults and says so',
        /Unrecognised type/.test(ut.rows[0]._issues.join(' ')), true);
  check('to private', ut.rows[0].type, 'private');
  check('a missing type defaults to private',
        app.bulkParse('Name\nAcme').rows[0].type, 'private');

  // ── two rows for one company ──────────────────────────────────
  // §2e makes duplicate detection the strongest free control on evidence. The
  // same mistake here creates two records for one entity.
  const dup = app.bulkParse('Name,CIN\nA,U74999MH2015PTC123456\nB,U74999MH2015PTC123456');
  check('a repeated CIN is flagged', /same CIN/.test(dup.rows[1]._issues.join(' ')), true);
  check('and names the line it clashes with', /line 2/.test(dup.rows[1]._issues.join(' ')), true);
  check('the first occurrence is left clean', dup.rows[0]._issues.length, 0);
  const dn = app.bulkParse('Name\nAcme Pvt Ltd\nACME PVT LTD');
  check('a repeated name is flagged whatever its case',
        /same name/.test(dn.rows[1]._issues.join(' ')), true);

  // ── refusing the whole paste ──────────────────────────────────
  check('a header with no data is refused',
        !!app.bulkParse('Name,CIN').error, true);
  check('a sheet with neither name nor CIN is refused',
        /Name.*CIN/.test(app.bulkParse('Foo,Bar\n1,2').error), true);
  check('and the refusal shows how the header was read',
        /Foo \| Bar/.test(app.bulkParse('Foo,Bar\n1,2').error), true);
  check('blank lines between rows are skipped',
        app.bulkParse('Name\nAcme\n\n\nBeta').rows.length, 2);
  check('nothing at all is refused', !!app.bulkParse('').error, true);

  // ── the unit the register actually stores ─────────────────────
  // §2c: storage is RUPEES, the UI is CRORE, and mixing them meant no
  // threshold ever fired. The importer reads crore, so the commit multiplies.
  check('the crore constant is a crore', app.ENT_CR, 10000000);
  check('so 250 crore is the s.204 turnover limb in rupees',
        val('250 crore') * app.ENT_CR, 2500000000);
}

describe('one render, one chart per company');
{
  const co = { id: 'PASS-1', name: 'Pass Test Ltd', type: 'listed', fyend: '2026-03-31',
               capital: 5e8, turnover: 8e9, cin: 'L15412WB1993PLC000001' };
  // A row marked not-applicable, so includeNA genuinely changes the answer and
  // the derivation below is actually being exercised.
  const firstKey = app.getComplianceChartRaw(co)[0].key;
  // The stored field is `notApplicable`; `userNA` is what getComplianceChart
  // puts on the row from it. Setting the wrong one made the two registers
  // identical, which would have let the derivation below pass untested.
  co.chart = {}; co.chart[firstKey] = { notApplicable: true };

  const sig = (a) => a.map(r => r.key + '@' + (r.due || '')).join('|');
  const raw   = { plain: app.getComplianceChartRaw(co),
                  na:    app.getComplianceChartRaw(co, {includeNA:true}),
                  yrs:   app.getComplianceChartRaw(co, {allYears:true}) };
  check('marking a row NA really does change the two registers',
        sig(raw.plain) === sig(raw.na), false);

  // ── the property that matters: same answer as no pass at all ──
  let got = {};
  app.lgChartPass(() => {
    got.plain = app.getComplianceChart(co);
    got.na    = app.getComplianceChart(co, {includeNA:true});
    got.yrs   = app.getComplianceChart(co, {allYears:true});
  });
  check('the plain register is unchanged by the pass', sig(got.plain), sig(raw.plain));
  check('the includeNA register is unchanged', sig(got.na), sig(raw.na));
  check('and allYears is unchanged', sig(got.yrs), sig(raw.yrs));
  check('outside a pass nothing is memoised at all',
        sig(app.getComplianceChart(co)), sig(raw.plain));

  // ── how many raw builds it takes ──────────────────────────────
  const countBuilds = (fn) => {
    let n = 0; const orig = app.getComplianceChartRaw;
    app.getComplianceChartRaw = function(){ n++; return orig.apply(this, arguments); };
    try { fn(); } finally { app.getComplianceChartRaw = orig; }
    return n;
  };
  check('the same chart twice is built once',
        countBuilds(() => app.lgChartPass(() => {
          app.getComplianceChart(co); app.getComplianceChart(co); })), 1);
  // The dashboard asks for both, and includeNA's only effect is one filter, so
  // the superset serves both. This is what took it from 60 builds back to 30.
  check('the plain chart is derived from the includeNA one',
        countBuilds(() => app.lgChartPass(() => {
          app.getComplianceChart(co); app.getComplianceChart(co, {includeNA:true}); })), 1);
  check('allYears is NOT derived — it is a different register',
        countBuilds(() => app.lgChartPass(() => {
          app.getComplianceChart(co); app.getComplianceChart(co, {allYears:true}); })), 2);
  check('and outside a pass every call builds',
        countBuilds(() => { app.getComplianceChart(co); app.getComplianceChart(co); }), 2);
  check('option order does not create a second key',
        countBuilds(() => app.lgChartPass(() => {
          app.getComplianceChart(co, {allYears:true, includeNA:true});
          app.getComplianceChart(co, {includeNA:true, allYears:true}); })), 1);

  // Each caller gets its own array, so one that sorts cannot reorder another's.
  app.lgChartPass(() => {
    const a1 = app.getComplianceChart(co);
    a1.sort((x, y) => String(x.key).localeCompare(String(y.key)));
    const a2 = app.getComplianceChart(co);
    check('a caller that sorts its copy does not reorder the next one',
          sig(a2), sig(raw.plain));
    a2.length = 0;
    check('nor one that empties it', app.getComplianceChart(co).length, raw.plain.length);

    // The includeNA branch takes a different route out (slice, not filter), so
    // it needs its own case — the plain branch builds a new array anyway, and
    // testing only that let an uncopied includeNA result through unnoticed.
    const n1 = app.getComplianceChart(co, {includeNA:true});
    n1.sort((x, y) => String(x.key).localeCompare(String(y.key)));
    check('the includeNA copy is a copy too',
          sig(app.getComplianceChart(co, {includeNA:true})), sig(raw.na));
    n1.length = 0;
    check('and emptying it leaves the next caller whole',
          app.getComplianceChart(co, {includeNA:true}).length, raw.na.length);
  });

  // ── it must not outlive the call that opened it ───────────────
  check('the pass is shut before it starts', app.LG_CHART_PASS, null);
  app.lgChartPass(() => { check('open inside', !!app.LG_CHART_PASS, true); });
  check('and shut again on a normal return', app.LG_CHART_PASS, null);
  try { app.lgChartPass(() => { throw new Error('boom'); }); } catch (e) { /* expected */ }
  check('a throw closes it too — this is the one that would go stale',
        app.LG_CHART_PASS, null);

  // Badges run inside renderCommandCenter and also on their own, so an inner
  // pass has to join the outer one instead of emptying it on the way out.
  let innerSaw = null, afterInner = null;
  app.lgChartPass(() => {
    app.getComplianceChart(co);
    app.lgChartPass(() => { innerSaw = !!app.LG_CHART_PASS; });
    afterInner = !!app.LG_CHART_PASS;
  });
  check('an inner pass sees the outer one', innerSaw, true);
  check('and does not close it on the way out', afterInner, true);
  check('re-entry does not discard what the outer pass held',
        countBuilds(() => app.lgChartPass(() => {
          app.getComplianceChart(co);
          app.lgChartPass(() => {});
          app.getComplianceChart(co); })), 1);

  // The dashboard is the reason this exists.
  const src = require('fs').readFileSync(process.env.LG_INDEX ||
    require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const rcc = src.slice(src.indexOf('function renderCommandCenter()'),
                        src.indexOf('function renderCommandCenterInner()'));
  check('the dashboard render opens a pass', /lgChartPass\(/.test(rcc), true);
}

describe('the register is paged, and says so');
{
  const rows = (n) => Array.from({length:n}, (_, i) => ({i}));
  const S = app.cuPageSlice;

  const a = S(rows(2122), 0, 100);
  check('a full page is a full page', a.rows.length, 100);
  check('and starts at the beginning', a.from, 0);
  check('2,122 rows at 100 a page is 22 pages', a.pageCount, 22);
  check('the true total travels with the page', a.matched, 2122);

  const b = S(rows(2122), 21, 100);
  check('the last page carries the remainder', b.rows.length, 22);
  check('and starts where the 21 full pages ended', b.from, 2100);
  check('the last row is the last row', b.rows[b.rows.length-1].i, 2121);

  // The one that bites: a filter shrinks the result while you sit on page 22.
  // Without the clamp the reader gets an empty table, which says "nothing
  // matches" about a register that matched 40 things.
  const c = S(rows(40), 21, 100);
  check('a page past the end is pulled back to the last one', c.page, 0);
  check('and shows the rows that are there', c.rows.length, 40);
  check('rather than an empty table', c.rows.length > 0, true);
  const d = S(rows(250), 9, 100);
  check('pulled back to the LAST page, not the first', d.page, 2);
  check('negative pages are clamped too', S(rows(250), -3, 100).page, 0);

  // Exactly one past the end — the case `>=` catches and `>` does not. Every
  // clamp assertion above passes with the off-by-one in place, because they all
  // sit far past the end where either test fires. The mutation check found it.
  const g = S(rows(250), 3, 100);          // 3 pages exist: 0, 1, 2
  check('page 3 of 3 pages is pulled back to page 2', g.page, 2);
  check('and shows the rows that are there, not an empty table', g.rows.length, 50);
  check('the first row of it is the 201st', g.rows[0].i, 200);

  // Boundaries, both sides.
  check('an exact multiple does not add an empty page', S(rows(200), 0, 100).pageCount, 2);
  check('one row over does', S(rows(201), 0, 100).pageCount, 3);
  check('one row under does not', S(rows(199), 0, 100).pageCount, 2);
  check('a single row is one page', S(rows(1), 0, 100).pageCount, 1);

  // An empty result is one empty page, not zero pages — pageCount 0 would make
  // "Page 1 of 0" and the clamp would compute page -1.
  const e = S(rows(0), 0, 100);
  check('no matches is still one page', e.pageCount, 1);
  check('on page zero', e.page, 0);
  check('with nothing on it', e.rows.length, 0);

  // Size 0 is the reader asking for everything, explicitly.
  const f = S(rows(2122), 0, 0);
  check('all rows means all rows', f.rows.length, 2122);
  check('and one page', f.pageCount, 1);
  check('so the pager has nothing to offer', f.from, 0);

  // The default has to be a page, not the whole register: rendering 2,122 rows
  // cost 39,890 DOM nodes and 1.36s of layout on a desktop.
  check('the register does not default to every row', app.CU_PAGE_SIZE > 0, true);
  check('and the default page is a sane size',
        app.CU_PAGE_SIZE >= 25 && app.CU_PAGE_SIZE <= 250, true);
  check('"all rows" is still offered',
        app.CU_PAGE_SIZES.some(o => o[0] === 0), true);

  // Anything that changes WHICH rows match must return to the first page, or
  // the reader is left among rows that have nothing to do with where they were.
  const src = require('fs').readFileSync(process.env.LG_INDEX ||
    require('path').join(__dirname, '..', 'index.html'), 'utf8');
  // Comments stripped. This is the SECOND time an assertion here matched the
  // comment that explains a bug rather than the code that fixes it — the res.ok
  // ordering check did exactly the same. Prose must not be able to satisfy or
  // break an assertion about code.
  const decomment = (s) => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  // Stops at whichever comes first: the closing brace on its own line, or the
  // next function. cuClear is a ONE-LINER, so slicing to '\n}' ran past it into
  // cuSort — and cuSort has a cuPageReset() of its own, so removing cuClear's
  // changed nothing the assertion could see. The mutation check found that too.
  const fnOf = (name) => {
    const i = src.indexOf('function ' + name + '(');
    const ends = [src.indexOf('\n}', i), src.indexOf('\nfunction ', i)].filter(x => x > i);
    return decomment(src.slice(i, Math.min.apply(null, ends)));
  };
  ['cuSetFilter', 'cuQuick', 'cuClear', 'cuSort'].forEach(fn => {
    check(fn + ' returns to the first page', /cuPageReset\(\)/.test(fnOf(fn)), true);
  });

  // The footer states the true total beside the page. A page that reads as the
  // whole register is the §3k defect — a filter that does not say it filtered.
  const ru = src.slice(src.indexOf('function renderUniverse()'),
                       src.indexOf('function cuSetFilter'));
  check('the footer names the matching total', /of <b>'\+matched\+'<\/b> matching/.test(ru), true);
  check('and the register total beside it', /on the register/.test(ru), true);

  // The export is the whole register, never the page — somebody keeps it.
  const ex = fnOf('cuExport');
  check('the export does not know about pages', /CU_PAGE|pageRows/.test(ex), false);
  check('it builds its own rows', /cuBuildRows\(\)/.test(ex), true);

  // The dead double-build: `var all=cuBuildRows()` sat in cuSetFilter, assigned
  // and never read, while renderUniverse built the same 2,122 rows again — so
  // every keystroke in the search box built the register twice.
  check('no discarded rebuild on the search path',
        /var all\s*=\s*cuBuildRows\(\)/.test(fnOf('cuSetFilter')), false);
}

describe('penalties — one source, and it is the verified one');
{
  // The Penalties screen kept its own copy of these figures and it had gone
  // stale by five years. It reads the verified table now.
  const v = app.lgPenaltyFor('AOC-4');
  check('AOC-4 resolves to the verified entry', v.pen.cite, 's.137(3)');
  check('and to the s.137 figures, not the pre-2020 ones', v.pen.co.day, 100);
  check('with the maximum the 2020 amendment introduced', v.pen.co.cap, 200000);
  check('MGT-7A shares MGT-7s entry', app.lgPenaltyFor('MGT-7A').pen.cite, 's.92(5)');
  check('AOC-4 XBRL shares AOC-4s entry', app.lgPenaltyFor('AOC-4 XBRL').pen.cite, 's.137(3)');
  check('CHG-4 shares the charge entry', app.lgPenaltyFor('CHG-4').pen.cite, 's.86(1)');
  check('the lookup is case- and space-tolerant',
        app.lgPenaltyFor('  aoc-4  ').pen.cite, 's.137(3)');
  check('a form the Act does not cover here resolves to nothing',
        app.lgPenaltyFor('INC-20A'), null);
  check('and so does a blank', app.lgPenaltyFor(''), null);

  // Each shape has to read as what it is. Flattening a court-fixed fine and an
  // accruing penalty into one sentence is the same error as flattening them
  // into one column (§3m).
  const t = (f) => app.lgPenaltyLegText(app.lgPenaltyFor(f).pen.co);
  check('a continuing penalty names its maximum', /max/.test(t('AOC-4')), true);
  check('a flat penalty says it does not accrue',
        /does not grow by the day/.test(t('CHG-1')), true);
  check('a fine says a court fixes it', /fine/.test(t('ADT-1')), true);
  check('a leg with no cap says so, rather than going quiet',
        app.lgPenaltyLegText({base:1000, day:100}),
        app.calcMoney(1000) + ' + ' + app.calcMoney(100) + ' per day, <b>no maximum stated</b>');
  check('no leg, no text', app.lgPenaltyLegText(null), '');

  // Every form the screen can label "verified" must actually carry both legs
  // and a citation, or the label is doing work the data cannot support.
  let thin = [];
  Object.keys(app.LG_PENALTY_FORM).forEach(f => {
    const e = app.lgPenaltyFor(f);
    if (!e || !e.pen.cite || !e.pen.co || !e.pen.words) thin.push(f);
  });
  check('every mapped form carries a cite, a company leg and the words', thin.join(','), '');

  // ── the door, not the numbers ──────────────────────────────────
  // Read the shipped file. Three copies of these figures is what let two of
  // them go stale; correcting them without closing the door resets the clock.
  const src = require('fs').readFileSync(process.env.LG_INDEX ||
    require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const qa = src.slice(src.indexOf('var QA = ['), src.indexOf('\n];', src.indexOf('var QA = [')));
  const claims = (qa.match(/Penalt(?:y|ies)[^"]{0,120}/g) || []).filter(s => s.includes('Rs.'));
  check('the chat bank states no penalty figure of its own', claims.join(' | '), '');

  // Asserting the engine is not asserting the screen. The mutation check caught
  // this: blanking lgPenaltyFor inside renderPenalties changed nothing any
  // assertion looked at, because every one of them called the engine directly.
  // That is the §2j shape — a value that is computed correctly and reaches no
  // screen — and here it would put the stale figures straight back on display.
  const rp = src.slice(src.indexOf('function renderPenalties()'),
                       src.indexOf('function renderPenalties()') + 3000);
  // Counted, not just present. lgPenaltyFor appears once in the row FILTER and
  // once per row for the figures; blanking the second left the first behind, so
  // a presence check passed against the bug and the mutation went unnoticed.
  check('the Penalties screen asks the verified table for each row',
        (rp.match(/lgPenaltyFor\(/g) || []).length >= 2, true);
  check('and dereferences what it gets back', /v\.pen\./.test(rp), true);
  check('and renders the legs it returns, not a stored string',
        /lgPenaltyLegText\(/.test(rp), true);
  check('an unverified row is labelled as such', /not verified/.test(rp), true);

  // The register says MGT-8 is live; the chat said it was abolished. Neither
  // can be settled from a 01.04.2021 Act text, so the contradiction is
  // reported rather than decided (§3j).
  check('the MGT-8 conflict is disclosed, not resolved',
        /The register in this app\s*disagrees/.test(qa.replace(/<[^>]+>/g, ' ')), true);
}

describe('the AI call has a deadline and reads the status');
{
  const src = require('fs').readFileSync(process.env.LG_INDEX ||
    require('path').join(__dirname, '..', 'index.html'), 'utf8');
  // Slice to the end of the function, not a guessed number of characters — a
  // window too short makes indexOf return -1 and the ordering check below then
  // passes or fails for a reason that has nothing to do with the code.
  const fnStart = src.indexOf('async function callAIProxy');
  const fn = src.slice(fnStart, src.indexOf('return data.text;', fnStart) + 40);
  // Comments stripped before the ordering check below. The first cut compared
  // raw text and matched the COMMENT that explains the bug — which names
  // res.json() several lines above the call — so it reported the guard as
  // absent while looking straight at it. An assertion that can be satisfied or
  // broken by prose is not testing the code.
  const code = fn.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('both landmarks are inside the slice',
        code.includes('if(!res.ok)') && code.includes('res.json()'), true);
  check('a timeout is set', /LG_AI_TIMEOUT_MS/.test(fn), true);
  check('and it is wired to the fetch', /signal:\s*ctl/.test(fn), true);
  check('the abort is distinguished from a network failure',
        /AbortError/.test(fn), true);
  check('the HTTP status is checked before parsing', /if\(!res\.ok\)/.test(fn), true);
  check('res.ok is tested BEFORE res.json is reached',
        code.indexOf('if(!res.ok)') < code.indexOf('res.json()'), true);
  check('a non-JSON body is caught rather than thrown raw',
        /was not JSON/.test(fn), true);
  check('the timeout is a sane length', app.LG_AI_TIMEOUT_MS >= 15000 &&
        app.LG_AI_TIMEOUT_MS <= 120000, true);
}

describe('board composition — sections 149, 177, 178');
{
  const dirs = (n, designation, extra) => Array.from({ length: n }, (_, i) =>
    Object.assign({ id: designation + i, name: designation + i, designation }, extra || {}));
  const listed  = { id: 'B-L', name: 'L', type: 'listed' };
  const priv    = { id: 'B-P', name: 'P', type: 'private' };
  const pub     = { id: 'B-U', name: 'U', type: 'public' };
  const cite = (B, c) => B.checks.filter(x => x.cite === c)[0];

  // s.149(1)(a): three public, two private, one OPC.
  check('a private company needs two directors',
        cite(app.calcBoardCheck(priv, dirs(2, 'director')), 's.149(1)(a)').ok, true);
  check('a public company needs three',
        cite(app.calcBoardCheck(pub, dirs(2, 'director')), 's.149(1)(a)').ok, false);
  check('an OPC needs one',
        cite(app.calcBoardCheck({ id: 'B-O', name: 'O', type: 'opc' }, dirs(1, 'director')),
             's.149(1)(a)').ok, true);
  check('s.149(1)(b) caps the board at fifteen',
        cite(app.calcBoardCheck(priv, dirs(16, 'director')), 's.149(1)(b)').ok, false);

  // s.149(4) Explanation: "any fraction contained in such one-third number
  // shall be rounded off as one". Seven directors therefore need three.
  check('six directors need two independent',
        cite(app.calcBoardCheck(listed, dirs(4, 'director').concat(dirs(2, 'independent'))),
             's.149(4)').ok, true);
  check('seven need three — the fraction rounds up',
        cite(app.calcBoardCheck(listed, dirs(5, 'director').concat(dirs(2, 'independent'))),
             's.149(4)').ok, false);
  check('and seven with three meets it',
        cite(app.calcBoardCheck(listed, dirs(4, 'director').concat(dirs(3, 'independent'))),
             's.149(4)').ok, true);
  check('the one-third test is not applied to an unlisted company',
        cite(app.calcBoardCheck(priv, dirs(9, 'director')), 's.149(4)'), undefined);

  // A director who has ceased is not on the board.
  const withGone = dirs(2, 'director').concat(dirs(1, 'director', { cessation_on: '2026-01-01' }));
  check('a ceased director is not counted', app.calcBoardCheck(priv, withGone).count, 2);

  // What the register cannot answer must not read as a pass.
  const B = app.calcBoardCheck(listed, dirs(6, 'independent'));
  check('residency is reported as untested, not satisfied',
        cite(B, 's.149(3)').evaluable, false);
  check('committee rows are untested too — membership is not recorded',
        cite(B, 's.177(2)').evaluable, false);
  ok('every untested row carries its reason',
     B.checks.filter(x => !x.evaluable).every(x => !!x.note),
     B.checks.filter(x => !x.evaluable && !x.note).length + ' without one');
}

// ── 11e. Entity class (§2z) ─────────────────────────────────
describe('entity class');
{
  const CRr = 10000000;
  const co = (t, cap, tur, extra) => Object.assign(
    { id: 'C-' + t, name: t, type: t, fyend: '2026-03-31', capital: cap, turnover: tur,
      cin: 'U12345MH2015PTC123456', chart: {} }, extra || {});

  // s.2(85): "a company, other than a public company", within BOTH limits. The
  // prescribed figures — Rs 4 crore and Rs 40 crore — are in Rule 2(1)(t), not
  // in the Act text, and the code says so where it uses them.
  ok('a private company inside both limits is small',
     app.lgIsSmallCompany(co('private', 2 * CRr, 20 * CRr)), 'not small');
  ok('at exactly both limits it is still small',
     app.lgIsSmallCompany(co('private', 4 * CRr, 40 * CRr)), 'not small');
  ok('a rupee over the capital limit and it is not',
     !app.lgIsSmallCompany(co('private', 4 * CRr + 1, 20 * CRr)), 'still small');
  ok('a rupee over the turnover limit and it is not',
     !app.lgIsSmallCompany(co('private', 2 * CRr, 40 * CRr + 1)), 'still small');
  // "other than a public company" — the size test never reaches a public one.
  ok('a tiny public company is never small',
     !app.lgIsSmallCompany(co('public', 100, 100)), 'treated as small');
  ok('nor is a Section 8 company, however small',
     !app.lgIsSmallCompany(co('sec8', 100, 100)), 'treated as small');
  // A holding or subsidiary company is excluded by the proviso whatever its size.
  ok('a holding company is excluded by the proviso',
     !app.lgIsSmallCompany(co('private', 100, 100, { is_holding: true })), 'treated as small');
  ok('and so is a subsidiary',
     !app.lgIsSmallCompany(co('private', 100, 100, { is_subsidiary: true })), 'treated as small');

  // s.96(1): "Every company other than a One Person Company shall ... hold ...
  // an annual general meeting". An OPC was being told to hold one.
  const opcRows = app.getComplianceChart(co('opc', CRr, 2 * CRr));
  check('a One Person Company is given no AGM', opcRows.filter(app.lgRowIsAGM).length, 0);
  check('every other class still gets one',
        app.getComplianceChart(co('private', CRr, 2 * CRr)).filter(app.lgRowIsAGM).length, 1);

  // An LLP is not a company under this Act. It was receiving "Board meetings —
  // 0 of 4 held" against Sec 173(1), a section it has no Board for.
  const llp = app.getComplianceChart(co('llp', CRr, 5 * CRr));
  check('an LLP is on the LLP Act, not the Companies Act', app.lgEntityRegime(co('llp', 0, 0)), 'llp');
  check('and receives no Companies Act obligation at all',
        llp.filter(r => r.law === 'Companies Act 2013').length, 0);
  check('specifically none under section 173', llp.filter(r => /173/.test(r.section)).length, 0);
  ok('it does receive Form 11', llp.some(r => r.form === 'Form 11'), 'missing');
  ok('and Form 8', llp.some(r => r.form === 'Form 8'), 'missing');
  ok('every LLP row says the LLP Act is not in reference/',
     llp.filter(r => r.law === 'LLP Act 2008').every(r => /not in reference\//.test(r.derivedNote || '')),
     'a row claims a period without saying where it came from');

  // A duty the class still owes, in a different form.
  const smallNotes = app.getComplianceChart(co('private', 2 * CRr, 20 * CRr))
    .filter(r => r.classNote);
  ok('a small company gets class notes', smallNotes.length >= 3, smallNotes.length);
  ok('one of them resolves MGT-7 vs MGT-7A',
     smallNotes.some(r => /MGT-7A/.test(r.classNote)), 'not resolved');
  check('a company that is not small gets none',
        app.getComplianceChart(co('private', 10 * CRr, 100 * CRr)).filter(r => r.classNote).length, 0);
  ok('the OPC board report note quotes s.134(4), which the Act itself settles',
     app.getComplianceChart(co('opc', CRr, 2 * CRr))
       .some(r => /134\(4\)/.test(r.classNote || '')), 'not cited');
}

// ── 11f. Borrowing, deposits and LLP fees (§2z) ─────────────
describe('section 180 — borrowing powers');
{
  // "will exceed aggregate of its paid-up share capital, free reserves and
  // securities premium, apart from temporary loans obtained from the company's
  // bankers in the ordinary course of business".
  const B = app.calc180Limit(100000000, 20000000, 10000000, 140000000, 30000000, 30000000);
  check('the ceiling is capital plus free reserves plus premium', B.limit, 130000000);
  check('temporary bank loans come out of what is counted', B.counted, 110000000);
  check('and the proposed borrowing goes in', B.total, 140000000);
  check('so it exceeds the ceiling', B.exceeds, true);
  check('by the headroom, negated', B.headroom, -10000000);

  // Failing to exclude temporary loans is the whole point of the Explanation.
  check('without the temporary loans it would be inside',
        app.calc180Limit(100000000, 20000000, 10000000, 110000000, 30000000, 30000000).exceeds, false);
  check('a temporary figure larger than the borrowing cannot go negative',
        app.calc180Limit(1000, 0, 0, 100, 500, 0).counted, 0);
}

describe('deposits — is it a deposit at all');
{
  const cap = [10000000, 5000000, 0];
  // Rule 2(1)(c)(viii): a director's own money, on a written declaration.
  check('a director without the declaration is only conditional',
        app.calcDepositTest('director', true, false, cap[0], cap[1], cap[2], 1000000).verdict,
        'conditional');
  check('with it, not a deposit',
        app.calcDepositTest('director', true, true, cap[0], cap[1], cap[2], 1000000).verdict,
        'not_deposit');
  // Rule 3(3): a private company, one hundred per cent of the aggregate.
  check('a member within the limit is not a deposit',
        app.calcDepositTest('member', true, false, cap[0], cap[1], cap[2], 14000000).verdict,
        'not_deposit');
  check('over the limit it becomes one',
        app.calcDepositTest('member', true, false, cap[0], cap[1], cap[2], 16000000).verdict,
        'deposit');
  check('the limit is the aggregate, not a fraction of it',
        app.calcDepositTest('member', true, false, cap[0], cap[1], cap[2], 1).limit, 15000000);
  // The member exclusion belongs to private companies only.
  check('a member of a company that is not private is a deposit',
        app.calcDepositTest('member', false, false, cap[0], cap[1], cap[2], 1).verdict, 'deposit');
  check('money from the public always is',
        app.calcDepositTest('public', true, true, cap[0], cap[1], cap[2], 1).verdict, 'deposit');
  ok('every answer names the rule it rests on',
     ['director','member','relative','bank','company','public'].every(sr =>
       !!app.calcDepositTest(sr, true, true, 1, 1, 1, 1).rule), 'one has no citation');
}

describe('LLP filing fee');
{
  const F = app.calcLlpFee('form11', '2026-05-30', '2026-07-01');
  check('the delay is counted', F.days, 32);
  check('but the fee is refused — the LLP Rules are not held', F.unpriced, true);
  check('an on-time filing is not late', app.calcLlpFee('form8', '2026-10-30', '2026-10-01').late, false);
  ok('the form carries its own period', /60 days/.test(F.form[2]), F.form[2]);
}

// ── 11g. Reference data holds together (§2z) ────────────────
describe('reference data');
{
  check('NIC has 21 sections', app.NIC_SECTIONS.length, 21);
  // Divisions run 01-99 with gaps, so the count is 88 and the screen says 88.
  check('and 88 divisions, not 99', app.NIC_DIVISIONS.length, 88);
  const secs = app.NIC_SECTIONS.map(x => x[0]);
  ok('every division belongs to a section that exists',
     app.NIC_DIVISIONS.every(d => secs.indexOf(d[1]) >= 0),
     app.NIC_DIVISIONS.filter(d => secs.indexOf(d[1]) < 0).map(d => d[0]).join(','));
  ok('no division code appears twice',
     new Set(app.NIC_DIVISIONS.map(d => d[0])).size === 88, 'duplicates present');
  ok('searching for what a business does finds the division',
     app.nicMatch('software').some(d => d[0] === '62'), 'software did not reach 62');
  ok('and an unrelated word finds nothing rather than everything',
     app.nicMatch('zzzzq').length === 0, app.nicMatch('zzzzq').length);

  // Every checklist item must carry a citation and declare whether the text
  // behind it is held. An item that claims neither is the defect these lists
  // exist to avoid.
  const lists = { CHK_DIRREP: app.CHK_DIRREP, CHK_SS1: app.CHK_SS1, CHK_SS2: app.CHK_SS2,
                  CHK_AUDIT: app.CHK_AUDIT, CHK_POSTINC: app.CHK_POSTINC };
  Object.keys(lists).forEach(k => {
    ok(k + ': every item cites a provision',
       lists[k].every(i => !!i.c), lists[k].filter(i => !i.c).length + ' without one');
    ok(k + ': every item declares whether its text is held',
       lists[k].every(i => typeof i.held === 'boolean'),
       lists[k].filter(i => typeof i.held !== 'boolean').length + ' undeclared');
    ok(k + ': every unheld item explains what is missing',
       lists[k].filter(i => !i.held).every(i => !!i.note),
       'an unheld item gives no reason');
  });
  check('the responsibility statement has all five clauses of s.134(5)', app.CHK_DRS.length, 5);
}

// ── 11h. Roles and organisation scope (§3a) ─────────────────
describe('roles');
{
  const asRole = (r, fn) => {
    const prev = app.CURRENT_ROLE;
    app.CURRENT_ROLE = r;
    try { return fn(); } finally { app.CURRENT_ROLE = prev; }
  };

  // A viewer reads and never writes. Everyone else writes data.
  check('an owner may write',   asRole('owner',  () => app.lgCanWrite()), true);
  check('an admin may write',   asRole('admin',  () => app.lgCanWrite()), true);
  check('a member may write',   asRole('member', () => app.lgCanWrite()), true);
  check('a viewer may not',     asRole('viewer', () => app.lgCanWrite()), false);

  // Only owner and admin manage people.
  check('an owner manages people',  asRole('owner',  () => app.lgCanAdmin()), true);
  check('an admin manages people',  asRole('admin',  () => app.lgCanAdmin()), true);
  check('a member does not',        asRole('member', () => app.lgCanAdmin()), false);
  check('a viewer does not',        asRole('viewer', () => app.lgCanAdmin()), false);

  // Before db/025 runs there is no role at all, and the app must keep working
  // exactly as it did — every policy still carries its legacy single-user limb.
  check('no role behaves as a writer, not as a viewer',
        asRole(null, () => app.lgCanWrite()), true);

  ok('every role has a label', ['owner','admin','member','viewer']
     .every(r => app.lgRoleLabel(r) !== r), 'one is unlabelled');
  check('and an unknown role does not crash the label', app.lgRoleLabel('nonsense'), 'nonsense');
}

describe('a viewer cannot be a checker');
{
  const st = { evidence: { recordedBy: 'someone@else.com' }, checkState: 'unchecked' };
  const asRole = (r, fn) => {
    const prev = app.CURRENT_ROLE, prevU = app.CURRENT_USER;
    app.CURRENT_ROLE = r;
    app.CURRENT_USER = { id: 'u1', email: 'me@firm.com' };
    try { return fn(); } finally { app.CURRENT_ROLE = prev; app.CURRENT_USER = prevU; }
  };
  // Confirming a filing records that a check was carried out. Someone who
  // cannot change a record must not be able to certify one.
  check('a viewer is refused', asRole('viewer', () => app.lgCanCheck(st).can), false);
  ok('and told why in terms they can act on',
     /viewer/i.test(asRole('viewer', () => app.lgCanCheck(st).why)),
     asRole('viewer', () => app.lgCanCheck(st).why));
  check('a member may check', asRole('member', () => app.lgCanCheck(st).can), true);

  // The maker-checker rule itself still stands on top of the role.
  const mine = { evidence: { recordedBy: 'me@firm.com' }, checkState: 'unchecked' };
  check('and may still not check their own entry',
        asRole('member', () => app.lgCanCheck(mine).can), false);
  check('nor may an owner check their own',
        asRole('owner', () => app.lgCanCheck(mine).can), false);
}

describe('organisation scope');
{
  const withOrg = (id, fn) => {
    const prev = app.CURRENT_ORG;
    app.CURRENT_ORG = id;
    try { return fn(); } finally { app.CURRENT_ORG = prev; }
  };
  const rows = [
    { id: 1, org_id: 'A' }, { id: 2, org_id: 'B' },
    { id: 3, org_id: 'A' }, { id: 4, org_id: null }
  ];
  // Someone in two practices can read both. The screen shows one at a time.
  check('rows from another organisation are dropped',
        withOrg('A', () => app.lgScopeToOrg(rows).map(r => r.id).join(',')), '1,3,4');
  check('and switching changes what is kept',
        withOrg('B', () => app.lgScopeToOrg(rows).map(r => r.id).join(',')), '2,4');

  // A row with no org is kept deliberately: on a database where db/025 has not
  // run, every row has a null org, and dropping them would empty the screen.
  check('a row with no organisation is never dropped',
        withOrg('A', () => app.lgScopeToOrg([{ id: 9, org_id: null }]).length), 1);
  check('and where nothing carries an org, everything is kept',
        withOrg('A', () => app.lgScopeToOrg([{ id: 1 }, { id: 2 }]).length), 2);
  check('with no organisation selected, nothing is filtered',
        withOrg(null, () => app.lgScopeToOrg(rows).length), 4);
}

// ── 11i. The access check itself (§3c) ──────────────────────
// lgAccessCheck runs against a live session, which the suite has none of. So
// the DATABASE is stubbed and the CHECK is what gets tested — every verdict it
// can reach, driven from a controlled answer. A check nobody has watched fail
// is a check nobody should trust.
let ACCESS_CHECKS = null;
let EXPORT_CHECKS = null;
describe('access check');
{
  const stub = (cfg) => {
    const chain = (rows) => {
      const o = { select: () => o, eq: (c, v) => chain((rows||[]).filter(r => String(r[c]) === String(v))),
                  limit: () => o, not: () => o,
                  then: (res) => res({ data: rows || [], error: null }) };
      return o;
    };
    app.supaClient = {
      from(t){
        return { select: () => chain(cfg[t] || []),
                 insert: () => ({ select: () => ({
                   then: r => r({ data: null, error: cfg.__insertErr || null }) }) }) };
      }
    };
  };
  const FK  = { message: 'insert violates foreign key constraint "companies_org_id_fkey"' };
  const RLS = { message: 'new row violates row-level security policy for table "companies"' };
  const run = async (cfg, role, probe) => {
    app.CURRENT_USER = { id: 'u-me', email: 'me@firm.com' };
    app.CURRENT_ORGS = [{ id: 'org-A', name: 'A', role: role }];
    app.CURRENT_ORG = 'org-A'; app.CURRENT_ROLE = role;
    stub(cfg);
    return await app.lgAccessCheck(probe);
  };
  const of = (rows, prefix) => (rows.filter(r => r.name.indexOf(prefix) === 0)[0] || {}).state;

  const healthy = { companies: [{ id:'c1', name:'A', org_id:'org-A' }],
                    directors: [{ id:'d1', company_id:'c1' }],
                    compliance_status: [], __insertErr: FK };

  // This file is CommonJS, so there is no top-level await. The block is defined
  // here beside its fixtures and invoked by the runner at the foot of the file,
  // which then reports. Anything else would report before these had finished.
  EXPORT_CHECKS = async () => {
    // ── the export (§3h) ────────────────────────────────────
    // The property under test is not "a file comes out". It is that a table
    // which fails to read shows up AS A FAILURE. An export that quietly drops a
    // table looks exactly like a complete one, and somebody keeps it as their
    // backup.
    app.CURRENT_USER = { id: 'u1', email: 'me@firm.com' };
    app.CLIENTS.length = 0;
    app.CLIENTS.push({ id: 'c1', name: 'A', type: 'listed', fyend: '2026-03-31',
                       capital: 1, turnover: 1, cin: 'L1', chart: {} });
    // charges fails; everything else returns one row.
    app.supaClient = {
      from(t) {
        const o = { select: () => o, in: () => o,
          then: (res) => res(t === 'charges'
            ? { data: null, error: { message: 'relation "charges" does not exist' } }
            : { data: [{ id: t + '-1', company_id: 'c1' }], error: null }) };
        return o;
      }
    };

    const d = await app.lgExportGather('all');
    check('every declared table is attempted',
          Object.keys(d.counts).length, app.LG_EXPORT_TABLES.length);
    check('a table that fails is counted as null, not zero', d.counts.charges, null);
    ok('and its error is recorded rather than swallowed',
       /does not exist/.test(d.errors.charges || ''), d.errors.charges);
    check('a table that reads is counted', d.counts.directors, 1);
    ok('a failed table is not silently absent from the counts',
       Object.prototype.hasOwnProperty.call(d.counts, 'charges'), 'missing entirely');

    // The file has to say what it is not, or it reads as a complete backup.
    ok('the file names what it does not contain', (d.meta.notIncluded || []).length >= 3,
       (d.meta.notIncluded || []).length);
    ok('including the evidence documents specifically',
       (d.meta.notIncluded || []).some(x => /document/i.test(x)), 'not named');
    ok('and it says there is no import', /no import/i.test(d.meta.reimport || ''),
       d.meta.reimport);

    // The CSV must carry the failure too — that is the copy a person opens.
    const csv = app.lgExportCsv(d);
    ok('the CSV marks the failed table in the summary',
       /"charges",ERROR/.test(csv), 'not marked');
    ok('and carries the message as its own valid row',
       /\nERROR,"charges","relation/.test(csv), 'no error row');
    ok('the CSV lists what is not included', /NOT INCLUDED/.test(csv), 'absent');

    // §2b: toISOString() names the file for yesterday in IST.
    const stamp = app.expStamp();
    check('the filename stamp is built from local parts', stamp, '2026-08-29');
    ok('which is NOT what toISOString would give at this frozen time',
       stamp === new Date(2026, 7, 29, 10, 0, 0).toISOString().slice(0, 10) ||
       stamp === '2026-08-29', stamp);
  };

  ACCESS_CHECKS = async () => {
    let r = await run(healthy, 'owner');
    check('a healthy tenant passes the org check', of(r, 'Member of a practice'), 'pass');
    check('and the anchoring check', of(r, 'Every company carries'), 'pass');
    check('and sees nothing foreign', of(r, 'Nothing visible from'), 'pass');

    // The backfill question tests/backend.test.js cannot reach.
    r = await run(Object.assign({}, healthy, {
      companies: [{ id:'c1', org_id:'org-A' }, { id:'c2', name:'B', org_id:null }] }), 'owner');
    check('a company with no org_id fails', of(r, 'Every company carries'), 'fail');

    // Cross-tenant leakage.
    r = await run(Object.assign({}, healthy, {
      companies: [{ id:'c1', org_id:'org-A' }, { id:'cX', name:'Other', org_id:'org-ZZZ' }] }), 'owner');
    check('a row from another practice fails', of(r, 'Nothing visible from'), 'fail');

    // A register row hanging off a company the user cannot see.
    r = await run(Object.assign({}, healthy, {
      directors: [{ id:'d1', company_id:'c1' }, { id:'d2', company_id:'c-GONE' }] }), 'owner');
    check('an orphan register row fails', of(r, 'Register rows belong'), 'fail');

    // The subtle one. A viewer's write stopped by a CONSTRAINT is not a pass:
    // it means the policy let it through and a foreign key happened to catch
    // it. Only a refusal by the policy is a refusal.
    r = await run(Object.assign({}, healthy, { __insertErr: RLS }), 'viewer');
    check('a viewer refused by policy passes', of(r, 'The database refuses a viewer'), 'pass');
    r = await run(Object.assign({}, healthy, { __insertErr: FK }), 'viewer');
    check('a viewer stopped only by a constraint FAILS',
          of(r, 'The database refuses a viewer'), 'fail');

    // A member must not be refused by the policy.
    r = await run(Object.assign({}, healthy, { __insertErr: RLS }), 'member');
    check('a member refused by policy fails', of(r, 'The database agrees you may write'), 'fail');
    r = await run(Object.assign({}, healthy, { __insertErr: FK }), 'member');
    check('a member reaching the constraint passes',
          of(r, 'The database agrees you may write'), 'pass');

    // The cross-tenant probe, both ways.
    r = await run(healthy, 'owner', 'c-OTHER');
    check('a probe id that is not visible passes', of(r, 'Cross-tenant'), 'pass');
    r = await run(Object.assign({}, healthy, {
      companies: [{ id:'c1', org_id:'org-A' }, { id:'c-OTHER', name:'Rival', org_id:'org-A' }] }),
      'owner', 'c-OTHER');
    check('a probe id that IS visible fails', of(r, 'Cross-tenant'), 'fail');

    // Before db/025 there is no org, and that must be reported, not passed over.
    app.CURRENT_ORG = null; app.CURRENT_ORGS = []; app.CURRENT_ROLE = null;
    stub(healthy);
    r = await app.lgAccessCheck();
    check('no organisation at all is reported', of(r, 'Member of a practice'), 'fail');
  };
}

// ── 11j. Deadlines expressed by reference (§3d) ─────────────
// "With the annual report", "at the AGM", "along with financial results" — a
// period stated by naming another filing. §2k called these "no period at all";
// they are a period this register already computes, unresolved.
describe('companion deadlines');
{
  const L = rowsFor(LISTED);
  const comp = L.filter(r => r.companionOf);

  // The count guards the silent failure: a mistyped key produces a row that is
  // undated, which is indistinguishable from one that was never mapped.
  ok('a listed entity resolves the full companion set', comp.length === 19, comp.length);
  ok('every one of them carries a date', comp.every(r => !!r.due),
     comp.filter(r => !r.due).length + ' without one');
  ok('and names the filing it follows',
     comp.every(r => r.companionOf.section && r.companionOf.label),
     'one does not say what it follows');
  ok('and quotes the wording that ties it there',
     comp.every(r => !!r.companionOf.why), 'one has no wording');
  check('they are marked as dated by reference, not by an offset',
        comp.every(r => r.dueConfidence === 'companion'), true);

  const at = (sec) => (L.filter(r => String(r.section).indexOf(sec) === 0 && r.companionOf)[0] || {});
  const agm = dueOf(LISTED, 'Section 96');
  check('the AGM anchor is where it was', agm, '2026-09-30');

  // At the AGM.
  check('Reg 20(3) falls on the AGM', at('Reg 20(3)').due, agm);
  check('Reg 44(6) falls on the AGM', at('Reg 44(6)').due, agm);
  // NOT a companion: Reg 34(1)(b) runs 48 hours from the AGM actually held, so
  // it stays undated until the meetings register holds one. Anchoring it to the
  // statutory last date would report a deadline weeks after the real one.
  check('Reg 34(1)(b) is not resolved by reference', at('Reg 34(1)(b)').due, undefined);
  // The annual report goes with the notice — s.101(1)'s clear 21 days.
  check('Reg 34(2) follows the annual report', at('Reg 34(2)').due, '2026-09-09');
  check('so does the Board’s Report', at('Section 134').due, '2026-09-09');

  // The AOC-4 and MGT-7 families take their parent's date exactly.
  check('XBRL follows AOC-4', at('Section 137; XBRL').due, dueOf(LISTED, 'Section 137; Accounts Rules'));
  check('MGT-8 follows MGT-7', at('Section 92(2)').due, dueOf(LISTED, 'Section 92'));

  // A quarterly companion follows ITS OWN quarter, not the year.
  // Reg 23(9) is half-yearly and published "on the date of publication of
  // standalone results", so each occurrence must follow ITS OWN period.
  // (Reg 27(2)(ba) used to be tested here and is no longer a companion at all —
  // §3e: it follows the CG report, which has no date of its own.)
  const rpt = L.filter(r => String(r.section).indexOf('Reg 23(9)') === 0 && r.due)
               .map(r => r.due).sort();
  check('the related-party companion has two half-yearly dates', rpt.length, 2);
  // Counting is not enough. Falling back to the first results row gives both
  // occurrences the Q1 date — same count, same first value. What the bug
  // destroys is that they are two DIFFERENT dates, one per half.
  check('they are two distinct dates, not the same one twice', new Set(rpt).size, 2);
  check('and each matches its own period’s results submission',
        rpt.join(','), '2026-11-14,2027-05-15');
  // "With the annual results" means the year end, not the first quarter found.
  check('Reg 33(3)(e) follows the YEAR-END results', at('Reg 33(3)(e)').due, '2027-05-15');

  // A different year end must move every companion with it.
  const DEC_LISTED = Object.assign({}, LISTED, { id: 'T-DECL', fyend: '2026-12-31' });
  const dl = rowsFor(DEC_LISTED);
  const dAgm = (dl.filter(r => String(r.section).indexOf('Section 96') === 0)[0] || {}).due;
  const dR20 = (dl.filter(r => String(r.section).indexOf('Reg 20(3)') === 0)[0] || {}).due;
  // The absolute date is not the point and an earlier draft of this assertion
  // guessed it wrong: on 29 Aug 2026 a December company's outstanding AGM is
  // FY2025's, due 30 June 2026 and overdue. What must hold is that the
  // companion tracks whatever the AGM is.
  ok('a December year end produces a different AGM date',
     dAgm && dAgm !== '2026-09-30', dAgm);
  check('and the companion moves with it', dR20, dAgm);

  // A companion with no anchor stays undated. That is §2k's whole discipline:
  // no anchor, no date, rather than a plausible invented one.
  //
  // A One Person Company is the case that exercises it — s.96(1) excludes it
  // from holding an AGM, so every AGM-anchored companion has nothing to take a
  // date from. On a listed entity every anchor is present, so the guard never
  // fires and nothing was testing it.
  const OPC = { id: 'T-OPC', name: 'Test OPC', type: 'opc', fyend: '2026-03-31',
                capital: 1000000, turnover: 2000000,
                cin: 'U12345MH2015OPC123456', chart: {} };
  const opcRows = rowsFor(OPC);
  check('an OPC has no AGM to anchor to', opcRows.filter(app.lgRowIsAGM).length, 0);
  const opcBoardReport = opcRows.filter(
    r => String(r.section).indexOf('Section 134') === 0)[0] || {};
  check('so its Board’s Report companion stays undated', opcBoardReport.due, null);
  ok('and no OPC row is dated by reference to an AGM it never holds',
     opcRows.filter(r => r.companionOf &&
                    /AGM|annual report/i.test(r.companionOf.label)).length === 0,
     opcRows.filter(r => r.companionOf).map(r => r.section).join(', '));

  const PVT = rowsFor(PRIVATE);
  ok('a private company resolves only the companions it actually has',
     PVT.filter(r => r.companionOf).length === 6,
     PVT.filter(r => r.companionOf).length);
  // The guard that stops an unanchored companion is `if(!due || !src) return`.
  // Removing it does NOT produce a wrong date — `due` is still null — it
  // produces a row CLAIMING to follow another filing while naming none. That is
  // the defect: the screen would say "same date as ..." with a blank after it.
  const everyRow = PVT.concat(L).concat(opcRows);
  ok('no row claims a companion without a date',
     everyRow.filter(r => r.companionOf).every(r => !!r.due),
     everyRow.filter(r => r.companionOf && !r.due).length + ' claim one with no date');
  ok('and none claims one without naming what it follows',
     everyRow.filter(r => r.companionOf).every(
       r => !!r.companionOf.section && !!r.companionOf.label),
     everyRow.filter(r => r.companionOf &&
       (!r.companionOf.section || !r.companionOf.label)).length + ' name nothing');
}

// ── 11k. "As specified by SEBI", read against the text (§3e) ─
// The held LODR compilation is amended to 14 July 2026, so the claim that these
// have no period could be checked rather than assumed. Two of them HAD a period
// and it was deleted; one has a period the corpus predates.
describe('SEBI-specified timelines');
{
  const L = rowsFor(LISTED);
  const one = (sec) => L.filter(r => String(r.section).indexOf(sec) === 0)[0] || {};

  // Reg 91C(1)(ii), substituted w.e.f. 8 Sep 2025: 60 days from the FY end.
  // The corpus still carries the pre-amendment "timelines specified by SEBI".
  check('Reg 91C is dated 60 days from the financial year end',
        one('Reg 91C').due, '2026-05-30');
  ok('and says where that period comes from',
     /8 September 2025/.test(one('Reg 91C').duePatchedFrom || ''),
     one('Reg 91C').duePatchedFrom);

  // Reg 27(2)(ba) follows the CG report, so it takes the GOVERNANCE period of
  // 30 days — not the 45-day Financial one, and not the results date §3d
  // briefly gave it. Both wrong answers are plausible dates, which is why this
  // asserts which one.
  check('Reg 27(2)(ba) takes the 30-day Governance period, not 45',
        one('Reg 27(2)(ba)').due, '2026-07-30');
  ok('and cites the clause it follows',
     /clause \(a\)/.test(one('Reg 27(2)(ba)').duePatchedFrom || ''),
     one('Reg 27(2)(ba)').duePatchedFrom);
  ok('it is not resolved as a companion of the results',
     !one('Reg 27(2)(ba)').companionOf, 'still a companion');

  // §3f: the period did not disappear when the Third Amendment 2024 took it out
  // of the regulation — it MOVED to the Master Circular's Integrated Filing.
  // Governance filings within 30 days of the quarter end.
  const q = (sec) => L.filter(r => String(r.section).indexOf(sec) === 0 && r.due)
                      .map(r => r.due).sort();
  ['Reg 13(3)', 'Reg 27(2)(a)', 'Reg 27(2)(ba)'].forEach(sec => {
    check(sec + ' is dated for all four quarters', q(sec).length, 4);
    check(sec + ' — 30 days from each quarter end',
          q(sec).join(','), '2026-07-30,2026-10-30,2027-01-30,2027-04-30');
    const src = (L.filter(r => String(r.section).indexOf(sec) === 0)[0] || {}).duePatchedFrom || '';
    ok(sec + ' cites the Master Circular', /Master Circular/.test(src), src.slice(0, 50));
    ok(sec + ' names the date of that circular', /30 January 2026/.test(src), src.slice(0, 50));
  });
  // Integrated Filing (Financial) is 45 days, not 30. Getting these two the same
  // way round is the whole point of the table.
  check('Reg 32(1) takes the Financial period, 45 days',
        q('Reg 32(1)').join(','), '2026-08-14,2026-11-14,2027-02-14,2027-05-15');
  ok('and its note records the 60 days allowed for the last quarter',
     /60 days/.test((L.filter(r => String(r.section).indexOf('Reg 32(1)') === 0)[0] || {})
       .duePatchedFrom || ''), 'not recorded');
  // Once a period is supplied, the row must stop explaining why it has none.
  ['Reg 13(3)', 'Reg 27(2)(a)', 'Reg 32(1)'].forEach(sec => {
    ok(sec + ' no longer claims to have no deadline',
       !app.lgNoDeadlineWhy(one(sec)), 'still explains an absent date');
  });

  // Every explanation must attach to a row that genuinely has no date.
  const explained = L.filter(r => app.lgNoDeadlineWhy(r));
  ok('explanations appear only on undated rows', explained.every(r => !r.due),
     explained.filter(r => r.due).length + ' dated rows carry one');
  // Fewer than before §3f, and that is the improvement: sixteen of these rows
  // stopped needing an explanation because the Master Circular gave them a date.
  ok('the rows that remain undated still explain themselves', explained.length >= 12,
     explained.length);
  // A dated row must never carry one — that would contradict its own date.
  ok('no dated row claims to have no deadline',
     L.filter(r => r.due).every(r => !app.lgNoDeadlineWhy(r)), 'one does');
  // Sweeping the real rows is not enough: none of the mapped keys happens to be
  // dated, so removing the `row.due` guard changes nothing they can see. The
  // contract is tested directly instead — a mapped key WITH a date must still
  // get no explanation.
  // Reg 23(2) is a genuine "prior to the transaction" duty and stays mapped;
  // Reg 13(3) was removed from the map when the circular gave it a date.
  check('a mapped key that has a date gets no explanation',
        app.lgNoDeadlineWhy({ key: 'LODR-REG-23-2', due: '2026-01-01' }), null);
  ok('while the same key without one still does',
     !!app.lgNoDeadlineWhy({ key: 'LODR-REG-23-2', due: null }), 'lost its explanation');
  ok('and a key the circular has now dated is no longer mapped at all',
     !app.lgNoDeadlineWhy({ key: 'LODR-REG-13-3', due: null }), 'still mapped');
}

// ── 11l. The back-test, against real entity shapes (§3i) ────
// One assertion here does a lot of work: if the back-test reports no defects on
// clean entities, then EVERY mutation in tests/mutation.js that introduces one
// is caught by it as well as by whatever assertion targets it directly. It is a
// second, independent net over the same engines.
describe('back-test');
{
  const CRb = 10000000;
  const listed = { id: 'BT-L', name: 'BT Listed', type: 'listed', fyend: '2026-03-31',
                   capital: 120 * CRb, turnover: 800 * CRb, networth: 600 * CRb,
                   netprofit: 20 * CRb, borrowings: 0,
                   cin: 'L17110MH2009PLC191234', chart: {} };
  const unlisted = { id: 'BT-U', name: 'BT Unlisted', type: 'private', fyend: '2026-03-31',
                     capital: 5 * CRb, turnover: 40 * CRb, networth: 10 * CRb,
                     netprofit: 1 * CRb, borrowings: 0,
                     cin: 'U51909MH2018PTC300111', chart: {} };

  const withClients = (list, fn) => {
    const prev = app.CLIENTS.slice();
    app.CLIENTS.length = 0; list.forEach(c => app.CLIENTS.push(c));
    try { return fn(); } finally { app.CLIENTS.length = 0; prev.forEach(c => app.CLIENTS.push(c)); }
  };
  const defects = (r) => r.findings.filter(f => f.sev === 'fail');

  const clean = withClients([listed, unlisted], () => app.lgBackTest());
  ok('it actually runs a meaningful number of checks', clean.checked >= 30, clean.checked);
  check('and sees both entities', clean.entities, 2);
  ok('a listed and an unlisted company produce NO defects',
     defects(clean).length === 0,
     defects(clean).map(f => f.kind + ': ' + f.check).join(' | '));

  // It must still be able to fail, or the assertion above proves nothing. The
  // CIN encodes listing status, so a mismatch is a real data-entry error and one
  // this can construct without breaking the code.
  const bad = withClients([Object.assign({}, listed, { cin: 'U17110MH2009PLC191234' })],
                          () => app.lgBackTest());
  check('a CIN that disagrees with the entity type is a defect', defects(bad).length, 1);
  check('and it is reported as a class problem', defects(bad)[0].kind, 'CLASS');
  ok('naming both sides of the disagreement',
     /CIN starts/.test(defects(bad)[0].detail) && /type is/.test(defects(bad)[0].detail),
     defects(bad)[0].detail);

  // Missing financial columns are a GAP, not a defect: the limb is skipped, not
  // failed, and calling that a defect would cry wolf on every real record.
  const sparse = withClients([{ id: 'BT-S', name: 'BT Sparse', type: 'private',
                                fyend: '2026-03-31', capital: CRb, turnover: 2 * CRb,
                                cin: 'U51909MH2018PTC300111', chart: {} }],
                             () => app.lgBackTest());
  check('an entity with no net worth or net profit raises no defect',
        defects(sparse).length, 0);
  ok('but it is reported as a gap, naming the limbs it cannot evaluate',
     sparse.findings.some(f => f.sev === 'warn' && /cannot be evaluated/.test(f.check)),
     'not reported');
  ok('and says a blank is skipped rather than passed',
     sparse.findings.some(f => /SKIPPED, not passed/.test(f.detail || '')), 'not stated');

  // An empty register is a gap too — §2w's rule that an empty database is not
  // the same as nothing having happened.
  ok('empty registers are reported',
     sparse.findings.some(f => /Registers with no rows/.test(f.check)), 'not reported');

  // ── §3j: found by the first run against two REAL companies ──
  // A missing net worth SKIPS a limb. A missing year end makes the engine
  // ASSUME 31 March and produce dates that look computed. One abstains, the
  // other guesses — so this one is a defect and the rest are gaps.
  const noFy = { id: 'BT-N', name: 'BT No FY', type: 'private', fyend: null,
                 capital: 5 * CRb, turnover: 40 * CRb, networth: CRb, netprofit: CRb,
                 borrowings: 0, cin: 'U51909MH2018PTC300111', chart: {} };
  const assumed = withClients([noFy], () => app.lgBackTest());
  const aDef = defects(assumed);
  check('a missing financial year end is a DEFECT, not a gap', aDef.length, 1);
  ok('and it says the year end was assumed',
     /ASSUMED year end/.test(aDef[0].check), aDef[0].check);
  ok('naming how many dates rest on it',
     /dated obligation/.test(aDef[0].detail), aDef[0].detail);

  // Every date produced from the assumed year end must carry the mark, or the
  // warning cannot reach the row that needs it.
  const noFyRows = app.getComplianceChart(noFy).filter(r => r.due);
  ok('every dated row is marked as resting on an assumed year end',
     noFyRows.length > 0 && noFyRows.every(r => r.fyAssumed), noFyRows.length);
  const realFyRows = app.getComplianceChart(
    Object.assign({}, noFy, { fyend: '2026-03-31' })).filter(r => r.due);
  ok('and none is marked when a year end IS recorded',
     realFyRows.every(r => !r.fyAssumed),
     realFyRows.filter(r => r.fyAssumed).length + ' wrongly marked');

  // AOC-4 and MGT-7 follow the AGM. Where they are computed from a LATER AGM,
  // the register says the meeting is overdue and the filing that follows it is
  // a year away. Invisible on a 31 March company, whose AGM is still ahead —
  // which is why every test entity here having March hid it.
  const mkFy = (fy) => ({ id: 'BT-' + fy, name: 'BT ' + fy, type: 'private', fyend: fy,
                          capital: 5 * CRb, turnover: 40 * CRb, networth: CRb,
                          netprofit: CRb, borrowings: 0,
                          cin: 'U51909MH2018PTC300111', chart: {} });
  const march = withClients([mkFy('2026-03-31')], () => app.lgBackTest());
  check('a 31 March company has no AGM-anchor contradiction', defects(march).length, 0);
  const dec = withClients([mkFy('2026-12-31')], () => app.lgBackTest());
  const decContradict = defects(dec).filter(f => f.kind === 'CONTRADICT');
  check('a 31 December company has two', decContradict.length, 2);
  ok('and both name the AGM they disagree with',
     decContradict.every(f => /the AGM row is/.test(f.detail)), 'not named');
}

// ── 11m. The financial year in view (§3k) ───────────────────
// The register mixed years and never said so: for a 31 March company in
// September, the AGM and AOC-4 relate to the year that CLOSED while quarterly
// items belong to the year in progress.
describe('financial year filter');
{
  const CRf = 10000000;
  const co = { id: 'FY-1', name: 'FY Co', type: 'private', fyend: '2026-03-31',
               capital: 5 * CRf, turnover: 40 * CRf, networth: CRf, netprofit: CRf,
               borrowings: 0, cin: 'U51909MH2018PTC300111', chart: {} };
  const withFy = (v, fn) => {
    const prev = app.LG_FY;
    app.LG_FY = v;
    try { return fn(); } finally { app.LG_FY = prev; }
  };

  // A period end falls in the year that ENDS on it. 31 March 2026 closes 2025-26.
  check('31 March 2026 closes FY 2025-26', app.lgFyOfPeriod('2026-03-31', 3, 31), '2025-26');
  check('a September half-year sits inside 2026-27',
        app.lgFyOfPeriod('2026-09-30', 3, 31), '2026-27');
  check('31 March 2027 closes 2026-27', app.lgFyOfPeriod('2027-03-31', 3, 31), '2026-27');
  // A December year end is a single calendar year, not a span.
  check('a December year end labels a single year',
        app.lgFyOfPeriod('2025-12-31', 12, 31), '2025');
  check('and no period end belongs to no year', app.lgFyOfPeriod(null, 3, 31), null);

  const all = withFy('all', () => app.getComplianceChart(co));
  const y26 = withFy('2025-26', () => app.getComplianceChart(co));
  const y27 = withFy('2026-27', () => app.getComplianceChart(co));

  // After §3l a private company's whole annual cycle sits in ONE year, so
  // selecting that year keeps everything and selecting the next keeps only the
  // continuous duties. An earlier draft asserted that BOTH removed rows, which
  // was really asserting the bug that scattered them across two years.
  check('selecting the year the register covers keeps every row', y26.length, all.length);
  ok('selecting a year it does not cover leaves only the continuous duties',
     y27.length < all.length && y27.every(r => !r.periodEnd),
     y27.length + ' rows, ' + y27.filter(r => r.periodEnd).length + ' with a period end');
  ok('and keeps only period ends inside it',
     y26.filter(r => r.periodEnd).every(r => app.lgFyOfPeriod(r.periodEnd, 3, 31) === '2025-26'),
     'a foreign period end survived');
  // A listed entity really does span two years — quarterly returns for the year
  // in progress alongside the annual cycle of the year that closed.
  const lAll = withFy('all', () => app.getComplianceChart(LISTED));
  const lYears = [...new Set(lAll.filter(r => r.periodEnd)
    .map(r => app.lgFyOfPeriod(r.periodEnd, 3, 31)))].filter(Boolean);
  ok('a listed register spans more than one financial year', lYears.length >= 2,
     lYears.join(','));
  lYears.forEach(function(fy){
    const sel = withFy(fy, () => app.getComplianceChart(LISTED));
    ok('selecting ' + fy + ' keeps only that year',
       sel.filter(r => r.periodEnd).every(r => app.lgFyOfPeriod(r.periodEnd, 3, 31) === fy),
       'a foreign period end survived');
  });

  // A continuous obligation belongs to no year. Hiding it behind a year filter
  // would let choosing a year silently switch off a duty that never stops.
  const cont = (rs) => rs.filter(r => !r.periodEnd).length;
  ok('a continuous obligation is never filtered out',
     cont(all) === cont(y26) && cont(all) === cont(y27),
     cont(all) + ' / ' + cont(y26) + ' / ' + cont(y27));
  ok('and there are a meaningful number of them', cont(all) > 20, cont(all));

  // AOC-4 relates to the year that closed, not the year its deadline falls in.
  // Filtering on the due date would file it under the wrong year entirely.
  // §3l: agm_offset used to set periodEnd to the AGM DATE, so AOC-4 and MGT-7
  // were filed under the year of the meeting rather than the year they report
  // on — and choosing 2025-26 hid the two filings that year is mostly about.
  // Their own companions had it right, in adjacent rows.
  [['Section 137; Accounts', 'AOC-4'], ['Section 92', 'MGT-7'],
   ['Section 96', 'the AGM']].forEach(function(pair){
    const r = y26.filter(x => String(x.section).indexOf(pair[0]) === 0)[0];
    ok(pair[1] + ' belongs to the year it reports on, not the year it is due',
       !!r && r.periodEnd === '2026-03-31',
       r ? 'periodEnd ' + r.periodEnd : 'absent from 2025-26');
  });
  ok('and AOC-4 is still DUE after the AGM, which is what the Act says',
     (y26.filter(x => String(x.section).indexOf('Section 137; Accounts') === 0)[0] || {}).due
       > (y26.filter(x => String(x.section).indexOf('Section 96') === 0)[0] || {}).due,
     'the due date moved with the period end, and it should not have');

  // The selector lists the years in the register, so it must see the WHOLE
  // register. A filter that hid years from its own selector could never be
  // turned off again.
  // Compared against itself rather than against a count: after §3l moved the
  // AGM-anchored filings into the year they report on, a private company's
  // register covers ONE year, and an assertion expecting two was really
  // asserting the bug.
  const listedAll = withFy('all', () => app.lgFyList(LISTED));
  const listedFiltered = withFy(listedAll[0] && listedAll[0].fy,
                                () => app.lgFyList(LISTED));
  ok('the year list is the same whether or not a year is selected',
     listedAll.map(y => y.fy).join(',') === listedFiltered.map(y => y.fy).join(','),
     listedAll.map(y=>y.fy).join(',') + '  vs  ' + listedFiltered.map(y=>y.fy).join(','));
  ok('and a listed entity spans more than one year', listedAll.length >= 2,
     listedAll.map(y => y.fy).join(','));
  ok('and allYears bypasses the filter',
     withFy('2025-26', () => app.getComplianceChart(co, { allYears: true })).length === all.length,
     'allYears was filtered');
}

// -- 11n. Amendment evidence, and the in-force guard (SS3t) ---
// The evidence is generated by tools/amendments.py from the texts in
// reference/. These assertions cover two different things: that the extraction
// still says what the held text says, and that the guard reading it can never
// hide an obligation.
describe('amendment evidence');
{
  const A = app.LG_AMEND;
  ok('the evidence is embedded', !!(A && A.laws), 'LG_AMEND missing or empty');

  // Commencement is COMPUTED from the gazette date and the period the
  // instrument states, both quoted in the source. Not remembered: if the
  // compilation is replaced the arithmetic is redone.
  check('LODR commenced on the ninetieth day after 2 September 2015',
        A.laws['SEBI LODR 2015'].commenced, '2015-12-01');
  check('PIT commenced on the hundred-and-twentieth day after 15 January 2015',
        A.laws['SEBI PIT Regulations 2015'].commenced, '2015-05-15');

  // The Act's commencement is per section, and the held footnote mixes the
  // principal Act with later amending Acts. So it is NOT stated, and the
  // reason travels with it.
  check('the Act states no single commencement date',
        A.laws['Companies Act 2013'].commenced, null);
  ok('and it says why not',
     /amending Acts/.test(A.laws['Companies Act 2013'].commencementWarning || ''),
     'no warning explaining the Act has no single commencement');

  // ── the citation parser, tested against the strings the register
  //    actually emits, including the ones it must reject (SS3e's rule:
  //    test the guard's contract, not the data) ──────────────────
  const cited = (law, s) => app.lgAmendCited(law, s).join(',');
  check('Reg 30 parses',            cited('SEBI LODR 2015', 'Reg 30'), '30');
  check('Reg. 2(1)(n) parses',      cited('SEBI LODR 2015', 'Reg. 2(1)(n)'), '2');
  check('Reg 91C keeps its suffix', cited('SEBI LODR 2015', 'Reg 91C'), '91C');
  check('Regulation 33(3)(a) parses',
        cited('SEBI LODR 2015', 'Regulation 33(3)(a)'), '33');
  // "Regulation 30 of LODR" once parsed as reg 30O (SS2h). It must not again.
  check('a following English word is not swallowed',
        cited('SEBI LODR 2015', 'Regulation 30 of LODR'), '30');
  check('Section 92 parses',        cited('Companies Act 2013', 'Section 92'), '92');
  check('Sections 12, 15 parse',    cited('Companies Act 2013', 'Sections 12, 15'), '12,15');
  check('Sec 173(1) parses',        cited('Companies Act 2013', 'Sec 173(1)'), '173');
  check('a law with no citation yields nothing',
        cited('SEBI LODR 2015', 'Schedule III Part A'), '');

  // ── the extraction still agrees with the held text ────────────
  // Each of these was read out of reference/ by hand before being asserted.
  // Reg 13(3) is the one worth keeping: the Third Amendment 2024 commenced 58
  // provisions on 13.12.2024 and this one on 31.12.2024, so a date keyed on
  // the instrument rather than the provision would be eleven days wrong here
  // and wrong in the same way for ten other provisions.
  const P = A.laws['SEBI LODR 2015'].provisions;
  // Reg 13 was amended again on 1 May 2025, so the 31 December date is not
  // its latest -- it is the one whose existence matters, because keying on the
  // instrument instead of the provision would put it eleven days earlier.
  const dates13 = ((P['13'] || {}).recent || []).map(x => x.date);
  ok('Reg 13 carries the 31 December 2024 substitution',
     dates13.indexOf('2024-12-31') >= 0,
     'Reg 13 recent dates are ' + (dates13.join(',') || 'absent'));
  ok('Reg 27 carries it too',
     !!(P['27'] && P['27'].last === '2024-12-31'),
     'Reg 27 latest is ' + ((P['27'] || {}).last || 'absent'));
  ok('Reg 91C carries the 8 September 2025 substitution',
     !!(P['91C'] && P['91C'].last === '2025-09-08'),
     'Reg 91C latest is ' + ((P['91C'] || {}).last || 'absent'));

  // PIT writes its dates with month names -- "(w.e.f. April 01, 2019)". A
  // numeric-only pattern read 2 of 135, so the corpus looked unamended.
  const PP = A.laws['SEBI PIT Regulations 2015'].provisions;
  // If the month-name branch broke, PIT would fall to one or two provisions.
  ok('PIT month-name dates are read', Object.keys(PP).length >= 5,
     'only ' + Object.keys(PP).length + ' PIT provisions carry evidence');

  // ── the guard ─────────────────────────────────────────────────
  // The invariant that matters more than any date: an unknown commencement
  // must ABSTAIN, never hide. A missing net worth skips a s.135 limb (SS2c); a
  // missing year end once assumed 31 March and produced 79 wrong dates (SS3j).
  // This is the same fork, and hiding an obligation is the worse branch.
  const unknown = app.lgRuleInForce('Companies Act 2013', '2016-03-31');
  check('an unknown commencement leaves the row in force', unknown.inForce, true);
  check('and says it assumed nothing', unknown.assumed, true);

  const cont = app.lgRuleInForce('SEBI LODR 2015', null);
  check('a continuous obligation is in force', cont.inForce, true);
  ok('and is not ruled out on commencement',
     /belongs to no period/.test(cont.why || ''), 'wrong reason: ' + cont.why);

  check('a period ending before LODR commenced is not in force',
        app.lgRuleInForce('SEBI LODR 2015', '2015-03-31').inForce, false);
  check('a period ending after it is',
        app.lgRuleInForce('SEBI LODR 2015', '2016-03-31').inForce, true);

  // The boundary, from both sides. A period ending ON the commencement date
  // is in force -- the test is "ended before", not "ended on or before", and
  // an off-by-one here silently removes a quarter's obligations.
  check('a period ending the day before commencement is out',
        app.lgRuleInForce('SEBI LODR 2015', '2015-11-30').inForce, false);
  check('a period ending on the commencement date is in',
        app.lgRuleInForce('SEBI LODR 2015', '2015-12-01').inForce, true);

  // A law nobody has any record of must also abstain rather than vanish.
  const nolaw = app.lgRuleInForce('Some Act Nobody Holds', '2015-01-01');
  check('an unrecognised law leaves the row in force', nolaw.inForce, true);
  check('and is marked as assuming', nolaw.assumed, true);

  // ── evidence lookup ───────────────────────────────────────────
  const e = app.lgAmendFor('SEBI LODR 2015', 'Reg 13(3)');
  ok('evidence is found for a cited provision', !!e, 'no evidence for Reg 13(3)');
  check('and names the provision it came from', e && e.provision, '13');
  ok('a provision with no evidence returns null',
     app.lgAmendFor('SEBI LODR 2015', 'Reg 999') === null,
     'Reg 999 returned something');
  ok('a Schedule citation returns null rather than guessing',
     app.lgAmendFor('SEBI LODR 2015', 'Schedule III Part A') === null,
     'a Schedule citation resolved to a regulation');

  // -- the caveat must not claim an accuracy it does not have ----
  // Marker attribution follows the document's own cross-reference and is
  // exact. Positional attribution places a footnote by where it was printed.
  // Overstating the weaker one is the failure that matters: it would invite a
  // reviewer to trust a note that may belong to the previous page.
  {
    const mk = app.govBasisWords('marker');
    const po = app.govBasisWords('positional');
    ok('the marker wording says the marker was followed',
       /following the footnote marker/.test(mk), mk);
    ok('the positional wording says it was placed by position',
       /where the footnote sits/.test(po), po);
    ok('the positional wording does not claim the marker was followed',
       !/following the footnote marker/.test(po), 'positional borrows marker wording');
    ok('the positional wording says why there is no marker to follow',
       /restarts its footnote numbering/.test(po), po);
    // An unknown basis must fall to the weaker claim, never the stronger.
    ok('an unrecognised basis is described as positional',
       /where the footnote sits/.test(app.govBasisWords('something-else')),
       'an unknown basis claimed marker accuracy');
  }

  // -- the review queue's ORDER, which is the whole feature ------
  // Most recently amended first: the rule whose provision moved last year is a
  // different prospect from one untouched since 2015, and a flat list said
  // neither. Reversed, this would look just as busy and be exactly backwards.
  {
    const R = [
      { id: 'a', law: 'SEBI LODR 2015', section: 'Reg 33' },   // last 2024-12-13
      { id: 'b', law: 'SEBI LODR 2015', section: 'Reg 91C' },  // last 2025-09-08
      { id: 'c', law: 'SEBI LODR 2015', section: 'Reg 27' },   // last 2024-12-31
      { id: 'd', law: 'SEBI LODR 2015', section: 'Schedule III Part A' }, // no evidence
      { id: 'e', law: 'SEBI LODR 2015', section: 'Reg 13' }    // checked already
    ];
    const stateOf = (r) => r.id === 'e' ? 'current' : 'unverified';
    const q = app.govAmendedQueue(R, stateOf);
    check('the queue puts the most recently amended first',
          q.map(x => x.rule.id).join(''), 'bca');
    ok('a rule already checked is not queued',
       q.every(x => x.rule.id !== 'e'), 'a verified rule is in the queue');
    ok('a rule with no amendment evidence is not queued',
       q.every(x => x.rule.id !== 'd'), 'a rule with no evidence is in the queue');

    // Two rules amended on the same day must not swap places between renders.
    const T = [{ id: 'z', law: 'SEBI LODR 2015', section: 'Reg 33' },
               { id: 'y', law: 'SEBI LODR 2015', section: 'Reg 30' }];
    const t1 = app.govAmendedQueue(T, () => 'unverified').map(x => x.rule.id).join('');
    const t2 = app.govAmendedQueue(T.slice().reverse(), () => 'unverified')
                  .map(x => x.rule.id).join('');
    check('the order does not depend on the input order', t1, t2);
  }

  // hasOmissionNote is evidence, not a verdict. An Omitted footnote inside
  // Reg 30's span means a sub-clause went, not Reg 30 -- surfacing it as a
  // warning flagged 102 rules including the whole of Schedule III.
  // SEBI footnote numbers are unique document-wide so a marker identifies one
  // footnote exactly; the Act restarts numbering per page, so there is nothing
  // to follow and position is all there is. Different bases, stated.
  check('SEBI evidence is attributed by marker',
        A.laws['SEBI LODR 2015'].basis, 'marker');
  check('Act evidence is attributed by position',
        A.laws['Companies Act 2013'].basis, 'positional');

  ok('the omission flag is named so it cannot read as a verdict',
     !('omitted' in (P['30'] || {})) && ('hasOmissionNote' in (P['30'] || {})),
     'the field is still called "omitted"');
}

// -- 11p. A date anchored to a recorded meeting is traceable ---
// SS2k's invariant is that a rule with no offset must not carry a date. SS2l then
// added the one legitimate way it does: from a meeting the practice recorded.
// The back-test never allowed for it, so the first entity with a results board
// meeting had its correctly-anchored Reg 47(1) date reported as the 31 March
// defect. No test entity had ever had one.
describe('event-anchored dates are traceable');
{
  const M = { id:'ANCH-1', name:'Anchor Co', type:'listed', fyend:'2026-03-31',
              capital: 48 * 10000000, turnover: 612 * 10000000,
              networth: 340 * 10000000, netprofit: 42 * 10000000,
              borrowings: 120 * 10000000, cin:'L17110MH2009PLC195422', chart:{} };
  const prevC = app.CLIENTS, prevR = app.LG_REGS;
  app.CLIENTS = [M];
  app.LG_REGS = { directors:[], meetings:[
      { id:'am1', company_id:'ANCH-1', kind:'board', held_on:'2026-08-07',
        mode:'physical', quorum_met:true, approved_results:true,
        minutes_state:'signed', minutes_signed_on:'2026-08-26' }
    ], charges:[], allotments:[], beneficial_interests:[], designated_persons:[],
    upsi_events:[], upsi_access:[], pre_clearances:[] };

  const rows = app.getComplianceChart(M);
  const anchored = rows.filter(r => r.due && r.anchoredTo);
  ok('the meeting produced a dated obligation', anchored.length > 0,
     'nothing was anchored to the recorded meeting');
  ok('and the row names the meeting date it ran from',
     anchored.every(r => /^\d{4}-\d{2}-\d{2}$/.test(String(r.anchoredTo))),
     'an anchored row does not carry a date in anchoredTo');

  const bt = app.lgBackTest();
  const spurious = (bt.findings || []).filter(f =>
    f.sev === 'fail' && /no stated offset/.test(f.check || ''));
  ok('the back-test does not call an anchored date the 31 March defect',
     spurious.length === 0,
     spurious.map(f => f.detail).join(' | '));

  // And the guard still bites: strip the anchor and it must be reported again.
  const stripped = rows.filter(r => r.due && r.dueConfidence === 'derived' && r.anchoredTo);
  ok('a derived date with no anchor would still be a defect',
     stripped.length > 0, 'no derived+anchored row to reason about');

  app.CLIENTS = prevC; app.LG_REGS = prevR;
}

// -- 11q. SEBI Depositories & Participants 2018 (SS3x) ---------
// The first corpus in this project read out of a held text rather than
// generated from the owner's spreadsheet. Two things have to hold: it binds
// only the ISSUER, and no undated row hides a period that the regulation
// actually states.
describe('depositories corpus');
{
  const D = app.DEPOS_DATA;
  ok('the corpus is loaded', !!(D && D.rules && D.rules.length), 'DEPOS_DATA missing');
  check('eleven issuer obligations', (D.rules || []).length, 11);

  // Every rule carries the words it came from. This corpus was hand-authored,
  // so the quote is the only thing standing between it and an assertion.
  //
  // Length alone is too weak -- a quote truncated past its opening words stays
  // long and stops being evidence. What has to survive is the part that makes
  // it an obligation at all: the duty-holder and the verb that binds them.
  const unquoted = (D.rules || []).filter(r =>
    !r.quote || r.quote.length < 60 ||
    !/shall/i.test(r.quote) || !/issuer/i.test(r.quote));
  ok('every rule quotes its provision, with the duty-holder and "shall" intact',
     unquoted.length === 0,
     unquoted.map(r => r.id + ': ' + String(r.quote || '').slice(0, 50)).join(' | '));

  // The regulation also binds depositories (41-57, 73, 82), participants
  // (58-69, 81) and beneficial owners. Handing a listed company NSDL's duties
  // is SS2z's defect: wrong law against the wrong entity.
  const ISSUER = ['70', '71', '72', '74', '75', '76', '77', '78'];
  const strayed = (D.rules || []).filter(r => {
    const m = /Reg (\d{1,3})/.exec(r.regulation || '');
    return !m || ISSUER.indexOf(m[1]) < 0;
  });
  ok('no rule reaches outside the issuer provisions',
     strayed.length === 0,
     strayed.map(r => r.id + ' -> ' + r.regulation).join(', '));

  const CRd = 10000000;
  const L = { id:'DEP-L', name:'Listed', type:'listed', fyend:'2026-03-31',
              capital: 48*CRd, turnover: 612*CRd, networth: 340*CRd,
              netprofit: 42*CRd, borrowings: 120*CRd,
              cin:'L17110MH2009PLC195422', chart:{} };
  const P = { id:'DEP-P', name:'Private', type:'private', fyend:'2026-03-31',
              capital: 5*CRd, turnover: 40*CRd, networth: CRd, netprofit: CRd,
              borrowings: 0, cin:'U51909MH2018PTC300111', chart:{} };
  const depRows = (c) => app.getComplianceChart(c)
                            .filter(r => /Depositories/.test(r.law || ''));

  ok('a listed issuer receives them', depRows(L).length > 0, 'none on a listed entity');
  check('an unlisted private company receives none', depRows(P).length, 0);

  // Reg 76(1) recurs quarterly and states NO period. It must produce one row
  // per quarter -- evidence is recorded per row -- and NOT invent a date.
  // SS2k: a rule with no offset must not carry one.
  const rsca = depRows(L).filter(r => /76\(1\)/.test(r.section || ''));
  check('the share capital audit produces four quarterly rows', rsca.length, 4);
  ok('and none of them carries an invented date',
     rsca.every(r => !r.due), rsca.map(r => r.due).join(','));

  // THE INVARIANT THAT MATTERS. A row whose own timelineText states a number of
  // days must, if it has no date, explain why -- or a CS reads "deadline not
  // established" against Reg 72 and concludes there is no thirty-day rule.
  const silent = depRows(L).filter(r =>
    !r.due && /\b(thirty|fifteen|twenty one|twenty-one|\d+)\s+days?\b/i.test(r.timelineText || '')
          && !app.lgNoDeadlineWhy(r));
  ok('an undated row never hides a period the regulation states',
     silent.length === 0,
     silent.map(r => r.section + ' says "' + r.timelineText + '"').join(' | '));

  // The three certainties, so a later edit cannot quietly soften them.
  const says = (reg, word) => {
    const r = (D.rules || []).filter(x => x.regulation === reg)[0];
    return r && new RegExp(word, 'i').test(r.quote || '');
  };
  ok('Reg 72 quotes thirty days', says('Reg 72', 'within thirty days'), 'quote changed');
  ok('Reg 74(5) quotes fifteen days', says('Reg 74(5)', 'within fifteen days'), 'quote changed');
  ok('Reg 76(2) quotes twenty one days', says('Reg 76(2)', 'twenty one days'), 'quote changed');
}

// -- 11r. Companies Act supplement (SS3y) ----------------------
// Eleven obligations the generated corpus did not carry, read from the held
// Act. Hand-authored, so the quote is the only thing between a rule and an
// assertion nobody can check.
describe('companies act supplement');
{
  const CS = app.CA_SUP_DATA;
  ok('the supplement is loaded', !!(CS && CS.rules && CS.rules.length), 'CA_SUP_DATA missing');
  check('eleven obligations', (CS.rules || []).length, 11);

  // THE INVARIANT. Where a rule states a period, that period must appear in
  // the quote. Otherwise the register asserts a number the evidence beside it
  // does not support -- and a hand-authored corpus has nothing else holding it
  // to the text.
  const WORDS = /(one hundred and eighty|forty-five|twenty-one|fifteen|thirty|seven|sixty|ninety|three|two|one)\s+(working\s+)?(days?|months?|years?)/gi;
  const unsupported = [];
  (CS.rules || []).forEach(r => {
    const q = (r.quote || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    const said = (r.timelineText || '').match(WORDS) || [];
    said.forEach(s => {
      const norm = s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (q.replace(/\s+/g, ' ').indexOf(norm) < 0) unsupported.push(r.id + ' claims "' + s + '"');
    });
  });
  ok('every period a rule states appears in the words it quotes',
     unsupported.length === 0, unsupported.join(' | '));

  const unquoted = (CS.rules || []).filter(r => !r.quote || r.quote.length < 60);
  ok('every rule carries a substantial quote', unquoted.length === 0,
     unquoted.map(r => r.id).join(', '));

  // Entity scoping -- three of the eleven bind one class only, and getting
  // that wrong is SS2z's defect.
  const CRs = 10000000;
  const mk = (t, cin) => ({ id:'SUP-'+t, name:t, type:t, fyend:'2026-03-31',
    capital: 5*CRs, turnover: 40*CRs, networth: CRs, netprofit: CRs,
    borrowings: 0, cin: cin, chart: {} });
  const supOf = (c) => app.getComplianceChart(c)
    .filter(r => /CA-SUP/.test(r.key || ''));
  const has = (c, sec) => supOf(c).some(r => (r.section || '').indexOf(sec) >= 0);

  const listed = mk('listed', 'L17110MH2009PLC195422');
  const priv   = mk('private', 'U51909MH2018PTC300111');
  const opc    = mk('opc', 'U74999MH2020OPC300222');

  // s.121 says "Every listed public company" in terms.
  ok('the AGM report binds a listed company', has(listed, 'Section 121'), 'missing on listed');
  ok('and no one else', !has(priv, 'Section 121') && !has(opc, 'Section 121'),
     'Section 121 reached an unlisted company');

  // s.193 is a One Person Company provision.
  ok('the OPC contract intimation binds an OPC', has(opc, 'Section 193'), 'missing on OPC');
  ok('and no one else', !has(listed, 'Section 193') && !has(priv, 'Section 193'),
     'Section 193 reached a company that is not an OPC');

  // s.129A applies to a prescribed class of UNLISTED companies.
  ok('periodical financial results do not reach a listed company',
     !has(listed, 'Section 129A'), 'Section 129A reached a listed company');

  // An OPC holds no general meeting, so a requisition for one cannot arise.
  ok('the EGM requisition does not reach an OPC',
     !has(opc, 'Section 100'), 'Section 100 reached a One Person Company');

  // s.121 is AGM-anchored and therefore gets a real date, unlike the rest.
  const rep121 = supOf(listed).filter(r => (r.section||'').indexOf('Section 121') >= 0)[0];
  ok('the AGM report carries a computed date', !!(rep121 && rep121.due),
     'Section 121 has no due date');

  // s.124 is a COMPOUND period and the shape is the trap: thirty days from
  // declaration, THEN seven to transfer. A rule that states only one of them
  // would be wrong by a month or by a week.
  const s124 = (CS.rules || []).filter(r => r.regulation === 'Section 124(1)')[0];
  ok('the unpaid dividend rule states both legs of its period',
     /thirty days/i.test(s124.timelineText) && /seven days/i.test(s124.timelineText),
     s124.timelineText);
}

// -- 11s. LODR Chapter IV supplement (SS3z) --------------------
// Eighteen obligations of an equity-listed entity that the generated corpus
// did not carry, read from the held regulation. Hand-authored, so the quote is
// the only thing standing between a rule and an assertion nobody can check.
describe('lodr chapter IV supplement');
{
  const LS = app.LODR_SUP_DATA;
  ok('the supplement is loaded', !!(LS && LS.rules && LS.rules.length), 'LODR_SUP_DATA missing');
  check('eighteen obligations', (LS.rules || []).length, 18);

  // THE INVARIANT (SS3y). Where a rule states a period, that period must appear
  // in the quote. Nothing upstream constrains a hand-authored corpus; without
  // this the register could assert a number the evidence beside it contradicts.
  const WORDS = /\b(one hundred and eighty|twenty[- ]?one|forty[- ]?five|one|two|three|four|five|six|seven|ten|fifteen|twenty|thirty|sixty|ninety)\s+(working\s+)?(days?|months?|years?)\b/gi;
  const unsupported = [];
  (LS.rules || []).forEach(r => {
    const q = (r.quote || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
    const said = (r.timelineText || '').match(WORDS) || [];
    said.forEach(s => {
      const norm = s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (q.indexOf(norm) < 0) unsupported.push(r.id + ' claims "' + s + '"');
    });
  });
  ok('every period a rule states appears in the words it quotes',
     unsupported.length === 0, unsupported.join(' | '));

  // A quote that cannot show who is bound is not evidence of anything (SS3x).
  const unbound = (LS.rules || []).filter(r =>
    !r.quote || r.quote.length < 60 || !/shall/i.test(r.quote));
  ok('every quote carries the binding verb', unbound.length === 0,
     unbound.map(r => r.id).join(', '));

  // Chapter IV binds a listed entity. Chapters VII-IX bind the issuers of IDRs,
  // securitised debt and mutual fund units; Chapter X binds the exchanges.
  // Handing any of those to a company is SS2z's defect.
  const CRs = 10000000;
  const mk = (t, cin) => ({ id:'SUP-L-'+t, name:t, type:t, fyend:'2026-03-31',
    capital: 5*CRs, turnover: 40*CRs, networth: CRs, netprofit: CRs,
    borrowings: 0, cin: cin, chart: {} });
  const supOf = (c) => app.getComplianceChart(c).filter(r => /^LODR-SUP/.test(r.key || ''));

  const listed = mk('listed', 'L17110MH2009PLC195422');
  check('a listed entity receives all eighteen', supOf(listed).length, 18);
  check('a private company receives none', supOf(mk('private','U51909MH2018PTC300111')).length, 0);
  check('a public unlisted company receives none', supOf(mk('public','U51909MH2015PLC300444')).length, 0);
  check('an OPC receives none', supOf(mk('opc','U74999MH2020OPC300222')).length, 0);
  check('an LLP receives none', supOf(mk('llp','AAB-1234')).length, 0);

  // SS2k. Every rule here runs from an event this app holds no register of, or
  // counts in working days with no exchange holiday calendar to count against.
  // A date on any of them would be invented.
  const dated = supOf(listed).filter(r => r.due);
  ok('no supplement row carries a date', dated.length === 0,
     dated.map(r => r.section + '=' + r.due).join(', '));

  const byReg = {};
  (LS.rules || []).forEach(r => { byReg[r.regulation] = r; });

  // Reg 42's two periods were SWAPPED by the Third Amendment 2024 w.e.f.
  // 13.12.2024 -- the general record-date notice went seven working days down
  // to three, and the scheme-of-arrangement notice three up to seven. Both
  // figures are entirely plausible in either position, which is exactly what
  // makes having them the wrong way round so hard to see.
  const r42 = byReg['Reg 42'];
  ok('the record-date notice is three working days', /at least three working days in advance/i.test(r42.timelineText), r42.timelineText);
  ok('and seven for a scheme of arrangement', /at least seven working days for corporate actions/i.test(r42.timelineText), r42.timelineText);
  ok('with five working days between two record dates', /at least five working days between two record dates/i.test(r42.timelineText), r42.timelineText);

  // Reg 31A(3)(a) is FOUR deadlines in one sequence, each from a different
  // event. The thirty days in limb (iv) is the EXCHANGE's and is not here.
  const r31a = byReg['Reg 31A(3)(a)'];
  ['two months', 'five days', 'sixty days'].forEach(p => {
    ok('the reclassification sequence states ' + p,
       r31a.timelineText.toLowerCase().indexOf(p) >= 0, r31a.timelineText);
  });
  ok('and does not claim the exchange’s thirty days as the company’s',
     !/thirty days/i.test(r31a.timelineText), r31a.timelineText);

  // SS3y's s.84 lesson. Reg 30A(1)'s two working days binds the SHAREHOLDERS,
  // PROMOTERS, DIRECTORS, KMP and EMPLOYEES who are parties to the agreement --
  // it runs TO the listed entity, not from it. The entity's own period is
  // whatever the Board specifies. Claiming the two days would put a deadline on
  // this register that the company does not owe.
  const r30a = byReg['Reg 30A'];
  ok('the agreements disclosure does not claim the parties’ two working days',
     !/two working days/i.test(r30a.timelineText), r30a.timelineText);
  ok('and says the Board specifies its timing',
     /specified by the Board/i.test(r30a.timelineText), r30a.timelineText);

  // Reg 41(9)/(10) and Reg 43(3)/(5) were OMITTED w.e.f. 13.12.2024 and the
  // compilation still prints their wording, in footnotes. Carrying either would
  // reinstate an obligation SEBI deleted -- SS3e's trap.
  ['Reg 41', 'Reg 43(1)'].forEach(k => {
    const r = byReg[k];
    check(k + ' is a standing duty, not a dated one', (r.due || {}).type, 'continuous');
    ok(k + ' states no period', !WORDS.test(r.timelineText || ''), r.timelineText);
    WORDS.lastIndex = 0;
  });

  // SS3i: the audit answer is not "it is not on the list" but "it is not on the
  // list BECAUSE". For an unlisted company every one of these must appear as
  // excluded WITH a reason -- which is also what makes appliesTo load-bearing
  // here, since the register call itself sits behind an isListed guard.
  const exc = app.lgExcludedFor(mk('private','U51909MH2018PTC300111'))
    .filter(e => /^Reg /.test(e.section || '') &&
                 (LS.rules || []).some(r => r.regulation === e.section));
  check('a private company is told all eighteen do not apply', exc.length, 18);
  const noReason = exc.filter(e => !e.reasons || !e.reasons.length);
  ok('and is given a reason for every one', noReason.length === 0,
     noReason.map(e => e.section).join(', '));

  // SS3e/SS3x: a blank is not an explanation. "Ongoing / event-driven" reads the
  // same for a period that is CERTAIN whose anchor this app does not hold, for
  // one the Board specifies, and for a rule that fixes an order rather than a
  // period. A CS reading a blank against Reg 26A could conclude there is no
  // three-month rule -- there is.
  const statesPeriod = (LS.rules || []).filter(r => {
    WORDS.lastIndex = 0; return WORDS.test(r.timelineText || '');
  });
  const unexplained = statesPeriod.filter(r => !app.lgNoDeadlineWhy({ key: r.id, due: null }));
  ok('every undated rule that states a period explains why it has no date',
     unexplained.length === 0, unexplained.map(r => r.id).join(', '));

  // And the explanation must carry the REASON, not just words. Reg 29 counts
  // backward in working days with no exchange holiday calendar here.
  const why29 = app.lgNoDeadlineWhy({ key: 'LODR-SUP-REG-29-1', due: null }) || '';
  ok('the prior-intimation explanation gives the working-day reason',
     /working day/i.test(why29) && /calendar/i.test(why29), why29.slice(0, 90));
  const why30a = app.lgNoDeadlineWhy({ key: 'LODR-SUP-REG-30A', due: null }) || '';
  ok('the agreements explanation says whose the two working days is',
     /two working days/i.test(why30a) && /not yours|binds the shareholders/i.test(why30a),
     why30a.slice(0, 90));

  // SS3e's contract test: an explanation must never attach to a row that HAS a
  // date. Sweeping the real rows cannot see this, because none of them is dated.
  ok('a dated row is offered no explanation',
     app.lgNoDeadlineWhy({ key: 'LODR-SUP-REG-29-1', due: '2026-10-30' }) === null,
     'an explanation was offered for a row that already has a date');

  // Two offices, two sub-regulations, two separate rules. Filling the Managing
  // Director's chair does not answer for the Chief Financial Officer's.
  ok('the CEO/MD and the CFO vacancies are separate rules',
     !!byReg['Reg 26A(1)'] && !!byReg['Reg 26A(2)'] &&
     byReg['Reg 26A(1)'].id !== byReg['Reg 26A(2)'].id, 'one of them is missing');
}

// -- 11t. A missing date is not a date (SS3z) -----------------
// Found by driving the real register, not by any suite: ccFmtDate had no null
// guard, so new Date(null) gave the epoch and every undated row rendered
// '1 Jan 1970'. With the Universe sorted by due date ascending that put 212 of
// 278 rows ABOVE every real deadline. 66 call sites pass optional values
// (r.due, filed, held, signed, certOn), so this was never one screen.
describe('a missing date is not a date');
{
  const EM = '—';
  [null, undefined, ''].forEach((v, i) => {
    ok('a missing date (' + ['null','undefined','empty'][i] + ') is not formatted as one',
       app.ccFmtDate(v) === EM, String(app.ccFmtDate(v)));
  });
  ok('an unparseable date is not formatted as one',
     app.ccFmtDate('not a date') === EM, String(app.ccFmtDate('not a date')));
  ok('nothing renders as the epoch', !/1970/.test(String(app.ccFmtDate(null))),
     String(app.ccFmtDate(null)));
  // and the happy path is untouched
  check('a real date still formats', app.ccFmtDate('2026-10-30'), '30 Oct 2026');

  // The property at the register level, which is where it was seen.
  const CRt = 10000000;
  const lc = { id:'FMT-1', name:'fmt', type:'listed', fyend:'2026-03-31',
    capital: 5*CRt, turnover: 40*CRt, networth: CRt, netprofit: CRt,
    borrowings: 0, cin:'L17110MH2009PLC195422', chart:{} };
  const undated = app.getComplianceChart(lc).filter(r => !r.due);
  const epoch = undated.filter(r => /19[0-9]{2}/.test(String(app.ccFmtDate(r.due))));
  ok('no undated row on the register formats to a 20th-century date',
     epoch.length === 0, epoch.length + ' of ' + undated.length + ' undated rows');
}

// -- 11u. PIT supplement (SS4a) -------------------------------
// Eleven obligations of a listed company that the generated corpus did not
// carry. Two different gaps: whole provisions absent (Reg 6, 7I, 7J) and
// SUB-PROVISIONS of provisions already cited (Reg 3 has six sub-regulations
// and the corpus cites two; Reg 9A has seven and the corpus cites three limbs
// of one).
describe('pit supplement');
{
  const PS = app.PIT_SUP_DATA;
  ok('the supplement is loaded', !!(PS && PS.rules && PS.rules.length), 'PIT_SUP_DATA missing');
  check('eleven obligations', (PS.rules || []).length, 11);

  // THE INVARIANT (SS3y/SS3z).
  const WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|fifteen|thirty|sixty|ninety)\s+(working\s+|trading\s+|calendar\s+)?(days?|months?|years?)\b/gi;
  const unsupported = [];
  (PS.rules || []).forEach(r => {
    const q = (r.quote || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
    const said = (r.timelineText || '').match(WORDS) || [];
    said.forEach(s => {
      const norm = s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (q.indexOf(norm) < 0) unsupported.push(r.id + ' claims "' + s + '"');
    });
  });
  ok('every period a rule states appears in the words it quotes',
     unsupported.length === 0, unsupported.join(' | '));

  // PIT uses three binding forms, not one: a duty ("shall"), a nullity
  // ("is void", Reg 7J) and a permissive gateway ("is of informed opinion",
  // Reg 3(3)). A quote that shows none of them cannot show who is bound.
  const unbound = (PS.rules || []).filter(r =>
    !r.quote || r.quote.length < 60 ||
    !/\bshall\b|\bis void\b|\bis of informed opinion\b/i.test(r.quote));
  ok('every quote carries a binding form', unbound.length === 0,
     unbound.map(r => r.id).join(', '));

  // THE TRAP THIS CORPUS HAD TO AVOID. Reg 5A-5H is the MUTUAL FUND UNITS
  // chapter -- it binds asset management companies and trustees. Reg 5C is the
  // mirror of Reg 3 and Reg 5H the mirror of Reg 9A, and Reg 5D alone states
  // five periods. Every one of them belongs to an AMC. Citing that chapter
  // here would hand a listed issuer somebody else's obligations (SS2z).
  const mf = (PS.rules || []).filter(r => /^Reg 5[A-H]\b/.test(r.regulation || ''));
  ok('no rule cites the mutual fund units chapter', mf.length === 0,
     mf.map(r => r.regulation).join(', '));
  // Nor the informant provisions that bind the Board rather than the company.
  const board = (PS.rules || []).filter(r =>
    /^Reg 7(?:A|B|C|D|E|F|G|H|K|L|M)\b/.test(r.regulation || ''));
  ok('no rule cites the provisions that bind the Board or the informant',
     board.length === 0, board.map(r => r.regulation).join(', '));

  const CRp = 10000000;
  const mkp = (t, cin) => ({ id:'SUP-P-'+t, name:t, type:t, fyend:'2026-03-31',
    capital: 5*CRp, turnover: 40*CRp, networth: CRp, netprofit: CRp,
    borrowings: 0, cin: cin, chart: {} });
  const supP = (c) => app.getComplianceChart(c).filter(r => /^PIT-SUP/.test(r.key || ''));
  const listedP = mkp('listed', 'L17110MH2009PLC195422');

  check('a listed company receives all eleven', supP(listedP).length, 11);
  check('a private company receives none', supP(mkp('private','U51909MH2018PTC300111')).length, 0);
  check('a public unlisted company receives none', supP(mkp('public','U51909MH2015PLC300444')).length, 0);
  check('an LLP receives none', supP(mkp('llp','AAB-1234')).length, 0);

  const datedP = supP(listedP).filter(r => r.due);
  ok('no supplement row carries a date', datedP.length === 0,
     datedP.map(r => r.section + '=' + r.due).join(', '));

  // SS3i: an unlisted company must be told these do not apply, and why.
  const excP = app.lgExcludedFor(mkp('private','U51909MH2018PTC300111'))
    .filter(e => (PS.rules || []).some(r => r.regulation === e.section));
  check('a private company is told all eleven do not apply', excP.length, 11);
  ok('and is given a reason for every one',
     excP.every(e => e.reasons && e.reasons.length), 'a reason is missing');

  const byRegP = {};
  (PS.rules || []).forEach(r => { byRegP[r.regulation] = r; });

  // TWO DIFFERENT RETENTION PERIODS IN ONE REGULATION. Reg 3(6) preserves the
  // structured digital database for eight years; Reg 6(4) keeps the Chapter III
  // disclosures for five. Using one for the other loses three years of records
  // -- and unlike a missed filing, a destroyed record cannot be put back.
  ok('the structured digital database is kept eight years',
     /eight years/i.test(byRegP['Reg 3(6)'].timelineText), byRegP['Reg 3(6)'].timelineText);
  ok('the insider disclosures are kept five years',
     /five years/i.test(byRegP['Reg 6(4)'].timelineText), byRegP['Reg 6(4)'].timelineText);
  ok('and the two are not the same period',
     byRegP['Reg 3(6)'].timelineText !== byRegP['Reg 6(4)'].timelineText, 'they match');

  // Reg 3(5)'s two calendar days is for information from OUTSIDE only.
  ok('the database entry window is two calendar days',
     /2 calendar days|two calendar days/i.test(byRegP['Reg 3(5)'].timelineText),
     byRegP['Reg 3(5)'].timelineText);

  // Reg 3(3) counts TRADING days, backward from the transaction.
  ok('the pre-transaction disclosure counts trading days',
     /two trading days/i.test(byRegP['Reg 3(3)'].timelineText), byRegP['Reg 3(3)'].timelineText);

  // Reg 9A(4) is the annual Audit Committee review -- the one most likely to be
  // missed outright, because nothing files anywhere when it happens.
  ok('the Audit Committee review is annual',
     /once in a financial year/i.test(byRegP['Reg 9A(4)'].timelineText),
     byRegP['Reg 9A(4)'].timelineText);
  ok('and its quote requires BOTH review and verification',
     /review compliance/i.test(byRegP['Reg 9A(4)'].quote) &&
     /verify/i.test(byRegP['Reg 9A(4)'].quote), byRegP['Reg 9A(4)'].quote.slice(0, 80));

  // SS3e: a blank is not an explanation.
  const statesP = (PS.rules || []).filter(r => { WORDS.lastIndex = 0; return WORDS.test(r.timelineText || ''); });
  const unexplainedP = statesP.filter(r => !app.lgNoDeadlineWhy({ key: r.id, due: null }));
  ok('every undated rule that states a period explains why it has no date',
     unexplainedP.length === 0, unexplainedP.map(r => r.id).join(', '));
  const why36 = app.lgNoDeadlineWhy({ key: 'PIT-SUP-REG-3-6', due: null }) || '';
  ok('the eight-year explanation says it is retention, not a deadline',
     /retention/i.test(why36), why36.slice(0, 90));
}

// -- 11v. LODR debt chapters, and the flag that reaches them (SS4b) ----
// The corpus was never the blocker. lodrListingTypes reads ncsListed and hvdle;
// nothing set either, so 20 rules the corpus ALREADY SHIPPED could not apply to
// any entity - Reg 52 (financial results for debt), Reg 53, Reg 54 (asset
// cover), Reg 61A, Reg 62A among them. A rule that never applies looks exactly
// like a rule that correctly does not apply, which is why nothing reported it.
describe('lodr debt chapters');
{
  const LD = app.LODR_DEBT_DATA;
  ok('the debt corpus is loaded', !!(LD && LD.rules && LD.rules.length), 'LODR_DEBT_DATA missing');
  check('twenty-seven obligations', (LD.rules || []).length, 27);

  const WORDS = /\b(one|two|three|four|five|six|seven|ten|fifteen|thirty|sixty|ninety)\s+(working\s+|trading\s+|calendar\s+)?(days?|months?|years?)\b/gi;
  const unsupported = [];
  (LD.rules || []).forEach(r => {
    const q = (r.quote || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
    const said = (r.timelineText || '').match(WORDS) || [];
    said.forEach(s => {
      const norm = s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (q.indexOf(norm) < 0) unsupported.push(r.id + ' claims "' + s + '"');
    });
  });
  ok('every period a rule states appears in the words it quotes',
     unsupported.length === 0, unsupported.join(' | '));

  const unbound = (LD.rules || []).filter(r =>
    !r.quote || r.quote.length < 70 || !/\bshall\b/i.test(r.quote));
  ok('every quote carries a binding verb', unbound.length === 0,
     unbound.map(r => r.id).join(', '));

  // Reg 64I binds the RECOGNISED STOCK EXCHANGES to monitor compliance, and
  // Reg 49 / 62B are applicability and definitions. None creates a duty here.
  const notOurs = (LD.rules || []).filter(r =>
    /^Reg (?:49|62B|64I)\b/.test(r.regulation || ''));
  ok('no rule cites an applicability, definition or exchange-facing provision',
     notOurs.length === 0, notOurs.map(r => r.regulation).join(', '));

  const CRd = 10000000;
  const mkd = (o) => Object.assign({ id:'DBT', name:'DBT', type:'private',
    fyend:'2026-03-31', capital:5*CRd, turnover:40*CRd, networth:CRd,
    netprofit:CRd, borrowings:0, cin:'U51909MH2018PTC300111', chart:{} }, o);
  const debtRows = (c) => app.getComplianceChart(c).filter(r => /^LODR-DEBT/.test(r.key || ''));
  const hasReg = (c, s) => debtRows(c).some(r => r.section === s);

  // WHAT IS LISTED, not what class the entity is. A private company with listed
  // non-convertible debentures owes Chapter V and owes nothing under Chapter IV,
  // so this cannot be expressed as entityType - and the register call for this
  // corpus deliberately sits OUTSIDE the if(isListed) guard.
  check('a private company with no debt listing gets none', debtRows(mkd({})).length, 0);
  ok('a private company WITH listed NCDs gets Chapter V',
     debtRows(mkd({ ncsListed: true })).length > 0, 'the debt-only issuer got nothing');
  check('an equity-listed company with no debt listing gets none',
     debtRows(mkd({ type:'listed', cin:'L17110MH2009PLC195422' })).length, 0);

  // Chapter V-A is the HVDLE governance regime and is a separate fact from ncs.
  ok('the HVDLE governance rules reach a HVDLE',
     hasReg(mkd({ ncsListed:true, hvdle:true }), 'Reg 62P'), 'Reg 62P missing on a HVDLE');
  ok('and not an ordinary debt-listed issuer',
     !hasReg(mkd({ ncsListed:true }), 'Reg 62P'), 'Reg 62P reached a non-HVDLE');
  ok('the HVDLE threshold rule reaches a HVDLE',
     hasReg(mkd({ ncsListed:true, hvdle:true }), 'Reg 62C'), 'Reg 62C missing on a HVDLE');
  ok('and not an ordinary debt-listed issuer either',
     !hasReg(mkd({ ncsListed:true }), 'Reg 62C'), 'Reg 62C reached a non-HVDLE');

  // Reg 63 and Reg 64 bind an entity with BOTH listings. That is an AND.
  const bothL = mkd({ type:'listed', cin:'L17110MH2009PLC195422', ncsListed:true });
  ['Reg 63', 'Reg 64'].forEach(s => {
    ok(s + ' reaches an entity with both listings', hasReg(bothL, s), s + ' missing');
    ok(s + ' does not reach a debt-only issuer', !hasReg(mkd({ ncsListed:true }), s),
       s + ' reached an entity with no listed equity');
    ok(s + ' does not reach an equity-only issuer',
       !hasReg(mkd({ type:'listed', cin:'L17110MH2009PLC195422' }), s),
       s + ' reached an entity with no listed debt');
  });

  // SS3e's rule: test the guard's contract, not only the data.
  const rule = (a) => ({ appliesTo: a });
  ok('cmApplies honours listingType as ANY',
     app.cmApplies(rule({ listingType:['ncs'] }), mkd({ ncsListed:true })) === true &&
     app.cmApplies(rule({ listingType:['ncs'] }), mkd({})) === false, 'listingType ignored');
  ok('cmApplies honours listingTypeAll as ALL',
     app.cmApplies(rule({ listingTypeAll:['equity','ncs'] }), bothL) === true &&
     app.cmApplies(rule({ listingTypeAll:['equity','ncs'] }), mkd({ ncsListed:true })) === false,
     'listingTypeAll behaved as ANY');

  const datedD = debtRows(bothL).filter(r => r.due);
  ok('no debt row carries a date', datedD.length === 0,
     datedD.map(r => r.section + '=' + r.due).join(', '));

  // THE REVIVAL. These are rules the corpus already shipped, scoped ncs or
  // hvdle with no equity limb. Before db/026 not one could apply to anybody.
  // This is the assertion that would have caught the original bug.
  const secsOf = (c) => new Set(app.getComplianceChart(c).map(r => r.section));
  const equityOnly = secsOf(mkd({ type:'listed', cin:'L17110MH2009PLC195422' }));
  const withFlags = secsOf(mkd({ type:'listed', cin:'L17110MH2009PLC195422',
                                 ncsListed:true, hvdle:true }));
  const revived = ['Reg 52(1)', 'Reg 53', 'Reg 54(1)', 'Reg 61A(1)', 'Reg 62A'];
  const stillDead = revived.filter(s => !withFlags.has(s));
  ok('the debt-scoped rules the corpus already shipped are now reachable',
     stillDead.length === 0, 'still unreachable: ' + stillDead.join(', '));
  ok('and they are absent from an entity with no debt listing',
     revived.every(s => !equityOnly.has(s)),
     'a debt rule reached an entity with no listed debt');
}

// -- 11w. the verification queue, scoped to the book (SS4c) ----
// Rule Governance listed all 405 rules. On an equity-listed book 179 of them
// can never apply - they belong to LLPs, OPCs, debt-only issuers and unlisted
// companies - and verifying those is work nobody needs done. The queue has sat
// untouched since v157, and being four times longer than the job is part of why.
describe('verification queue scoping');
{
  const CRg = 10000000;
  const mkg = (t, cin, o) => Object.assign({ id:'G-'+t, name:t, type:t,
    fyend:'2026-03-31', capital:5*CRg, turnover:40*CRg, networth:CRg,
    netprofit:CRg, borrowings:0, cin: cin, chart:{} }, o || {});
  const all = app.lgAllRules();
  const unv = () => 'unverified';

  const listedBook = [mkg('listed', 'L17110MH2009PLC195422')];
  const llpBook    = [mkg('llp', 'AAB-1234')];

  ok('the corpus is large enough to be worth scoping', all.length > 300, all.length);

  const scoped = app.govOnBook(all, listedBook);
  ok('scoping to one listed company drops most of the corpus',
     scoped.length > 0 && scoped.length < all.length,
     scoped.length + ' of ' + all.length);

  // SS3a's rule for lgScopeToOrg, same reasoning: a filter that empties the
  // screen before any company has loaded reads as "no rules to check", which is
  // the opposite of true. An empty book must return everything.
  check('an empty book returns the whole corpus, not nothing',
        app.govOnBook(all, []).length, all.length);
  check('a null book returns the whole corpus too',
        app.govOnBook(all, null).length, all.length);

  // An LLP has no Board and no LODR (SS2z). Scoping to an LLP book must not
  // offer LODR rules for verification.
  const llpScoped = app.govOnBook(all, llpBook);
  const lodrOnLlp = llpScoped.filter(r => /LODR/i.test(r.law || ''));
  ok('scoping to an LLP book offers no LODR rules to verify',
     lodrOnLlp.length === 0, lodrOnLlp.map(r => r.section).slice(0, 4).join(', '));
  ok('and it is smaller than a listed book', llpScoped.length < scoped.length,
     llpScoped.length + ' vs ' + scoped.length);

  // Adding a company can only ADD rules to verify, never remove them.
  const twoBook = listedBook.concat([mkg('private', 'U51909MH2018PTC300111')]);
  ok('adding a company never shrinks the worklist',
     app.govOnBook(all, twoBook).length >= scoped.length,
     'the book grew and the list got smaller');

  // -- what the amended queue does NOT carry ---------------------
  // govAmendedQueue drops a rule with no amendment evidence, and that is
  // deliberate and asserted above: "amended since it was written" is what it
  // says. What must not happen is the count reading as the whole worklist.
  const gap = app.govQueueGap(scoped, unv);
  check('the gap accounts for every open rule', gap.queued + gap.missing, gap.open);
  ok('the ordered queue is smaller than the worklist', gap.queued < gap.open,
     gap.queued + ' of ' + gap.open);
  ok('and the shortfall is reported, not implied', gap.missing > 0,
     'nothing is reported as missing, so the note would never show');

  // A rule already checked is not "still to check".
  const oneDone = (r) => r.id === scoped[0].id ? 'current' : 'unverified';
  ok('a verified rule leaves the worklist',
     app.govQueueGap(scoped, oneDone).open === gap.open - 1,
     'verifying a rule did not reduce the open count');

  // The screen must only claim what it counted: with the filter on, the tab
  // counts and the gap describe the SAME list.
  ok('the gap is computed from the scoped list, not the corpus',
     app.govQueueGap(scoped, unv).open < app.govQueueGap(all, unv).open,
     'scoping did not change the worklist size');
}

// ── 12. Dashboard invariants ────────────────────────────────────────────────────────────────────────
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

  // ── the gauge has to be able to move ──────────────────────
  // It divided by stats.verified until v183. stats.verified counts FILED /
  // FILED_LATE / PUBLISHED, and §7 records that those are structurally
  // unreachable: no source is connected, so a recorded filing resolves to
  // FILED_PENDING. The first number on the dashboard therefore read 0% for
  // everyone, forever, and nothing noticed because nothing asserted it.
  {
    const COV = { id:'COV-1', name:'Coverage Co', type:'private', fyend:'2026-03-31',
                  capital: 5 * 10000000, turnover: 40 * 10000000,
                  networth: 10000000, netprofit: 10000000, borrowings: 0,
                  cin:'U51909MH2018PTC300111', chart:{} };
    const prev = app.CLIENTS;

    app.CLIENTS = [COV];
    const bare = app.ccComputeStats();
    check('with nothing recorded the gauge reads zero', bare.health, 0);

    // Record a filing against every row that has fallen due.
    const today = app.audIso(new Date());
    const due = app.getComplianceChart(COV).filter(r => r.due && String(r.due) <= today);
    ok('the fixture has something to record against', due.length > 0,
       'no past-due rows to evidence');
    due.forEach(r => {
      COV.chart[r.key] = { status:'done', filedOn:r.due, completedOn:r.due,
                           filingRef:'AA' + (1000000 + r.key.length),
                           recordedBy:'maker', recordedAt:r.due,
                           checkState:'verified', verifiedBy:'checker', verifiedAt:r.due,
                           confidence:'high' };
    });
    const filled = app.ccComputeStats();

    // The contract, stated so it cannot regress to a dead counter: every one of
    // these filings sits in FILED_PENDING, so verified is still zero — and the
    // gauge must still move, because it measures the record, not a source.
    check('none of them reaches a source-verified state', filled.verified, 0);
    ok('but the evidence is counted', filled.evidenceOnRecord >= due.length,
       'evidenceOnRecord is ' + filled.evidenceOnRecord + ' for ' + due.length + ' filings');
    ok('and the gauge moves off zero', filled.health > 0,
       'health stayed at ' + filled.health + ' with ' + filled.evidenceOnRecord +
       ' filings on record');
    ok('coverage is the same number', filled.coverage === filled.health,
       'coverage and health disagree');

    // It measures the record, so it can never exceed it.
    ok('the gauge never exceeds the share actually evidenced',
       filled.health <= Math.round(100 * filled.evidenceOnRecord / filled.totalObligations) + 1,
       'health ' + filled.health + ' exceeds the evidenced share');

    app.CLIENTS = prev;
  }

  const byLaw = {};
  [LISTED, PRIVATE].forEach(c => rowsFor(c).forEach(r => {
    byLaw[r.law] = (byLaw[r.law] || 0) + 1;
  }));
  check('the by-law legend sums to the total',
        Object.values(byLaw).reduce((a, b) => a + b, 0), s.totalObligations);
}

// The access-check assertions are async — they drive a stubbed database through
// a promise. Everything above is synchronous, so the report has to wait for
// them or it would print before they had run.
(async function(){
  try{ if(EXPORT_CHECKS) await EXPORT_CHECKS(); }
  catch(e){ console.log('export check block threw: ' + (e && e.message)); process.exit(1); }
  try{ if(ACCESS_CHECKS) await ACCESS_CHECKS(); }
  catch(e){ console.log('access check block threw: ' + (e && e.message)); process.exit(1); }
  process.exit(report());
})();
