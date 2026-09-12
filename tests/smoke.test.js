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
    ['the entity form caption',    "<input id=\"'+id+'\" type=", '<label for="\'+id+\'"', 400],
  ];
  // The window is per entry. entField's label carries a style attribute and an
  // optional hint span, so it sits further back than an aria-label written
  // straight onto the tag — one guessed distance for all of them made a real
  // label read as missing.
  gen.forEach(([what, near, want, back]) => {
    const i = html.indexOf(near);
    ok(what + ' names itself',
       i > 0 && html.slice(Math.max(0, i - (back || 200)), i).indexOf(want) >= 0,
       i > 0 ? 'found the control, no ' + want : 'could not find ' + near);
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
}

// -- 7. the terms and the privacy policy -----------------------
// A privacy notice reachable only AFTER signing up is not a notice: the DPDP
// Act wants it at or before the point of collection, and the point of
// collection is the sign-up button.
{
  const legalDir = path.dirname(INDEX);
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
