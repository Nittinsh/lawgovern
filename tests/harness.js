// ============================================================
// Test harness — load the shipped application under Node.
//
// The suite runs against index.html itself, not against a copy of the logic,
// because a test that exercises a reimplementation proves nothing about what
// deploys. The script block is extracted and evaluated in a VM context with the
// smallest browser shim that lets it load.
//
// Time is frozen. Nearly every date in this system is computed relative to
// "now" — which financial year is in progress, which quarter, whether a
// deadline has passed — so a suite asserting real dates against a moving clock
// would rot within days. FROZEN_NOW pins it; change that constant and the
// expected values move with it.
// ============================================================
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// 29 August 2026 — inside FY 2026-27 (1 Apr 2026 to 31 Mar 2027).
const FROZEN_NOW = new Date(2026, 7, 29, 10, 0, 0);

function loadApp(indexPath) {
  const html = fs.readFileSync(indexPath, 'utf8');
  const i = html.lastIndexOf('<script>');
  const j = html.lastIndexOf('</script>');
  if (i < 0 || j < 0) throw new Error('no main script block found in ' + indexPath);
  const src = html.slice(i + 8, j);

  const noop = () => {};
  const elProxy = new Proxy({}, {
    get: (t, k) => {
      if (k === 'style') return new Proxy({}, { get: () => '', set: () => true });
      if (k === 'classList') return { add: noop, remove: noop, toggle: noop, contains: () => false };
      if (k === 'querySelectorAll') return () => [];
      if (k === 'querySelector') return () => null;
      if (['appendChild', 'remove', 'focus', 'addEventListener', 'removeEventListener',
           'setAttribute', 'click', 'scrollIntoView'].includes(k)) return noop;
      if (['value', 'textContent', 'innerHTML', 'className', 'id'].includes(k)) return '';
      return undefined;
    },
    set: () => true
  });

  // A Date whose zero-argument form is frozen, but which otherwise behaves
  // exactly like the real one — parsing, arithmetic and formatting all matter
  // to the code under test.
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(FROZEN_NOW.getTime());
      else super(...args);
    }
    static now() { return FROZEN_NOW.getTime(); }
  }

  const ctx = {
    console, Math, JSON, parseInt, parseFloat, isNaN, isFinite,
    String, Number, Object, Array, RegExp, Boolean, Error, Promise, Map, Set, Symbol,
    encodeURIComponent, decodeURIComponent, escape: (s) => s, unescape: (s) => s,
    Date: FrozenDate,
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    requestAnimationFrame: noop,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    fetch: () => Promise.reject(new Error('network disabled in tests')),
    document: {
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => elProxy, body: elProxy, documentElement: elProxy,
      head: elProxy, addEventListener: noop, styleSheets: []
    },
    navigator: { userAgent: 'node' },
    location: { href: '', reload: noop, search: '' },
    alert: noop, confirm: () => true, prompt: () => null,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addListener: noop, addEventListener: noop })
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'index.html:<script>' });
  return ctx;
}

// ── assertions ──────────────────────────────────────────────
const results = { pass: 0, fail: 0, failures: [] };
let group = '';

function describe(name) { group = name; }

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { results.pass++; return true; }
  results.fail++;
  results.failures.push({ group, name, expected: e, actual: a });
  return false;
}

function ok(name, cond, detail) {
  if (cond) { results.pass++; return true; }
  results.fail++;
  results.failures.push({ group, name, expected: 'true', actual: String(detail) });
  return false;
}

function report() {
  const total = results.pass + results.fail;
  console.log('\n' + '─'.repeat(64));
  if (results.fail === 0) {
    console.log(`  ${results.pass}/${total} assertions passed`);
    console.log('─'.repeat(64));
    return 0;
  }
  console.log(`  ${results.pass}/${total} passed — ${results.fail} FAILED`);
  console.log('─'.repeat(64));
  for (const f of results.failures) {
    console.log(`\n  ✗ [${f.group}] ${f.name}`);
    console.log(`      expected: ${f.expected}`);
    console.log(`      actual:   ${f.actual}`);
  }
  console.log('');
  return 1;
}

module.exports = { loadApp, describe, check, ok, report, results, FROZEN_NOW };
