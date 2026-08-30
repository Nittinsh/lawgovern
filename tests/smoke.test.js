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
