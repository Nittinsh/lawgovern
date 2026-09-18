# -*- coding: utf-8 -*-
"""Find rules whose wording survives ONLY inside a footnote quoting text that
has been substituted or omitted.

    python tools/stale_wording.py

That is exactly the LODR-REG-24-1 signature (SS4k). The rule said "incorporated
in India"; the phrase appears in Reg 24(1) once, inside footnote 239, which
reads "Prior to the substitution, sub-regulation (1) read as follows: ...".
The operative text says "whether incorporated in India or not" -- the opposite.
Run against the whole corpus it also found Reg 17(10) (SS4l).

THIS DECIDES NOTHING. It prints a SHORTLIST and the context around each hit, to
be read against the provision. Precision is poor and deliberately left so:

  * "69[...]" brackets mark an INSERTION, so live text sits inside brackets
    that look exactly like dead text;
  * a lookbehind window crosses sub-provision headings, so an unrelated
    footnote above "(3)" flags operative text below it.

Ten of thirteen hits were false positives. A "sub-provision heading intervenes"
refinement was tried and WITHDRAWN: it reported Reg 24-1 -- the one case known
to be true -- as operative, because the footnote's quoted prior text carries
sub-provision headings of its own. SS2x, and SS3v's withdrawn narrowing: a
check that is wrong four times in five must not be presented as an answer.

Needs the compilations in reference/, which is gitignored.
"""
import io
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _load_audit_library():
    """rule_audit.py runs its whole gate at import time -- it has no main()
    guard and regenerates rules/audit_findings.json as a side effect. So the
    library half is exec'd on its own, cut at the first driver statement."""
    src = io.open(os.path.join(HERE, 'rule_audit.py'), encoding='utf-8').read()
    cut = src.find('\ntexts = {}')
    if cut < 0:
        print('could not find the driver boundary in rule_audit.py'); sys.exit(1)
    ns = {'__name__': 'rule_audit_lib'}
    exec(compile(src[:cut], 'rule_audit.py[lib]', 'exec'), ns)
    return ns


A = _load_audit_library()

SUPERSEDED = re.compile(
    r'(prior to (?:the )?(?:substitution|omission|amendment)|'
    r'read as under|read as follows|before substitution|'
    r'substituted for|omitted by)', re.I)

STOP = set('''the a an and or of to in on for by with shall be is are as at any
such other from which that this these those its their his not no all each every
within under over per into upon where when if than then there here it may must
company companies entity entities listed board directors director'''.split())


def phrases(title):
    w = re.findall(r"[a-z][a-z'-]+", (title or '').lower())
    out = []
    for i in range(len(w) - 2):
        tri = w[i:i + 3]
        if sum(1 for x in tri if x in STOP) >= 2:
            continue
        out.append(' '.join(tri))
    return out


def norm(s):
    """Letters only. Defeats "w ithin", "forty -five" and inline footnote
    markers in one move -- SS3z."""
    return re.sub(r'[^a-z]', '', (s or '').lower())


def main():
    os.chdir(ROOT)
    texts = {law: A['load_text'](p) for law, (p, _) in A['SOURCES'].items()
             if os.path.exists(p)}
    if not texts:
        print('no texts in reference/ -- nothing to check'); return 0

    flagged, read, skipped = [], 0, 0
    for path, key, law in A['CORPORA']:
        if not os.path.exists(path):
            continue
        for r in (json.load(io.open(path, encoding='utf-8')).get(key) or []):
            if r.get('quote'):
                continue                       # hand-authored: already read
            cite = r.get('regulation') or r.get('section') or ''
            t = texts.get(law)
            regs = (A['cited_regs'](cite)
                    if ('LODR' in law or 'PIT' in law or 'Deposit' in law)
                    else A['cited_sections'](cite))
            if not t or not regs:
                skipped += 1
                continue
            ctx = A['context_of'](t, regs[0], law, span=4000)
            if not ctx:
                skipped += 1
                continue
            read += 1
            idx = [i for i, ch in enumerate(ctx) if ch.isalpha()]
            nctx = ''.join(ctx[i].lower() for i in idx)

            only_stale = []
            for p in phrases(r.get('title')):
                np = norm(p)
                if len(np) < 12 or np not in nctx:
                    continue
                stale = live = 0
                for m in re.finditer(re.escape(np), nctx):
                    raw = idx[m.start()]
                    if SUPERSEDED.search(ctx[max(0, raw - 420):raw]):
                        stale += 1
                    else:
                        live += 1
                if stale and not live:
                    only_stale.append((p, idx[[m.start() for m in
                                       re.finditer(re.escape(np), nctx)][0]]))
            if only_stale:
                flagged.append((r.get('id'), cite, only_stale[:2],
                                (r.get('title') or '')[:70], ctx))

    print('read %d rules against their cited provision; %d had no locatable text'
          % (read, skipped))
    print('=' * 74)
    print('SHORTLIST -- wording found only inside a superseded quote: %d'
          % len(flagged))
    print('=' * 74)
    for rid, cite, hits, title, ctx in flagged:
        print('\n  %-26s %s\n     %s' % (rid, cite, title))
        for p, raw in hits:
            print('     "%s"' % p)
            print('        ...%s...' % ctx[max(0, raw - 150):raw + 160])
    print('\nNothing above is a finding. Every one is read against the '
          'provision before it is believed;\nten of the first thirteen were '
          'false positives (SS4l).')
    return 0


sys.exit(main())
