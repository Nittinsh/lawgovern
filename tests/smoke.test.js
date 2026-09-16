// ============================================================
// STRUCTURAL SMOKE CHECKS
//
// These codify the checks that have been run by hand after every change in this
// project, and each one exists because it caught a real bug:
//
//   nav ↔ panel pairing      a nav item was silently dropped when a regex
//                            expecting class="navitem" missed class="navitem on"
//   handlers resolve         functions removed in the dead-code sprint could
//                            have left onclick handlers pointing at nothing
//   classes are defined      .cd-shell, .sidebar, .cd-title, .cd-sub, .cd-x and
//                            .ent-f were all written into markup without ever
//                            existing in the stylesheet — three separate times
//   sw() targets exist       a navigation call to a panel that isn't there
//
// All static: it parses index.html and needs no browser. That is the point —
// the browser checks were the ones that only ran when someone remembered.
//
//   node tests/smoke.test.js
// ============================================================
const fs = require('fs');
const path = require('path');

const INDEX = process.env.LG_INDEX || path.join(__dirname, '..', 'index.html');
// The project root, independent of which index.html is under test.
const REPO = path.join(__dirname, '..');
const html = fs.readFileSync(INDEX, 'utf8');

// There is more than one <script> block: the auth functions live in an earlier
// one than the main application. Reading only the last block reported lgSignIn,
// lgSignUp and lgResetPassword as missing when they are defined at line 1166 —
// a check that cries wolf about the login button is worse than no check.
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
const js = scripts.map(m => m[1]).join('\n;\n');
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ' ');

let pass = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push({ name, detail: String(detail) });
}
function eq(name, a, b) { ok(name, a === b, `${a} !== ${b}`); }

// ── 1. every nav item has a panel, and every panel a nav item ──
{
  const navs = [...html.matchAll(/id="t-([a-z]+)"/g)].map(m => m[1]);
  const panels = [...html.matchAll(/class="panel[^"]*"\s+id="p-([a-z]+)"/g)].map(m => m[1]);
  const navSet = new Set(navs), panelSet = new Set(panels);

  ok('nav items found', navs.length > 20, navs.length);
  ok('panels found', panels.length > 20, panels.length);

  const orphanNav = navs.filter(n => !panelSet.has(n));
  const orphanPanel = panels.filter(p => !navSet.has(p));
  ok('every nav item has a panel', orphanNav.length === 0, orphanNav.join(', '));
  ok('every panel has a nav item', orphanPanel.length === 0, orphanPanel.join(', '));
  eq('nav and panel counts match', navs.length, panels.length);

  // duplicates would make sw() ambiguous
  const dupNav = navs.filter((n, i) => navs.indexOf(n) !== i);
  ok('no duplicate nav ids', dupNav.length === 0, dupNav.join(', '));
}

// ── 2. every sw() target is a real panel ──────────────────────
{
  const panels = new Set([...html.matchAll(/class="panel[^"]*"\s+id="p-([a-z]+)"/g)].map(m => m[1]));
  const targets = new Set([...html.matchAll(/\bsw\(\s*['"]([a-z]+)['"]\s*\)/g)].map(m => m[1]));
  const missing = [...targets].filter(t => !panels.has(t));
  ok('every sw() target is a panel', missing.length === 0, missing.join(', '));
}

// ── 3. inline handlers name functions that exist ──────────────
{
  const defined = new Set([...js.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
    .map(m => m[1]));
  // also things assigned as functions: var foo = function(){}
  for (const m of js.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/g))
    defined.add(m[1]);

  // Built-ins and host methods that appear in handlers but are not our functions.
  const HOST = new Set(['if', 'for', 'while', 'return', 'typeof', 'switch', 'catch', 'this',
    'function', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try',
    'getElementById', 'querySelector', 'querySelectorAll', 'stopPropagation',
    'preventDefault', 'then', 'catch', 'setTimeout', 'parseInt', 'parseFloat',
    'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date',
    'alert', 'confirm', 'prompt', 'console', 'encodeURIComponent', 'focus',
    'blur', 'click', 'reload', 'open', 'print', 'scrollIntoView', 'toLowerCase',
    'toUpperCase', 'trim', 'slice', 'split', 'join', 'map', 'filter', 'forEach']);

  const called = new Map();       // fn -> a sample of where
  const handlerAttr = /\bon[a-z]+\s*=\s*"([^"]*)"/g;
  for (const m of markup.matchAll(handlerAttr)) {
    for (const c of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!HOST.has(c[1])) called.set(c[1], m[1].slice(0, 60));
    }
  }
  // handlers built inside JS strings: onclick="foo(  /  onclick=\'foo(
  for (const m of js.matchAll(/\bon[a-z]+\s*=\s*\\?["']\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!HOST.has(m[1])) called.set(m[1], 'built in a JS string');
  }

  const dead = [...called.keys()].filter(f => !defined.has(f));
  ok('every inline handler names a function that exists', dead.length === 0,
     dead.map(f => `${f}  (${called.get(f)})`).join(' | '));
  ok('handlers were actually found to check', called.size > 20, called.size);
}

// ── 4. every class used is defined in the stylesheet ──────────
{
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const defined = new Set();
  for (const m of styleBlocks.matchAll(/\.([A-Za-z][\w-]*)/g)) defined.add(m[1]);

  // Classes appearing in static markup and in JS-generated markup.
  const used = new Map();
  const collect = (src, where) => {
    for (const m of src.matchAll(/class=\\?["']([^"'\\]+)/g)) {
      for (const c of m[1].split(/\s+/)) {
        if (c && /^[A-Za-z][\w-]*$/.test(c)) used.set(c, where);
      }
    }
  };
  collect(markup, 'markup');
  collect(js, 'generated');

  // A class with no stylesheet rule is fine when script addresses it — some
  // exist only as querySelector hooks and are never meant to be styled.
  const hooks = new Set();
  for (const m of js.matchAll(/(?:querySelector(?:All)?|closest)\(\s*\\?['"]\.([A-Za-z][\w-]*)/g))
    hooks.add(m[1]);
  for (const m of js.matchAll(/getElementsByClassName\(\s*\\?['"]([A-Za-z][\w-]*)/g))
    hooks.add(m[1]);
  for (const m of js.matchAll(/classList\.\w+\(\s*\\?['"]([A-Za-z][\w-]*)/g))
    hooks.add(m[1]);

  // Built by concatenation — `class="lg-"+kind` yields a fragment, not a class.
  const fragment = (c) => /-$/.test(c);

  const undef = [...used.keys()]
    .filter(c => !defined.has(c) && !hooks.has(c) && !fragment(c));

  ok('every class used is defined, or addressed by script', undef.length === 0,
     undef.map(c => {
       const at = html.indexOf('class="' + c) >= 0 ? html.indexOf('class="' + c)
                : html.indexOf(c);
       const ctx = html.slice(Math.max(0, at - 90), at + 60).replace(/\s+/g, ' ');
       return `\n        ${c}  —  ...${ctx}`;
     }).join(''));
  ok('classes were actually found to check', used.size > 50, used.size);
}

// ── 5. the build marker is present and well formed ────────────
{
  const m = html.match(/id="build-version" content="(v\d+)"/);
  ok('a build version marker is present', !!m, 'missing');
}

// ── 6. accessibility: landmarks, a skip link, and named controls ──
// None of this existed until v179. A screen reader had no way to jump to the
// content, and forty-three controls announced as "edit text" or "combo box".
{
  const roles = ['banner', 'navigation', 'main'];
  roles.forEach(r => {
    ok('there is a ' + r + ' landmark', html.indexOf('role="' + r + '"') >= 0, 'missing');
  });

  // Thirty nav items sit between the top of the page and the content, so
  // without this a keyboard user tabs through all of them on every screen.
  const skip = html.match(/<a class="skip-link" href="#([\w-]+)"/);
  ok('a skip link is present', !!skip, 'missing');
  if (skip) {
    const target = skip[1];
    ok('the skip link points at something that exists',
       html.indexOf('id="' + target + '"') >= 0, '#' + target + ' not found');
    ok('and that something is the main landmark',
       new RegExp('id="' + target + '"[^>]*role="main"|role="main"[^>]*id="' + target + '"')
         .test(html), 'target is not the main landmark');
    // Without tabindex the target takes the scroll but not the focus, so the
    // next Tab returns to the top of the nav and the link achieves nothing.
    ok('the skip target can take focus',
       new RegExp('id="' + target + '"[^>]*tabindex|tabindex[^>]*id="' + target + '"')
         .test(html), 'no tabindex on the skip target');
    ok('the skip link is off-screen until focused',
       /\.skip-link\{[^}]*left:-\d{3,}px/.test(html), 'not hidden');
    ok('and comes back on focus', /\.skip-link:focus\{[^}]*left:0/.test(html), 'stays hidden');
  }

  // Every control written directly into the markup carries a name.
  // The first cut of this reported 79 unnamed controls and most were healthy.
  // An id built in JavaScript cannot be resolved by reading the markup, and
  // neither can the <label for> that names it — the register field builder
  // emits a proper label and was reported as unnamed anyway. A check that
  // cries wolf on twenty-seven working controls is a check nobody runs (§2x).
  const nameless = [];
  const re = /<(input|select|textarea)\b[^>]*?>/gi;
  let m, generated = 0;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (/type="hidden"/i.test(tag)) continue;
    if (/aria-label|aria-labelledby/i.test(tag)) continue;
    const id = (tag.match(/id="([^"]*)"/) || [])[1];
    if (id && (id.includes("'+") || id.includes("' +"))) { generated++; continue; }
    // The label may carry a class, so match the attribute rather than the tag.
    if (id && new RegExp('<label[^>]*for="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"')
                .test(html)) continue;
    nameless.push(tag.slice(0, 90));
  }
  ok('the scan found controls to look at', html.indexOf('<input') > 0, 'none found');
  ok('every control in the markup has an accessible name',
     nameless.length === 0, nameless.join('\n        '));

  // Controls built in JavaScript cannot be found by reading the markup, so what
  // is asserted is that the generator emits a name.
  const gen = [
    ['the register entity picker', "onchange=\"REG_ENTITY[", 'aria-label="Entity"'],
    ['the universe filters',       "cuSetFilter(\\'entity\\'", 'aria-label="Filter by entity"'],
    ['the forms-master filters',   "fmSet(\\'law\\'",          'aria-label="Filter forms by law"'],
    // entField's caption was a <div>: on screen, tied to nothing. The scan
    // above cannot see it, because the id is built in JavaScript — so the
    // generator is asserted directly. A mutation reverting it to a div passed
    // until this line existed.
    //
    // The anchor carries the TYPE EXPRESSION, which is unique to entField.
    // Anchored on the bare <input id="'+id+'" type= it matched entCheck's
    // checkbox first and the §3q mutation went MISSED — entField's label could
    // be deleted and entCheck's stood in for it.
    ['the entity form caption',    "<input id=\"'+id+'\" type=\"'+(type||'text')+'\"",
     '<label for="\'+id+\'"', 400, 'back'],
    // A checkbox carries its label AFTER the input, so this one looks forward.
    ['the entity form checkbox',   "<input id=\"'+id+'\" type=\"checkbox\"",
     '<label for="\'+id+\'"', 400, 'fwd'],
  ];
  // The window is per entry. entField's label carries a style attribute and an
  // optional hint span, so it sits further back than an aria-label written
  // straight onto the tag — one guessed distance for all of them made a real
  // label read as missing.
  //
  // The DIRECTION is per entry too. A text field carries its label before the
  // input; a checkbox carries it after. One direction for all of them reported
  // entCheck's real <label for> as missing (§2x, a check that cries wolf), and
  // making the window BIDIRECTIONAL instead then let the §3q mutation through:
  // entField's label could be deleted and entCheck's would satisfy the check.
  // The runner reported it MISSED. Anchor per generator, direction per
  // generator — widening a window is not a substitute for aiming it.
  gen.forEach(([what, near, want, back, dir]) => {
    const i = html.indexOf(near);
    const w = back || 200;
    const seg = i < 0 ? ''
      : dir === 'fwd' ? html.slice(i, i + w)
      : html.slice(Math.max(0, i - w), i);
    ok(what + ' names itself',
       i >= 0 && seg.indexOf(want) >= 0,
       i >= 0 ? 'found the control, no ' + want : 'could not find ' + near);
  });

  // The settings toggles were an empty <button> with a <span> in it: no name,
  // no state, no role. A switch is what they are.
  // Plain attributes inside a JS string — nothing is backslash-escaped in the
  // file, so these are substring checks rather than regexes.
  ok('the settings toggles are switches with a state',
     html.includes('role="switch"') &&
     html.includes("aria-checked=\"'+(on?'true':'false')+'\""), 'not a switch');
  ok('and they carry the label beside them',
     html.includes("aria-label=\"'+entEsc(label)+'\""), 'unnamed');

  ok('the document declares a language', /<html[^>]*\blang="/i.test(html) ||
     html.indexOf('lang="en"') >= 0, 'no lang');

  // -- the debt listing flag, end to end (SS4b) ------------------
  // lodrListingTypes reads ncsListed and hvdle. Before db/026 nothing wrote
  // them, so every LODR rule scoped to non-convertible securities was
  // unreachable -- 20 rules the corpus already shipped, plus the 27 added with
  // this section. The compliance suite cannot see this: it builds company
  // objects directly and never touches the loader, so the mutation that kills
  // the mapping was correctly reported MISSED there.
  ok('the loader maps the debt listing columns onto the company',
     /ncsListed:\s*c\.ncs_listed/.test(html) && /hvdle:\s*c\.hvdle/.test(html),
     'loadCloudClients does not read ncs_listed / hvdle');
  ok('the entity form offers both flags',
     html.indexOf("entCheck('ent-ncs'") >= 0 && html.indexOf("entCheck('ent-hvdle'") >= 0,
     'the entity form cannot set them');
  ok('and entSave writes them back',
     /ncs_listed:\s*!!/.test(html) && /hvdle:\s*!!/.test(html),
     'entSave does not send the columns');
  // A missing column must name its migration rather than surfacing a raw
  // PostgREST error -- the pattern regSave and entSave already use.
  ok('a missing debt column names its migration',
     html.indexOf('db/026_debt_listing.sql') >= 0, 'db/026 is not named anywhere');
  // And the applicability engine must actually consult them.
  ok('cmApplies consults the listing type',
     /a\.listingType/.test(html) && /a\.listingTypeAll/.test(html),
     'cmApplies ignores what is listed');
}

// -- 6b. the embedded corpora match their JSON files (SS4b) ----
// Each hand-authored corpus ships TWICE: as rules/<name>.json in the repo and
// as an inline blob in index.html. Editing the file changes nothing the app
// reads. Fixing Reg 60's trigger in lodr_debt.json and forgetting to re-embed
// left the two disagreeing, and the only symptom was a mutation anchor that
// suddenly matched twice. SS3t: a generated file that has to be pasted by hand
// goes stale the first time somebody forgets.
{
  const CORPORA = [
    ['LODR_DEBT_DATA', 'rules/lodr_debt.json'],
    ['LODR_SUP_DATA',  'rules/lodr_supplement.json'],
    ['PIT_SUP_DATA',   'rules/pit_supplement.json'],
    ['CA_SUP_DATA',    'rules/ca_supplement.json'],
    ['DEPOS_DATA',     'rules/depositories_master.json'],
  ];
  // Walk the object rather than guessing where it ends: these blobs contain
  // braces inside quoted strings.
  const embedded = (name) => {
    const at = html.indexOf('var ' + name + ' = ');
    if (at < 0) return null;
    let i = at + ('var ' + name + ' = ').length;
    if (html[i] !== '{') return null;
    const from = i;
    let depth = 0, instr = false, esc = false;
    for (; i < html.length; i++) {
      const ch = html[i];
      if (instr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') instr = false;
      } else if (ch === '"') instr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { i++; break; }
    }
    try { return JSON.parse(html.slice(from, i)); } catch (e) { return null; }
  };

  CORPORA.forEach(([name, file]) => {
    const emb = embedded(name);
    ok(name + ' is embedded and parses', !!emb, 'not found or malformed');
    if (!emb) return;
    let disk = null;
    try { disk = JSON.parse(fs.readFileSync(path.join(REPO, file), 'utf8')); }
    catch (e) { /* reported below */ }
    ok(file + ' is readable', !!disk, 'could not read or parse');
    if (!disk) return;
    // Rule count and ids first, because that is the failure that hides best:
    // a corpus re-embedded from a stale copy loses or renames rules silently.
    const ids = (d) => (d.rules || []).map(r => r.id).join(',');
    eq(name + ' has the same rule count as its file',
       (emb.rules || []).length, (disk.rules || []).length);
    ok(name + ' has the same rule ids as its file', ids(emb) === ids(disk),
       'the embedded ids differ from ' + file);
    ok(name + ' matches its file exactly',
       JSON.stringify(emb) === JSON.stringify(disk),
       'the embedded copy has drifted from ' + file + ' — re-embed it');
  });
}

// -- 7. the terms and the privacy policy -----------------------
// A privacy notice reachable only AFTER signing up is not a notice: the DPDP
// Act wants it at or before the point of collection, and the point of
// collection is the sign-up button.
{
  // Resolved from the repository, NOT from dirname(INDEX): mutation.js writes
  // each mutant to a temp directory, where terms.html does not exist. Reading
  // these relative to the mutant made every mutation fail the legal-page
  // checks, so any bug only smoke could catch was being "caught" for the wrong
  // reason -- the SS3q finding again, one layer down.
  const legalDir = REPO;
  const pages = ['terms.html', 'privacy.html'];
  const read = {};

  pages.forEach(f => {
    const p = path.join(legalDir, f);
    const there = fs.existsSync(p);
    ok(f + ' exists', there, 'missing');
    if (there) read[f] = fs.readFileSync(p, 'utf8');
  });

  pages.forEach(f => {
    ok('the app links to ' + f, html.indexOf('href="' + f + '"') >= 0, 'not linked');
  });

  // The sign-up button and the links have to be on the same card, or the
  // notice is not given at the point of collection.
  // The window was 9,000 characters and the links sit 19,120 past the overlay,
  // so the check failed against a page that was correct. And 'lgSignUp()' alone
  // matched the function DEFINITION, which is earlier in the file than the
  // overlay — the button is what has to be on the card, so match the handler.
  const i = html.indexOf('id="auth-overlay"');
  const card = i >= 0 ? html.slice(i, i + 25000) : '';
  ok('the login card links to the terms', card.indexOf('href="terms.html"') >= 0, 'not on the card');
  ok('the login card links to the privacy policy',
     card.indexOf('href="privacy.html"') >= 0, 'not on the card');
  ok('and they sit with the sign-up button, not somewhere else',
     card.indexOf('onclick="lgSignUp()"') >= 0, 'sign-up button is elsewhere');

  pages.forEach(f => {
    const s = read[f];
    if (!s) return;
    ok(f + ' declares a language', /<html[^>]*\blang="/i.test(s), 'no lang');
    ok(f + ' has a title', /<title>[^<]{6,}<\/title>/i.test(s), 'no title');
    const other = f === 'terms.html' ? 'privacy.html' : 'terms.html';
    ok(f + ' links to ' + other, s.indexOf('href="' + other + '"') >= 0, 'no cross-link');

    // The invariant. Placeholders OR no banner — never both. Asserting the
    // banner is present would fail the moment it is correctly removed.
    const blanks = (s.match(/\[[^\]<>\n]{2,60}\]/g) || [])
                     .filter(x => !/^\[\s*\]$/.test(x));
    const banner = s.indexOf('class="draft"') >= 0;
    ok(f + ' does not publish blanks without saying it is a draft',
       blanks.length === 0 || banner,
       blanks.length + ' placeholder(s) and no draft banner: ' + blanks.join(' '));
  });
}

// -- 4b. every CSS variable used is defined ---------------------
// Section 4 does this for class names and has caught four inventions. It
// cannot see a variable: var(--ice) and var(--border) shipped in v182 against
// a stylesheet that defines neither, so the new panel had no background and no
// borders and simply looked like unstyled text. A wrong colour is visible; a
// missing one often is not.
{
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const defined = new Set();
  for (const m of styleBlocks.matchAll(/(--[A-Za-z][\w-]*)\s*:/g)) defined.add(m[1]);
  // A variable can also be set from script.
  for (const m of html.matchAll(/setProperty\(\s*\\?['"](--[A-Za-z][\w-]*)/g)) defined.add(m[1]);

  // Comments name variables in order to say they do not exist -- there is a
  // /* var(--card) does not exist ... */ note in the stylesheet doing exactly
  // that. Reading it as a use reports the comment as the bug it warns about.
  const live = html.replace(/\/\*[\s\S]*?\*\//g, ' ');

  const used = new Map();
  // var(--x, fallback) renders correctly whether or not --x is defined, so it
  // is not a defect. Only a bare var(--x) is.
  for (const m of live.matchAll(/var\(\s*(--[A-Za-z][\w-]*)\s*\)/g)) {
    if (!used.has(m[1])) used.set(m[1], m.index);
  }
  const undef = [...used.keys()].filter(v => !defined.has(v));
  ok('every CSS variable used is defined', undef.length === 0,
     undef.map(v => {
       const at = used.get(v);
       return v + ' near: ' + html.slice(Math.max(0, at - 70), at + 30).replace(/\s+/g, ' ');
     }).join(' | '));
}

// -- 8. the amendment evidence -----------------------------------
{
  ok('the amendment evidence is embedded', /var LG_AMEND = \{/.test(js), 'LG_AMEND missing');

  // The evidence is keyed by provision number, and two independent parsers
  // produce that number -- cited() in tools/amendments.py when the file is
  // built, lgAmendCited() in the app when it is read. If they drift, evidence
  // silently stops reaching rules and nothing looks broken.
  const py = fs.readFileSync(path.join(REPO, 'tools', 'amendments.py'), 'utf8');
  ok('the Python side parses regulation citations the same way',
     py.indexOf('Reg(?:ulation)?s?') >= 0, 'regulation pattern changed in Python');
  ok('the app side parses regulation citations the same way',
     js.indexOf('Reg(?:ulation)?s?') >= 0, 'regulation pattern changed in the app');
  ok('the Python side parses section citations the same way',
     py.indexOf('Sec(?:tion)?s?') >= 0, 'section pattern changed in Python');
  ok('the app side parses section citations the same way',
     js.indexOf('Sec(?:tion)?s?') >= 0, 'section pattern changed in the app');

  // The invariant. An unknown commencement date must abstain, never hide.
  const f = js.slice(js.indexOf('function lgRuleInForce('));
  const body = f.slice(0, f.indexOf('\n}'));
  ok('an unknown commencement date leaves the row in force',
     /if\(!c\) return \{ inForce:true/.test(body.replace(/\s+/g, ' ')),
     'an unknown commencement does not return inForce:true first');
  ok('a continuous obligation is not ruled out by commencement',
     /if\(!periodEnd\) return \{ inForce:true/.test(body.replace(/\s+/g, ' ')),
     'a null periodEnd is not handled before the comparison');

  // The screen must not present evidence as a verdict.
  //
  // Sentences built by concatenation are broken by the seams -- the source
  // reads '...an amendment does not ' + 'tell you when the obligation began'
  // and the phrase never appears contiguously in the file even though it does
  // on screen. Joining adjacent string literals first is what makes an
  // assertion about prose testable at all.
  const seams = (s) => s.replace(/['"]\s*\+\s*['"]/g, '');
  const ev = seams(js.slice(js.indexOf('function govEvidenceBlock('),
                            js.indexOf('function govUseEvidence(')));
  // The caveat is computed per law now -- SEBI evidence follows the footnote
  // marker, the Act's can only be placed by position -- so what has to exist
  // is both wordings, and the executable check is in compliance.test.js.
  const basis = seams(js.slice(js.indexOf('function govBasisWords(')));
  const basisBody = basis.slice(0, basis.indexOf('\n}'));
  ok('the panel can describe marker attribution',
     basisBody.indexOf('following the footnote marker') >= 0, 'no marker wording');
  ok('the panel can describe positional attribution',
     basisBody.indexOf('where the footnote sits') >= 0, 'no positional wording');
  ok('the evidence panel refuses to read an amendment as a start date',
     ev.indexOf('does not tell you when the obligation began') >= 0,
     'no caveat that an amendment is not a commencement');

  // Prefilling must not become signing off.
  const use = js.slice(js.indexOf('function govUseEvidence('));
  const useBody = use.slice(0, use.indexOf('\n}'));
  ok('using the evidence fills the fields and does not save',
     useBody.indexOf('govSave') < 0, 'govUseEvidence calls govSave');
}

// -- 9. the sign-in screen is the login card, and nothing else ---
// v183 put a demo and a landing page here. The owner removed both (v184, v185).
// These are the guards that keep them gone: neither was deleted because it was
// broken, so neither would look wrong if it crept back.
{
  const i = html.indexOf('id="auth-overlay"');
  const card = i >= 0 ? html.slice(i, i + 26000) : '';
  ok('the sign-in form is on the screen',
     card.indexOf('lgSignIn()') >= 0, 'no sign-in form');

  ok('nothing offers a demo',
     html.indexOf('demo=1') < 0 && html.indexOf('lgDemoStart') < 0,
     'a demo entry point is present');
  ok('and no marketing page sits in front of the login card',
     html.indexOf('lgland') < 0, 'landing markup is present');
}

// -- 10. the rule audit must report its own reach -----------------
// "period mismatch: 0" was nought out of SIX comparisons across 327 rules, and
// read as a clean bill of health for the corpus. A count of failures means
// nothing without the count of checks behind it.
{
  const audit = fs.readFileSync(path.join(REPO, 'tools', 'rule_audit.py'), 'utf8');
  ok('the audit counts how many periods it actually compared',
     audit.indexOf("counts['period compared']") >= 0, 'no comparison counter');
  ok('and prints that count beside the mismatches',
     audit.indexOf('periods actually compared') >= 0, 'coverage is not reported');

  // A provision that hands its period to rules not held here is a gap, not a
  // contradiction, and must not block a release over it (s.90 r/w SBO Rules).
  ok('a delegating provision is its own category',
     audit.indexOf("counts['period delegated by the provision']") >= 0,
     'delegation is not distinguished from a mismatch');

  // The comparison is against the whole provision, so an agreement can be with
  // a neighbouring sub-section. That limit has to stay on screen.
  ok('the audit states that it compares the whole provision',
     audit.indexOf('KNOWN LIMIT') >= 0, 'the sub-provision limit is not stated');

  // And the screen must not claim more than the audit did.
  const gov = js.slice(js.indexOf('var LG_CORPUS'), js.indexOf('var GOV_STATUS'));
  ok('the governance screen does not claim the periods were checked',
     gov.indexOf('no stated period contradicts') < 0,
     'LG_CORPUS still claims every period was checked');
}

// ── report ────────────────────────────────────────────────────
const total = pass + failures.length;
console.log('\n' + '─'.repeat(64));
if (!failures.length) {
  console.log(`  smoke: ${pass}/${total} structural checks passed`);
  console.log('─'.repeat(64));
  process.exit(0);
}
console.log(`  smoke: ${pass}/${total} passed — ${failures.length} FAILED`);
console.log('─'.repeat(64));
for (const f of failures) console.log(`\n  ✗ ${f.name}\n      ${f.detail.slice(0, 400)}`);
console.log('');
process.exit(1);
