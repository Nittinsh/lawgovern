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

  // -- the spreadsheet importer (SS3r) ------------------------
  // Every figure in the product arrives through this path and none of it was
  // covered. The first mutation is the bug that was actually shipping.

  { name: 'the strict numeric test goes, so "250 lakh" is 250 crore again (SS3r)',
    from: "  if(!/^[+-]?(\\d+\\.?\\d*|\\.\\d+)(e[+-]?\\d+)?$/i.test(s))\n    return {issue:'\"' + s0 + '\" is not a number this can read'};",
    to:   "  if(false)\n    return {issue:'\"' + s0 + '\" is not a number this can read'};" },

  { name: 'lakh converts as though it were crore (SS3r - a hundredfold)',
    from: "  [/\\blakh?s?\\b|\\blac?s?\\b/i,      0.01],",
    to:   "  [/\\blakh?s?\\b|\\blac?s?\\b/i,      1]," },

  { name: 'million and crore are treated alike (SS3r)',
    from: "  [/\\bmn\\b|\\bmillions?\\b/i,        0.1],",
    to:   "  [/\\bmn\\b|\\bmillions?\\b/i,        1]," },

  // The order matters and is easy to get wrong: strip the spaces first and
  // "250 lakh" becomes "250lakh", where \blakh\b no longer matches because
  // there is no word boundary between "0" and "l". The unit is then missed
  // entirely. (The first attempt at this mutation only appended a comment,
  // which changed nothing and was reported as MISSED — correctly.)
  { name: 'spaces are stripped before the unit is read (SS3r - \\b stops matching)',
    from: "  var mult = 1;\n  for(var i = 0; i < BULK_UNITS.length; i++){",
    to:   "  s = s.replace(/[,\\s]/g, '');\n  var mult = 1;\n  for(var i = 0; i < BULK_UNITS.length; i++){" },

  { name: 'a loss in brackets loses its sign (SS3r)',
    from: "  if(neg) n = -n;\n  return {value:n,",
    to:   "  return {value:n," },

  { name: 'rupees pasted into a crore column stop being questioned (SS3r)',
    from: "      if(Math.abs(m.value) >= BULK_IMPLAUSIBLE_CR)",
    to:   "      if(false)" },

  { name: 'the implausible threshold is raised past any real sheet (SS3r)',
    from: "var BULK_IMPLAUSIBLE_CR = 100000;",
    to:   "var BULK_IMPLAUSIBLE_CR = 1e18;" },

  { name: 'a row wider than its header is dropped in silence again (SS3r)',
    from: "    if(cells.length > map.length)",
    to:   "    if(false)" },

  { name: 'two rows for one company stop being flagged (SS3r)',
    from: "      if(seenCin[k]) r._issues.push('same CIN as the row on line '+seenCin[k]);",
    to:   "      if(false) r._issues.push('same CIN as the row on line '+seenCin[k]);" },

  { name: 'a repeated company name stops being flagged (SS3r)',
    from: "      if(n && seenName[n]) r._issues.push('same name as the row on line '+seenName[n]);",
    to:   "      if(false) r._issues.push('same name as the row on line '+seenName[n]);" },

  { name: 'the quoted-field splitter forgets its quotes (SS3r)',
    from: "    if(ch === '\"'){ if(q && line[i+1]==='\"'){ cur+='\"'; i++; } else q=!q; }",
    to:   "    if(ch === '\"'){ cur+='\"'; }" },

  { name: 'an Excel tab paste is split on commas instead (SS3r)',
    from: "  if(line.indexOf('\\t') >= 0) return line.split('\\t');",
    to:   "  if(false) return line.split('\\t');" },

  { name: 'an unrecognised entity type is accepted in silence (SS3r)',
    from: "      else { issues.push('Unrecognised type \"'+rec.type+'\" — defaulting to Private Limited'); rec.type='private'; }",
    to:   "      else { rec.type='private'; }" },

  { name: 'a sheet with neither name nor CIN is accepted (SS3r)',
    from: "  if(map.indexOf('name') < 0 && map.indexOf('cin') < 0)",
    to:   "  if(false)" },

  // ── landmarks and control names (§3q) ───────────────────────
  // Facts about the markup, so they are caught by smoke.test.js — which the
  // runner only started exercising when these were written.

  { name: 'the main landmark is removed (§3q — nothing to skip to)',
    from: '<div class="appmain" role="main" id="appmain" tabindex="-1">',
    to:   '<div class="appmain" id="appmain" tabindex="-1">' },

  { name: 'the navigation landmark is removed (§3q)',
    from: '<aside class="appside" role="navigation" aria-label="Sections">',
    to:   '<aside class="appside">' },

  { name: 'the banner landmark is removed (§3q)',
    from: '<div class="appheader" role="banner">',
    to:   '<div class="appheader">' },

  { name: 'the skip link is removed (§3q — thirty tab stops to the content)',
    from: '<a class="skip-link" href="#appmain">Skip to main content</a>',
    to:   '' },

  { name: 'the skip target cannot take focus (§3q — scrolls, then Tab goes back to the nav)',
    from: 'id="appmain" tabindex="-1"',
    to:   'id="appmain"' },

  { name: 'the skip link stays off-screen when focused (§3q — present but invisible)',
    from: '.skip-link:focus{left:0;}',
    to:   '.skip-link:focus{left:-9999px;}' },

  { name: 'the skip link is always on screen (§3q — it should hide until focused)',
    from: '.skip-link{position:absolute;left:-9999px;',
    to:   '.skip-link{position:absolute;left:0;' },

  { name: 'the settings toggles stop being switches (§3q — announce as "button")',
    from: '\'" role="switch" \'+',
    to:   '\'" \'+' },

  { name: 'the settings toggles lose their name (§3q)',
    from: 'aria-label="\'+entEsc(label)+\'" \'+',
    to:   '\'+' },

  { name: 'the register entity picker loses its name — nine panels at once (§3q)',
    from: 'entSel = \'<select class="lg-field" aria-label="Entity" onchange="REG_ENTITY[\'',
    to:   'entSel = \'<select class="lg-field" onchange="REG_ENTITY[\'' },

  { name: 'a universe filter loses its name (§3q)',
    from: '<select aria-label="Filter by risk" onchange="cuSetFilter(\\\'risk\\\',this.value)">',
    to:   '<select onchange="cuSetFilter(\\\'risk\\\',this.value)">' },

  { name: 'the entity form caption goes back to a div (§3q — text on screen, tied to nothing)',
    from: "'<label for=\"'+id+'\" style=\"display:block;font-size:11px;color:var(--ink-soft);'+",
    to:   "'<div style=\"font-size:11px;color:var(--ink-soft);'+" },

  { name: 'the document stops declaring a language (§3q)',
    from: '<html lang="en">',
    to:   '<html>' },

  // ── one render, one chart per company (§3p) ─────────────────
  // The dangerous ones here are not the slow ones. A pass that outlives its
  // render is a cache with no lifetime, and every reader after it gets rows
  // that were true when the pass opened.

  { name: 'the render pass is never closed (§3p — a cache with no lifetime)',
    from: "  try{ return fn(); }\n  finally{ LG_CHART_PASS = null; }",
    to:   "  try{ return fn(); }\n  finally{ }" },

  { name: 'a throw leaves the pass open (§3p)',
    from: "  LG_CHART_PASS = {};\n  try{ return fn(); }\n  finally{ LG_CHART_PASS = null; }",
    to:   "  LG_CHART_PASS = {};\n  var r = fn(); LG_CHART_PASS = null; return r;" },

  { name: 'an inner pass empties the outer one (§3p — badges run inside the dashboard)',
    from: "  if(LG_CHART_PASS) return fn();\n  LG_CHART_PASS = {};",
    to:   "  LG_CHART_PASS = {};" },

  { name: 'the options drop out of the key (§3p — allYears served from the plain chart)',
    from: "  var k = c.id + '|' + Object.keys(superOpts).sort().map(function(x){\n    return x + '=' + superOpts[x]; }).join(',');",
    to:   "  var k = c.id;" },

  { name: 'the key stops sorting, so option order makes a second entry (§3p)',
    from: "  var k = c.id + '|' + Object.keys(superOpts).sort().map(function(x){",
    to:   "  var k = c.id + '|' + Object.keys(superOpts).map(function(x){" },

  { name: 'the plain register keeps the rows marked not applicable (§3p)',
    from: "  return wantNA ? v.slice() : v.filter(function(r){ return !r.userNA; });",
    to:   "  return v.slice();" },

  { name: 'the includeNA register loses them instead (§3p)',
    from: "  return wantNA ? v.slice() : v.filter(function(r){ return !r.userNA; });",
    to:   "  return v.filter(function(r){ return !r.userNA; });" },

  { name: 'the array is handed out uncopied, so one sort reorders everyone (§3p)',
    from: "  if(!Array.isArray(v)) return v;\n  // Both branches return a NEW array",
    to:   "  if(!Array.isArray(v)) return v;\n  if(wantNA) return v;\n  // Both branches return a NEW array" },

  { name: 'the superset is not built, so includeNA loses its rows (§3p)',
    from: "  superOpts.includeNA = true;",
    to:   "  superOpts.includeNA = wantNA;" },

  { name: 'the dashboard stops opening a pass (§3p — back to 150 builds)',
    from: "  return lgChartPass(renderCommandCenterInner);",
    to:   "  return renderCommandCenterInner();" },

  // ── the paged register (§3o) ────────────────────────────────
  // Each of these leaves a register that looks perfectly normal. The clamp is
  // the dangerous one: an empty table reads as "nothing matches", which is a
  // false statement about the register rather than a slow screen.

  { name: 'a page past the end is no longer pulled back (§3o — empty table)',
    from: "  if(p >= pageCount) p = pageCount - 1;",
    to:   "  if(p > pageCount) p = pageCount - 1;" },

  { name: 'the clamp lands on the FIRST page instead of the last (§3o)',
    from: "  if(p >= pageCount) p = pageCount - 1;\n  if(p < 0) p = 0;",
    to:   "  if(p >= pageCount) p = 0;\n  if(p < 0) p = 0;" },

  { name: 'an empty result reports zero pages (§3o — "Page 1 of 0")',
    from: "  var pageCount = Math.max(1, Math.ceil(matched / Math.max(1, pageSize)));",
    to:   "  var pageCount = Math.ceil(matched / Math.max(1, pageSize));" },

  { name: 'the page runs to the end of the register (§3o — every row again)',
    from: "  return { rows: (size > 0) ? rows.slice(from, from + pageSize) : rows,",
    to:   "  return { rows: (size > 0) ? rows.slice(from) : rows," },

  { name: 'an exact multiple gains an empty last page (§3o)',
    from: "  var pageCount = Math.max(1, Math.ceil(matched / Math.max(1, pageSize)));\n  var p = page;",
    to:   "  var pageCount = Math.max(1, Math.floor(matched / Math.max(1, pageSize)) + 1);\n  var p = page;" },

  { name: 'the register goes back to rendering every row by default (§3o)',
    from: "var CU_PAGE_SIZE = 100;",
    to:   "var CU_PAGE_SIZE = 0;" },

  { name: '"all rows" stops being offered (§3o — truncation with no way out)',
    from: "var CU_PAGE_SIZES = [[100,'100 a page'],[250,'250 a page'],[0,'All rows']];",
    to:   "var CU_PAGE_SIZES = [[100,'100 a page'],[250,'250 a page']];" },

  { name: 'filtering leaves you on the page you were on (§3o)',
    from: "function cuSetFilter(k,v){ CU_FILTERS[k]=v; cuPageReset(); if(k==='q'){",
    to:   "function cuSetFilter(k,v){ CU_FILTERS[k]=v; if(k==='q'){" },

  { name: 'sorting leaves you on the page you were on (§3o)',
    from: "function cuSort(col){ if(CU_SORT.col===col) CU_SORT.dir*=-1; else {CU_SORT.col=col;CU_SORT.dir=1;} cuPageReset(); renderUniverse(); }",
    to:   "function cuSort(col){ if(CU_SORT.col===col) CU_SORT.dir*=-1; else {CU_SORT.col=col;CU_SORT.dir=1;} renderUniverse(); }" },

  { name: 'clearing the filters leaves you deep in the pages (§3o)',
    from: "listing:''}; cuPageReset(); renderUniverse(); }",
    to:   "listing:''}; renderUniverse(); }" },

  { name: 'the footer stops naming the matching total (§3o — a page reads as the whole)',
    from: "        ? 'Rows <b>'+(pageFrom+1)+'&ndash;'+Math.min(pageFrom+pageSize, matched)+\n          '</b> of <b>'+matched+'</b> matching'",
    to:   "        ? 'Rows <b>'+(pageFrom+1)+'&ndash;'+Math.min(pageFrom+pageSize, matched)+'</b>'" },

  { name: 'the export starts exporting only the page (§3o)',
    from: "function cuExport(){\n  var rows=cuBuildRows();",
    to:   "function cuExport(){\n  var rows=cuBuildRows().slice(CU_PAGE*CU_PAGE_SIZE, (CU_PAGE+1)*CU_PAGE_SIZE);" },

  { name: 'the discarded rebuild comes back on every keystroke (§3o)',
    from: "    renderUniverse();\n    var qi=document.getElementById('cu-q');",
    to:   "    var all=cuBuildRows(); renderUniverse();\n    var qi=document.getElementById('cu-q');" },

  // ── penalties: one source, and the AI deadline (§3n) ────────
  // The first three restore the defect the audit found — a second copy of these
  // figures, carrying the law as it stood before the Companies (Amendment) Act
  // 2020. Every one of them produces a number a CS would repeat to a director.

  { name: 'the Penalties screen goes back to its own stale copy (§3n)',
    from: "    var v = lgPenaltyFor(f.form);",
    to:   "    var v = null;" },

  { name: 'AOC-4 reverts to the pre-2020 rate and cap (§3n)',
    from: "    co: {who:'The company', base:10000, day:100, dayFrom:'each-day', cap:200000},\n    off:{who:'The MD and the CFO; failing them, the director charged by the Board; failing him '+",
    to:   "    co: {who:'The company', base:0, day:1000, dayFrom:'each-day', cap:1000000},\n    off:{who:'The MD and the CFO; failing them, the director charged by the Board; failing him '+" },

  { name: 'MGT-7A stops resolving, so a real form silently loses its penalty (§3n)',
    from: "  'MGT-7':'mgt7', 'MGT-7A':'mgt7',",
    to:   "  'MGT-7':'mgt7'," },

  { name: 'the form lookup stops tolerating case (§3n)',
    from: "  var k = LG_PENALTY_FORM[String(formName || '').trim().toUpperCase()];",
    to:   "  var k = LG_PENALTY_FORM[String(formName || '')];" },

  { name: 'a leg with no maximum goes quiet instead of saying so (§3n)',
    from: "         (leg.cap != null ? ', <b>max '+calcMoney(leg.cap)+'</b>'\n                          : ', <b>no maximum stated</b>');",
    to:   "         (leg.cap != null ? ', <b>max '+calcMoney(leg.cap)+'</b>' : '');" },

  { name: 'a court-fixed fine is presented as an accruing penalty (§3n)',
    from: "  if(leg.kind === 'fine')\n    return calcMoney(leg.min)+' to '+calcMoney(leg.max)+' &mdash; a <b>fine</b>, fixed by a court';",
    to:   "  if(leg.kind === 'fine')\n    return calcMoney(leg.min)+' to '+calcMoney(leg.max);" },

  { name: 'a flat penalty stops saying it does not accrue (§3n)',
    from: "    return calcMoney(leg.base)+' &mdash; fixed, it does not grow by the day';",
    to:   "    return calcMoney(leg.base);" },

  { name: 'the chat bank starts quoting penalties again (§3n)',
    from: '<strong>Key Penalties</strong><br><br>These are not listed here any more.',
    to:   '<strong>Key Penalties</strong><br><br>AOC-4: Penalty Rs.1,000/day (max Rs.10 Lakh).' },

  { name: 'the MGT-8 conflict is hidden again (§3n)',
    from: "<strong>The register in this app disagrees.</strong>",
    to:   "<strong>The register agrees.</strong>" },

  { name: 'the AI call loses its deadline (§3n — the button spins for ever)',
    from: "      signal: ctl ? ctl.signal : undefined",
    to:   "      signal: undefined" },

  { name: 'the HTTP status stops being checked (§3n — a 502 reads as a JSON error)',
    from: "  if(!res.ok){",
    to:   "  if(false){" },

  { name: 'a timeout so long it is no timeout at all (§3n)',
    from: "var LG_AI_TIMEOUT_MS = 45000;",
    to:   "var LG_AI_TIMEOUT_MS = 3600000;" },

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
  // ── SS3t: amendment evidence and the in-force guard ─────────
  // The first is the one that matters. Every other bug here shows a wrong
  // answer; this one shows NO answer, and an obligation that silently stops
  // appearing is the only failure in this product a CS cannot notice.
  { name: 'an unknown commencement date hides the row (SS3t — the one that must never happen)',
    from: 'if(!c) return { inForce:true, assumed:true, from:null,',
    to:   'if(!c) return { inForce:false, assumed:true, from:null,' },

  { name: 'a continuous obligation is tested against commencement (SS3t)',
    from: 'if(!periodEnd) return { inForce:true, from:c,',
    to:   'if(false) return { inForce:true, from:c,' },

  { name: 'the commencement boundary excludes its own date (SS3t — off by one day)',
    from: 'if(String(periodEnd) < String(c)) return { inForce:false, from:c,',
    to:   'if(String(periodEnd) <= String(c)) return { inForce:false, from:c,' },

  { name: 'LODR commencement off by a day (SS3t — 90th day miscounted)',
    from: '"commenced":"2015-12-01"',
    to:   '"commenced":"2015-11-30"' },

  // The Act's commencement footnote mixes the principal Act with later
  // amending Acts, so no single date is establishable. Inventing one is the
  // SS3j defect: a missing year end that assumed 31 March produced 79 wrong
  // dates, and every one looked computed.
  { name: 'the Act is given a commencement date the text does not establish (SS3t)',
    from: '"commenced":null',
    to:   '"commenced":"2014-04-01"' },

  // SS2h, arriving in a second parser. "Regulation 30 of LODR" once parsed as
  // reg 30O because [A-Z] matches lowercase under /i and \s* crossed the space.
  { name: 'the evidence citation parser swallows a following word (SS3t r/w SS2h)',
    from: "var re2 = /\\bReg(?:ulation)?s?\\.?\\s*(\\d{1,3}[A-Z]{0,2})(?![A-Za-z0-9])/ig;",
    to:   "var re2 = /\\bReg(?:ulation)?s?\\.?\\s*(\\d{1,3}\\s*[A-Z]{0,2})/ig;" },

  { name: 'evidence is returned for a provision that has none (SS3t)',
    from: 'if(rec) return { provision: ps[i], law: law, rec: rec, corpus: L };',
    to:   'return { provision: ps[i], law: law, rec: rec, corpus: L };' },

  // Prefilling the instrument is a convenience. Saving is an assertion that a
  // person checked the provision. govSave already refuses an empty instrument
  // because "a verification with no instrument behind it records nothing more
  // than a date" (SS2s) — filling it from a machine and then saving defeats
  // exactly that guard.
  { name: 'using the evidence also records the verification (SS3t)',
    from: '  if(a) a.focus();',
    to:   '  if(a) a.focus();\n  govSave(0);' },

  // The dangerous direction. Positional attribution claiming the marker was
  // followed invites a reviewer to trust a footnote that may belong to the
  // previous page -- and the Act, the one corpus that can only be placed by
  // position, is also the stale one where care matters most.
  { name: 'positional evidence claims the footnote marker was followed (SS3t)',
    from: "  return 'Attributed by where the footnote sits in the text, not by reading it, because this '+",
    to:   "  return 'Tied to this provision by following the footnote marker in the text. '+" },

  // The ordering IS the feature. Reversed, the queue looks just as busy and
  // starts with the rule least likely to have gone stale.
  { name: 'the review queue is ordered oldest-amendment first (SS3t)',
    from: 'return a.last < b.last ? 1 : -1;',
    to:   'return a.last < b.last ? -1 : 1;' },

  { name: 'the review queue includes rules already checked (SS3t)',
    from: "if(st !== 'unverified' && st !== 'flagged') continue;",
    to:   "if(false) continue;" },

  // Proves the new CSS-variable check earns its place: two undefined variables
  // shipped in v182 and the class check could not see them, because they are
  // not classes.
  { name: 'a style points at a CSS variable that does not exist (SS3t r/w SS2x)',
    from: '.gov-am{font-size:11px;color:var(--ink-soft);margin-top:3px;}',
    to:   '.gov-am{font-size:11px;color:var(--ink-4);margin-top:3px;}' },

  // ── SS3u: the demo, the landing, and what they exposed ──────
  // The gauge divided by stats.verified, which counts FILED / FILED_LATE /
  // PUBLISHED -- states that are structurally unreachable because nothing
  // verifies against MCA21 (SS7). So the first number on the dashboard read 0%
  // for every user on every book, forever, and nothing asserted it.
  { name: 'the coverage gauge divides by a counter that is always zero (SS3u)',
    from: 'Math.round(100 * stats.evidenceOnRecord / t)',
    to:   'Math.round(100 * stats.verified / t)' },

  // SS2l gives a rule with no offset a date from a meeting the practice
  // recorded. Without the exemption the back-test calls that the 31 March
  // defect -- which it did, the first time an entity had a results meeting.
  { name: 'the back-test calls an anchored date the 31 March defect (SS3u)',
    from: "r.dueConfidence === 'derived' && !r.anchoredTo",
    to:   "r.dueConfidence === 'derived'" },

  // ── SS3u/SS3v: the sign-in screen stays the login card ──────
  // Neither the demo nor the landing page was removed because it was broken,
  // so neither would look wrong if it crept back in. These two prove the
  // guards that keep them out actually fire.
  { name: 'a demo entry point creeps back onto the login card (SS3v)',
    from: 'Forgot your password?</a></div>',
    to:   'Forgot your password?</a> <a href="?demo=1">Try the demo</a></div>' },

  { name: 'a marketing page creeps back in front of the login card (SS3v)',
    from: '<div id="auth-overlay" style="display:none;',
    to:   '<div id="auth-overlay" class="lgland" style="display:none;' },
  // ── SS3x: SEBI (Depositories and Participants) 2018 ─────────
  // The regulation binds depositories, participants and beneficial owners as
  // well as issuers. Giving a listed company a depository's duties, or an
  // unlisted company an obligation that files with an exchange it is not on,
  // is SS2z's defect: wrong law against the wrong entity.
  { name: 'depositories obligations reach an unlisted company (SS3x r/w SS2z)',
    from: "rows = rows.concat(cmRows(DEPOS_DATA, c, agm, 'depos'));",
    to:   "rows = rows.concat(cmRows(DEPOS_DATA, c, agm, 'depos'));\n    }\n    {" },

  // Reg 76(1) states the cadence and NOT the deadline. Marking it exact lets
  // the engine emit the quarter end as the due date -- SS2k's 31 March defect,
  // on a filing a practising CS signs.
  { name: 'the share capital audit is given a date the regulation never states (SS3x r/w SS2k)',
    from: '"dueConfidence":"derived","appliesTo":{"entityType":["listed"]},"appliesToText":"Listed issuer - the report goes to the stock exchanges"',
    to:   '"dueConfidence":"exact","appliesTo":{"entityType":["listed"]},"appliesToText":"Listed issuer - the report goes to the stock exchanges"' },

  // This corpus was hand-authored rather than generated, so the verbatim quote
  // is the only thing between a rule and an assertion nobody can check.
  { name: 'a hand-authored rule loses the words it came from (SS3x)',
    from: '"quote":"Every issuer shall submit audit report on a quarterly basis',
    to:   '"quote":"quarterly basis' },

  // "Deadline not established" against Reg 72 would read as "there is no
  // thirty-day rule". There is one, and it is in the regulation's own words.
  { name: 'an undated row stops explaining the period it hides (SS3x r/w SS3e)',
    from: "'DEPOS-REG-72': '<b>Thirty days is certain</b>",
    to:   "'DEPOS-REG-72-DISABLED': '<b>Thirty days is certain</b>" },
  // ── SS3y: Companies Act obligations the corpus did not carry ─
  // s.121 says "Every listed public company" in terms. Widening it puts an
  // MGT-15 on the register of every private company in the book -- a filing
  // that is not owed, which SS2n records as the same defect as inventing a date
  // for one that is.
  { name: 'the AGM report reaches companies that are not listed (SS3y r/w SS2z)',
    from: '"appliesTo":{"entityType":["listed"]},"appliesToText":"Every listed public company"',
    to:   '"appliesTo":{"entityType":["listed","private","public"]},"appliesToText":"Every listed public company"' },

  // s.193 is a One Person Company provision. Every other class would get an
  // intimation duty for contracts with a sole member it does not have.
  { name: 'the OPC contract intimation reaches every company (SS3y r/w SS2z)',
    from: '"appliesTo":{"entityType":["opc"]},"appliesToText":"One Person Company contracting',
    to:   '"appliesTo":{"entityType":["opc","private","public","listed"]},"appliesToText":"One Person Company contracting' },

  // s.124 is COMPOUND: thirty days from declaration, THEN seven to transfer.
  // Stating one leg is wrong by a month or by a week on money that belongs to
  // shareholders.
  { name: 'the unpaid dividend period loses one of its two legs (SS3y)',
    from: '"timelineText":"Within seven days of the expiry of thirty days from declaration - i.e. by day 37"',
    to:   '"timelineText":"Within thirty days of declaration"' },

  // A hand-authored corpus is held to its text by one thing: the period it
  // claims must appear in the words it quotes.
  { name: 'a rule claims a period its own quote does not support (SS3y)',
    from: '"timelineText":"Within one hundred and eighty days of the date of incorporation"',
    to:   '"timelineText":"Within ninety days of the date of incorporation"' },
  // ── SS3z: LODR Chapter IV obligations the corpus did not carry ─
  // The Third Amendment 2024 SWAPPED these on 13.12.2024: the general
  // record-date notice went from seven working days to three, and the
  // scheme-of-arrangement notice from three to seven. Both figures are
  // entirely plausible in either position, so having them the wrong way round
  // does not look wrong -- it looks like a rule.
  { name: 'the record-date periods are swapped back (SS3z)',
    from: '"timelineText":"At least three working days in advance, excluding the date of intimation and the record date; at least seven working days for corporate actions through a scheme of arrangement under Reg 37;',
    to:   '"timelineText":"At least seven working days in advance, excluding the date of intimation and the record date; at least three working days for corporate actions through a scheme of arrangement under Reg 37;' },

  // Reg 30A(1)'s two working days binds the SHAREHOLDERS, PROMOTERS, DIRECTORS,
  // KMP and EMPLOYEES who are parties to the agreement -- it runs TO the listed
  // entity, not from it. Reading the period without reading the subject is how
  // a deadline the company does not owe reaches its register (SS3y, s.84).
  { name: 'the agreements disclosure claims the parties’ deadline as the company’s (SS3z)',
    from: '"timelineText":"Within the timelines as specified by the Board"',
    to:   '"timelineText":"Within two working days of entering into the agreement"' },

  // SS2k. Every rule in this corpus runs from an event no register here holds,
  // or counts working days with no exchange holiday calendar. A date on any of
  // them is invented -- the 31 March defect arriving in a new law.
  { name: 'a supplement rule starts producing a computed date (SS3z r/w SS2k)',
    from: '"due":{"type":"at_trigger","when":"Before every record date"}',
    to:   '"due":{"type":"annual"}' },

  // The invariant that holds a hand-authored corpus to its text: the period a
  // rule states must appear in the words it quotes.
  { name: 'a rule states a period its own quote no longer supports (SS3z)',
    from: 'Manager shall be filled by the listed entity at the earliest and in any case not later than three months',
    to:   'Manager shall be filled by the listed entity at the earliest and in any case not later than six months' },

  // Chapter IV binds a listed entity. Giving its obligations to a private
  // company is SS2z's defect -- wrong law against the wrong entity class.
  { name: 'Chapter IV obligations reach an unlisted company (SS3z r/w SS2z)',
    from: '"appliesTo":{"entityType":["listed"]},"appliesToText":"Every listed entity convening a board meeting on a listed proposal"',
    to:   '"appliesTo":{"entityType":["listed","private","public"]},"appliesToText":"Every listed entity convening a board meeting on a listed proposal"' },
  // SS3e: a blank is not an explanation. Losing the reason leaves 'Ongoing /
  // event-driven' standing alone against a rule whose three months is certain,
  // and a CS could read that as there being no deadline at all.
  { name: 'an undated rule stops saying why it has no date (SS3z r/w SS3e)',
    from: "'LODR-SUP-REG-26A-1': '<b>Three months is certain</b>",
    to:   "'LODR-SUP-REG-26A-1-disabled': '<b>Three months is certain</b>" },
  // The guard that stops a missing date rendering as the epoch. Without it
  // new Date(null) is 1 Jan 1970, and the register sorts by due date ascending
  // so every undated row climbs above every real deadline.
  { name: 'a missing date renders as the epoch again (SS3z r/w SS2k)',
    from: "  if(d === null || d === undefined || d === '') return",
    to:   "  if(false) return" },
  // ── SS4a: PIT obligations of a listed company the corpus did not carry ─
  // TWO RETENTION PERIODS IN ONE REGULATION: the structured digital database
  // is kept eight years (Reg 3(6)), the Chapter III disclosures five
  // (Reg 6(4)). Swapping them loses three years of the record that proves who
  // held UPSI -- and unlike a missed filing, a destroyed record cannot be put
  // back.
  { name: 'the database retention drops to the disclosure period (SS4a)',
    from: '"timelineText":"Not less than eight years after completion of the relevant transactions',
    to:   '"timelineText":"Not less than five years after completion of the relevant transactions' },

  { name: 'the disclosure retention rises to the database period (SS4a)',
    from: '"timelineText":"A minimum period of five years"',
    to:   '"timelineText":"A minimum period of eight years"' },

  // Reg 9A(4) is the annual Audit Committee review, and it is the obligation
  // in this corpus most likely to be missed outright: nothing files anywhere
  // when it happens, so only the minutes show it was done.
  { name: 'the Audit Committee review loses its annual cadence (SS4a)',
    from: '"timelineText":"At least once in a financial year"',
    to:   '"timelineText":"Periodically"' },

  // Reg 3(3) counts TRADING days and runs backward from the transaction.
  // Calendar days would place the disclosure later than the regulation allows.
  { name: 'the pre-transaction disclosure counts calendar days (SS4a)',
    from: '"timelineText":"Generally available at least two trading days prior to the transaction being effected',
    to:   '"timelineText":"Generally available at least two calendar days prior to the transaction being effected' },

  // Reg 5A-5H is the MUTUAL FUND UNITS chapter -- Reg 5C is the mirror of
  // Reg 3 and Reg 5H the mirror of Reg 9A. Citing it here would put an asset
  // management company's obligations on a listed issuer's register (SS2z).
  { name: 'a rule is re-cited to the mutual fund chapter (SS4a r/w SS2z)',
    from: '"regulation":"Reg 3(5)"',
    to:   '"regulation":"Reg 5C"' },

  // PIT does not bite on an unlisted company at all. Mutate appliesTo, NOT
  // appliesToText: the first is what cmApplies reads, the second is a label.
  // Written against the label first, this changed nothing and was correctly
  // reported MISSED -- SS3r'''s mutation-that-changed-nothing, again.
  // Widening it does not put rows on a private register either, because the
  // cmRows call sits behind if(isListed) (SS2x, defence in depth). What it DOES
  // change is lgExcludedFor, which sweeps every corpus for every entity and
  // asks cmApplies -- so the rule stops being reported to an unlisted company
  // as one that does not apply, and the reason for it disappears with it.
  { name: 'PIT obligations stop being ruled out for an unlisted company (SS4a r/w SS2z)',
    from: '"appliesTo":{"entityType":["listed"]},"appliesToText":"Every listed company required to have a Code of Conduct under Reg 9"',
    to:   '"appliesTo":{"entityType":["listed","private","public"]},"appliesToText":"Every listed company required to have a Code of Conduct under Reg 9"' },
  // ── SS4b: the LODR debt chapters, and the flag that reaches them ─
  // THE ORIGINAL BUG. lodrListingTypes reads ncsListed; nothing set it, so 20
  // rules the corpus already shipped could never apply to anybody. Killing the
  // loader mapping puts that back exactly.
  { name: 'the debt listing flag stops being loaded (SS4b)',
    from: '        ncsListed: c.ncs_listed === true,',
    to:   '        ncsListed: false,' },

  // cmApplies ignoring listingType sends every debt obligation to every entity
  // -- SS2z's defect at scale, wrong law against the wrong entity class.
  { name: 'cmApplies stops honouring what is listed (SS4b r/w SS2z)',
    from: '  // ANY of these listings will do.\n  if(a.listingType && a.listingType.length){\n    var hit = a.listingType.some(function(x){ return mine.indexOf(x) >= 0; });',
    to:   '  // ANY of these listings will do.\n  if(a.listingType && a.listingType.length){\n    var hit = true;' },

  // Reg 63 and Reg 64 bind an entity with BOTH listings. Treating the AND as an
  // OR puts the Chapter IV mapping rule on a debt-only issuer, which is
  // governed by Chapter V and Chapter V-A instead.
  { name: 'the both-listings test degrades to any-listing (SS4b)',
    from: '      if(mine.indexOf(a.listingTypeAll[i]) < 0) return false;',
    to:   '      if(mine.indexOf(a.listingTypeAll[i]) >= 0) break;' },

  // Chapter V-A is the HVDLE regime. Widening it to every debt-listed issuer
  // hands a small NCD issuer a full corporate-governance code it does not owe.
  { name: 'the HVDLE governance regime widens to every debt issuer (SS4b)',
    from: '"appliesTo":{"listingType":["hvdle"]},"appliesToText":"High value debt listed entity - debt-only issuer',
    to:   '"appliesTo":{"listingType":["ncs"]},"appliesToText":"High value debt listed entity - debt-only issuer' },

  // Reg 57 is ONE WORKING DAY of the interest or redemption becoming due, and
  // the certificate is owed whether or not the money went out.
  { name: 'the payment certificate period stretches to a month (SS4b)',
    from: '"timelineText":"Within one working day of it becoming due"',
    to:   '"timelineText":"Within one month of it becoming due"' },

  // Reg 64B is step one of the debt delisting sequence, fifteen working days
  // from the board resolution or a later statutory approval.
  { name: 'the delisting application window shortens to five days (SS4b)',
    from: '"timelineText":"Not later than fifteen working days from the date of passing the board resolution',
    to:   '"timelineText":"Not later than five working days from the date of passing the board resolution' },
  // entCheck is the boolean field builder added in SS4b. Its label sits AFTER
  // the input, which is why the named-control check needs a direction per
  // entry - and why widening that window instead let the SS3q mutation through.
  { name: 'the entity form checkbox caption goes back to a div (SS4b r/w SS3q)',
    from: "<label for=\"'+id+'\" style=\"font-size:11px;color:var(--ink-soft);font-weight:600;cursor:pointer;\">",
    to:   "<div style=\"font-size:11px;color:var(--ink-soft);font-weight:600;cursor:pointer;\">" },
  // ── SS4c: the verification queue, scoped to the book ─────────
  // A filter that empties the screen before any company has loaded reads as
  // "no rules to check", which is the opposite of true. SS3a's rule for
  // lgScopeToOrg, and the reason the empty-book branch exists at all.
  { name: 'an empty book empties the verification queue (SS4c r/w SS3a)',
    from: '  if(!book || !book.length) return rules.slice();',
    to:   '  if(!book || !book.length) return [];' },

  // Scoping that does not scope leaves 405 rules in front of a CS whose book
  // needs 226 verified - which is why the queue has sat untouched.
  { name: 'the book filter stops filtering (SS4c)',
    from: '  return rules.filter(function(r){ return reach[r.id] === true; });',
    to:   '  return rules.slice();' },

  // The queue is "amended since it was written" and correctly drops a rule with
  // no evidence. Reporting the shortfall as zero is what turns that into a list
  // that reads as the whole job - SS3o's paged register, SS3v's "0 of six".
  { name: 'the queue stops reporting what it leaves out (SS4c r/w SS3o)',
    from: '  return { open: open.length, queued: queued, missing: Math.max(0, open.length - queued) };',
    to:   '  return { open: open.length, queued: queued, missing: 0 };' },

  // SS3n: a value computed correctly that reaches no screen.
  { name: 'the queue gap is computed and never rendered (SS4c r/w SS3n)',
    from: '  root.innerHTML = head + banner + chips + corpus + tabs + bar + gapNote + list;',
    to:   '  root.innerHTML = head + banner + chips + corpus + tabs + bar + list;' },

  // The tab counts and the gap must describe the SAME list. Scoping the list
  // but not the counts would put one number against another number's list.
  { name: 'the screen counts the corpus while showing the book (SS4c)',
    from: '  if(GOV_ONBOOK) rules = govOnBook(rules);',
    to:   '  if(false) rules = govOnBook(rules);' },
  // ── SS4d: PIT Schedules A and B, clause by clause ────────────
  // SCHEDULE B1 sits inside what reads as Schedule B and is the MUTUAL FUND
  // code under Reg 5F; Schedule C is the same code for intermediaries and
  // fiduciaries. Both restart at clause 1 and read almost identically against a
  // different duty-holder, so a clause lifted from either lands on a listed
  // company looking entirely plausible (SS2z).
  { name: 'a clause is re-cited to the intermediaries schedule (SS4d r/w SS2z)',
    from: '"regulation":"Schedule B cl. 6"',
    to:   '"regulation":"Schedule C cl. 6"' },

  // Seven TRADING days, and there is no exchange trading calendar here. Calendar
  // days would let a pre-clearance run past the window the code may allow.
  { name: 'the pre-cleared execution window counts calendar days (SS4d)',
    from: '"timelineText":"Not more than seven trading days from pre-clearance"',
    to:   '"timelineText":"Not more than seven calendar days from pre-clearance"' },

  // Forty-eight hours is the FLOOR on reopening the trading window. Halving it
  // reopens trading before the market can assimilate the information.
  { name: 'the trading window reopens a day early (SS4d r/w SS2w)',
    from: '"timelineText":"Not earlier than forty-eight hours after the information becomes generally available"',
    to:   '"timelineText":"Not earlier than twenty-four hours after the information becomes generally available"' },

  // Clause 14 has TWO triggers - annually AND as and when the information
  // changes. An annual collection alone leaves the register wrong for a year.
  { name: 'the designated-person disclosure loses its on-change trigger (SS4d)',
    from: '"timelineText":"On an annual basis and as and when the information changes"',
    to:   '"timelineText":"On an annual basis"' },

  // Schedule A is Reg 8(1) and Schedule B is "for Listed Companies" under
  // Reg 9(1). Neither reaches an unlisted company.
  { name: 'schedule clauses stop being ruled out for an unlisted company (SS4d r/w SS2z)',
    from: '"appliesTo":{"entityType":["listed"]},"appliesToText":"Every listed company","owner":"CS / Compliance officer","evidence":"The fair disclosure code clause;',
    to:   '"appliesTo":{"entityType":["listed","private"]},"appliesToText":"Every listed company","owner":"CS / Compliance officer","evidence":"The fair disclosure code clause;' },
  // -- SS4e: the calendar labels a row by its OWN law ----------
  // calLawTag falls back to 'CA'. Delete a branch and that law is silently
  // shown to the reader as the Companies Act - which is the state the FLA
  // return and an LLP's Form 11 and Form 8 shipped in. SS2z.
  { name: 'the FLA return goes back to being the Companies Act (SS4e r/w SS2z)',
    from: "  if(t.indexOf('fema') >= 0 || t.indexOf('rbi') >= 0) return 'FEMA';\n",
    to:   '' },

  // An LLP has no Board and no s.173 (SS2z). Labelling its own two filings as
  // the Companies Act is that same error running the other way.
  { name: 'an LLP\'s filings go back to being the Companies Act (SS4e r/w SS2z)',
    from: "  if(t.indexOf('llp') >= 0) return 'LLP';\n",
    to:   '' },

  // The fourth law the owner named as scope, invisible on this screen.
  { name: 'the depositories rows go back to being the Companies Act (SS4e r/w SS3x)',
    from: "  if(t.indexOf('depositor') >= 0) return 'DEP';\n",
    to:   '' },

  // A chip for a law no corpus carries filters to guaranteed-empty on every
  // book, for ever - a control that cannot fire (SS2k) and a dummy item by the
  // owner's own standing constraint.
  { name: 'a chip appears for a law the book does not hold (SS4e r/w SS2k)',
    from: "    var known = ['CA','LODR','PIT','DEP','FEMA','LLP','IEPF'];\n" +
          "    var listed2 = known.filter(function(k){ return lawSeen[k]; })",
    to:   "    var known = ['CA','LODR','PIT','DEP','FEMA','LLP','IEPF'];\n" +
          "    known.forEach(function(k){ if(!lawSeen[k]) lawSeen[k]={rows:0,dated:0}; });\n" +
          "    var listed2 = known.filter(function(k){ return lawSeen[k]; })" },

  // 70 PIT obligations, none dated. "Nothing dated" on its own reads as "PIT
  // has nothing for you" on the highest-consequence law in the product.
  { name: 'the empty calendar stops saying how many obligations it holds (SS4e r/w SS3v)',
    from: "  var seen2 = (calF !== 'ALL') ? lawSeen[calF] : null;",
    to:   "  var seen2 = null;" },
  // -- SS4f: a main-board entity was being given the SME proviso -
  // The proviso is the SME Exchange RELAXATION - half-yearly instead of
  // quarterly - and it was reaching every equity-listed entity, dated, beside
  // the four quarterly rows it replaces. SS2z, and SS3y's s.84 discipline:
  // reading the period without reading the subject.
  { name: 'the SME proviso reaches a main-board entity again (SS4f r/w SS2z)',
    from: "  'LODR-REG-31-1-B-PROVISO': {\n    appliesTo: { listingType: ['sme'] },",
    to:   "  'LODR-REG-31-1-B-PROVISO': {\n    appliesTo: { }," },

  // The scope patch must land BEFORE the applicability test. One line later and
  // the correction can never take effect, silently.
  { name: 'the scope patch lands after the applicability test (SS4f)',
    from: "    rule = lgPatchRule(rule);\n    var ap = lodrApplies(rule, c);\n    if(ap === false) return;",
    to:   "    var ap = lodrApplies(rule, c);\n    if(ap === false) return;\n    rule = lgPatchRule(rule);" },

  // A rule excluded by a scope patch must still be REPORTED. Ask lgExcludedFor
  // about the unpatched rule and it vanishes with no reason at all - the one
  // failure SS3i's "not on the list, but because" exists to prevent.
  { name: 'a scope-corrected rule is excluded silently (SS4f r/w SS3i)',
    from: "      try{ rule = lgPatchRule(rule); }catch(e){}\n",
    to:   '' },

  // 'sme' is a LISTING type and 'listed' is an ENTITY type. Reading one list
  // and comparing it to c.type produced "It applies to sme. This entity is a
  // listed company." - a contradiction to anyone whose company IS listed.
  { name: 'the reason calls a listing type an entity type (SS4f r/w SS3e)',
    from: "  var et = at.entityType || null;",
    to:   "  var et = at.entityType || at.listingType || null;" },

  // SS2v confirmed the 21 days against the current text. It is the period the
  // proviso actually states.
  { name: 'the SME half-yearly period drifts to thirty days (SS4f r/w SS2v)',
    from: "    due:{days:21},\n    from:'Within 21 days from the end of each half year'},",
    to:   "    due:{days:30},\n    from:'Within 21 days from the end of each half year'}," },
  // -- SS4g: the gate's reading reaches the reviewer -----------
  // The whole defect this release fixes: the gate established something and no
  // screen showed it. Computing it and not rendering it is SS2j/SS3n's shape,
  // and it is the state the product shipped in for 38 releases.
  { name: 'the gate verdict is computed and never rendered (SS4g r/w SS3n)',
    from: "var head = govClaimBlock(rule) + govGateBlock(rule) +",
    to:   "var head = govClaimBlock(rule) + '' +" },

  // SS3v measured 4 of 23 agreements falling OUTSIDE the sub-clause the rule
  // cites and withdrew the narrowing rather than ship one wrong half the time.
  // An agreement with no limit attached reads as a sign-off.
  { name: 'an agreement stops carrying the limit it was measured at (SS4g r/w SS3v)',
    from: "  if(g.v === 'ok' || g.v === 'mismatch'){",
    to:   "  if(false){" },

  // A reviewer cannot check a rule against a provision without knowing what the
  // rule asserts. The modal showed the title alone for 38 releases.
  { name: 'the rule reaches the reviewer as a title again (SS4g)',
    from: "      r.timelineText  = src.timelineText || src.disclosureTimelineText || '';",
    to:   "      r.timelineText  = '';" },

  // The hand-authored corpora carry the words they were read from (SS3x) -
  // the strongest evidence on the screen, and it reached nothing until now.
  { name: 'the verbatim quote stops reaching the reviewer (SS4g r/w SS3x)',
    from: "      r.quote         = src.quote || '';",
    to:   "      r.quote         = '';" },

  // A mechanical check is not a professional's sign-off and the screen must
  // not let one pass for the other (SS2v).
  { name: 'the screen stops saying the reading is not the decision (SS4g r/w SS2v)',
    from: "'<div class=\"gov-ev-warn\">This is the reading, not the decision. A citation '+",
    to:   "'<div class=\"gov-ev-warn\">A citation '+" },
  // -- SS4i: the two gaps the list of 16 actually yielded -------
  // Reg 7(1)(b)'s seven days binds "every person on appointment as a key
  // managerial personnel or a director", and the disclosure runs TO the entity.
  // Claiming it as the company's own deadline puts a filing on the register
  // that the company does not owe - SS3y's s.84, SS3z's Reg 30A.
  { name: 'the seven days is claimed as the company\'s own (SS4i r/w SS3z)',
    from: "THE SEVEN DAYS IS THE PERSON'S, NOT THE COMPANY'S.",
    to:   "The listed entity shall disclose within seven days." },

  // The exchange intimation is a SEPARATE obligation with its own two trading
  // days. Folding them together loses one of the two.
  { name: 'the Reg 7(2)(b) exchange intimation is folded in (SS4i)',
    from: "the exchange intimation is a separate obligation under Reg 7(2)(b), which carries its own two trading days.",
    to:   "the exchange intimation is part of the same duty." },

  // "Clear" days exclude BOTH the day of service and the day of the meeting, so
  // twenty-one clear days is longer than twenty-one days - and the period runs
  // BACKWARD, so dropping "clear" gives a LATER last date than the Act allows.
  { name: 'the AGM notice loses its clear days (SS4i r/w SS3z)',
    from: '"timelineText":"Not less than clear twenty-one days before the meeting"',
    to:   '"timelineText":"Not less than twenty-one days before the meeting"' },

  // A rule that states a period and carries no date must say WHICH kind of
  // silence that is (SS3e -- a blank is not an explanation).
  { name: 'the seven-day rule stops explaining why it has no date (SS4i r/w SS3e)',
    from: "  'PIT-SUP-REG-7-1-B':\n",
    to:   "  'PIT-SUP-REG-7-1-B-X':\n" },

  { name: 'the notice period stops explaining why it has no date (SS4i r/w SS3e)',
    from: "  'CA-SUP-SEC-101-1':\n",
    to:   "  'CA-SUP-SEC-101-1-X':\n" },
  // -- SS4j: an obligation that no longer exists ---------------
  // The repealed provision comes back onto the register as a live obligation.
  { name: 'a repealed provision is a live obligation again (SS4j)',
    from: "  if(lgRepealed(rule)) return false;   // the same table, so one law cannot drift",
    to:   "  // no repeal test" },

  { name: 'cmApplies stops consulting the repealed table (SS4j)',
    from: "function cmApplies(rule, c){\n  if(lgRepealed(rule)) return false;",
    to:   "function cmApplies(rule, c){" },

  // SS3i: not on the list, but BECAUSE. A rule that vanishes with no reason is
  // the one failure that report exists to prevent.
  { name: 'the repealed rule vanishes with no reason given (SS4j r/w SS3i)',
    from: "  var rep = lgRepealed(rule);\n  if(rep){",
    to:   "  var rep = null;\n  if(rep){" },

  // The evidence bar. Without the instrument, its date and the prior wording,
  // this table is a way to make an obligation disappear on somebody's say-so,
  // and SS3t is explicit that hiding one is the branch a CS cannot notice.
  { name: 'a repeal stops naming the instrument that did it (SS4j r/w SS3t)',
    from: "    omittedBy: 'SEBI (Prohibition of Insider Trading) (Amendment) Regulations, 2021',",
    to:   "    omittedBy: ''," },

  { name: 'a repeal stops quoting what the provision used to say (SS4j r/w SS3t)',
    from: "    was: 'Every promoter, member of the promoter group, key managerial personnel ' +",
    to:   "    wasNotRecorded: 'Every promoter, member of the promoter group, key managerial personnel ' +" },
  // -- SS4k: a generated rule that stated the law wrongly ------
  // The pre-2019 wording comes back: a listed entity with a material FOREIGN
  // subsidiary is told the independent-director duty does not reach it.
  // SS3t -- hiding an obligation is the branch a CS cannot notice.
  { name: 'the corrected wording stops reaching the register (SS4k)',
    from: "  rule = lgTextPatch(rule);",
    to:   "  // no text patch" },

  { name: 'the correction is applied but keeps no authority (SS4k)',
    from: "  out.textPatchedFrom = e.from;",
    to:   "  out.textPatchedFrom = '';" },

  // THE EVIDENCE BAR. Without it this table rewrites law on somebody's say-so.
  { name: 'a text patch with no provision behind it corrects anyway (SS4k)',
    from: "if(!e.title || !e.from || !e.why) return rule;",
    to:   "if(!e.title) return rule;" },

  // SS3n: a correction that reaches the register and NOT the screen built to
  // review it is a value computed correctly that reaches no screen.
  { name: 'the reviewer is shown the uncorrected wording (SS4k r/w SS3n)',
    from: "        r.textPatchedFrom = tp.textPatchedFrom;",
    to:   "        r.textPatchedFrom = null;" },

  { name: 'the modal stops saying the rule was corrected (SS4k r/w SS3n)',
    from: "  if(rule.textPatchedFrom){",
    to:   "  if(false){" },

  { name: 'Reg 17(10) loses the independence limb added in 2019 (SS4k)',
    from: "         + 'their independence from the management. The directors being '",
    to:   "         + 'and nothing else. The directors being '" },

  // -- SS4k: the year count that disagreed with its own screen -
  // The selector said 82 and the register then showed 254. The filter is
  // correct; the number beside it counted a different population.
  { name: 'continuous obligations stop being counted for the year note (SS4k)',
    from: "        if(!r.periodEnd) n++;",
    to:   "        if(false) n++;" },

  { name: 'the year option stops saying what its number counts (SS4k r/w SS3k)',
    from: "  return String(fy) + ' (' + n + ' dated to it)';",
    to:   "  return String(fy) + ' (' + n + ')';" },
  // -- SS4m: a committee the register never said to constitute -
  // The audit committee constitution rule disappears again, leaving the
  // register telling a listed company to hold four audit committee meetings a
  // year without ever telling it to form the committee.
  { name: 'the audit committee need not be constituted, only to meet (SS4m)',
    from: "\"title\":\"Constitute a qualified and independent audit committee",
    to:   "\"title\":\"Review matters relating to the audit committee" },

  // Reg 18(1) requires TWO-THIRDS independent. s.177 of the Companies Act needs
  // only a majority, and a listed entity must meet the stricter test -- stating
  // the weaker one under-states the duty, which is SS3t's branch.
  { name: 'the audit committee test drops to a Companies Act majority (SS4m)',
    from: "at least two-thirds independent, all financially literate",
    to:   "a majority independent, all financially literate" },

  // Reg 21(5) confines the WHOLE of Reg 21 to the top 1000 listed entities and
  // an HVDLE. Losing that puts a Risk Management Committee obligation on every
  // listed company on the book -- SS2z, the wrong law against the wrong class.
  { name: 'the Risk Management Committee reaches every listed company (SS4m r/w SS2z)',
    from: "\"detail\":\"Reg 21(5) confines the whole of Reg 21",
    to:   "\"appliesToText\":\"Equity-listed\",\"detail\":\"Reg 21 confines" },

  // Reg 15(2) exempts a small listed entity from regulations 17 to 27 outright,
  // on BOTH limbs. A row that does not say so asserts a duty the entity may not
  // owe.
  { name: 'a committee rule stops naming the Reg 15(2) exemption (SS4m)',
    from: "\"title\":\"Constitute a Stakeholders Relationship Committee",
    to:   "\"appliesToText\":\"Equity-listed\",\"title\":\"Constitute a Stakeholders Relationship Committee" },
];

const src = fs.readFileSync(INDEX, 'utf8');
fs.mkdirSync(TMP, { recursive: true });

// A clean build must pass, or nothing below means anything.
for (const s of ['compliance.test.js', 'smoke.test.js']) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.log(s + ' does not pass against the current build — fix that first.\n');
    console.log(r.stdout);
    process.exit(1);
  }
}
console.log('baseline: both suites pass against the current build\n');

// THE EMBEDDED GATE BLOB IS INVISIBLE TO AN ANCHOR.
//
// v197 embedded 149 KB of statutory excerpts as `var LG_GATE = {...};` -- the
// provisions the release gate read, so a reviewer sees them (SS4g). Three of
// those excerpts quote Reg 26A's filling-a-vacancy words, because Reg 26A(1),
// (2) and (3) share one provision span.
//
// A SS3z mutation had anchored on exactly that sentence in the corpus, where it
// was unique. It matched 4 times the moment the blob landed and was silently
// SKIPPED -- SS3p's trap arriving by a road nobody had walked: not a comment
// quoting code, but generated evidence quoting the law.
//
// The blob is DERIVED from the corpus and rewritten on every gate run, so
// mutating it proves nothing and its presence must never shadow a real anchor.
// Anchors are counted against the source with it removed, and the mutation is
// applied to whichever side actually holds the anchor -- so the file written is
// always the whole app, blob included.
const GATE_KEY = 'var LG_GATE = ';
let gateHead = src, gateBlob = '', gateTail = '';
{
  const gi = src.indexOf(GATE_KEY);
  const gj = gi >= 0 ? src.indexOf(';\n', gi) : -1;
  if (gj > gi && gi >= 0) {
    gateHead = src.slice(0, gi);
    gateBlob = src.slice(gi, gj);
    gateTail = src.slice(gj);
  }
}
const anchorSrc = gateBlob ? (gateHead + gateTail) : src;

let caught = 0, missed = 0, skipped = 0;
for (const m of MUTATIONS) {
  const n = anchorSrc.split(m.from).length - 1;
  if (n !== 1) {
    console.log(`  SKIPPED  ${m.name}\n           anchor matched ${n} times — the code moved`);
    skipped++;
    continue;
  }
  let mutated;
  if (!gateBlob) {
    mutated = src.replace(m.from, m.to);
  } else if (gateHead.indexOf(m.from) >= 0) {
    mutated = gateHead.replace(m.from, m.to) + gateBlob + gateTail;
  } else if (gateTail.indexOf(m.from) >= 0) {
    mutated = gateHead + gateBlob + gateTail.replace(m.from, m.to);
  } else {
    // Unique across head+tail but in neither: it straddles the seam. Say so
    // rather than writing an unmutated file, which would read as MISSED and
    // send somebody hunting for a blind spot that is not there.
    console.log(`  SKIPPED  ${m.name}\n           anchor straddles the LG_GATE boundary`);
    skipped++;
    continue;
  }
  const mutant = path.join(TMP, 'index.html');
  fs.writeFileSync(mutant, mutated);
  // BOTH suites. compliance.test.js knows the law; smoke.test.js knows the
  // markup — landmarks, control names, class definitions, handler targets.
  // Running only the first left every structural check unproven: a mutation
  // that removed the main landmark or a control's name passed, because nothing
  // that ran could see the markup. Both honour LG_INDEX.
  const env = Object.assign({}, process.env, { LG_INDEX: mutant });
  const suites = ['compliance.test.js', 'smoke.test.js'];
  let run = null;
  for (const s of suites) {
    run = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8', env });
    if (run.status !== 0) break;      // one suite noticing is enough
  }
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
