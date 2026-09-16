# -*- coding: utf-8 -*-
"""
Cross-check the rule corpus against the regulation texts actually held.

Both assessments put "revalidate every rule against current law" at number one,
and warn that SEBI kept amending LODR through 2026. The texts in reference/ turn
out to be more current than assumed:

    SEBI LODR 2015   amended up to 14 July 2026
    SEBI PIT  2015   amended up to 12 March 2025
    Companies Act    amended up to 1 April 2021   (stale — over five years)

So the LODR corpus, which is the largest and the one the reports flag hardest,
can be checked against a current text.

What this does NOT do is read the law for you. It answers one narrow, mechanical
question per rule: **does the provision this rule cites still exist in the
current text, and does the period the rule states appear anywhere near that
provision?** A rule citing a regulation that has been omitted is stale on its
face. A rule whose stated timeline contradicts the words around its own
provision is worth a human looking at.

Everything it reports is a question for the Company Secretary, not a finding.
It is deliberately noisy in the direction of asking rather than assuming.

    python tools/rule_audit.py            # summary
    python tools/rule_audit.py --detail   # every finding
"""
import io, json, re, sys, collections

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
DETAIL = '--detail' in sys.argv

SOURCES = {
    'SEBI LODR 2015': ('reference/sebi-lodr-2015/lodr.txt', 'Amended up to July 14, 2026'),
    'SEBI PIT Regulations 2015': ('reference/sebi-pit-2015/sebi pit.txt', 'Amended upto March 12, 2025'),
    # STALE by over five years. Everything checked against it is reported
    # separately and never blocks — see CA_STALE below.
    'Companies Act 2013': ('reference/companies-act-2013/'
                           'Companies Act 2013 as amended upto 01.04.2021_.txt',
                           'As amended upto 01.04.2021 — STALE'),
    'SEBI Depositories & Participants 2018': (
        'reference/sebi-depositories/sebi dp reg.txt',
        'Gazetted 3 October 2018'),
}

CORPORA = [
    ('rules/lodr_periodic.json', 'rules', 'SEBI LODR 2015'),
    ('rules/lodr_events.json',   'events', 'SEBI LODR 2015'),
    ('rules/pit_master.json',    'rules', 'SEBI PIT Regulations 2015'),
    ('rules/ca_master.json',     'rules', 'Companies Act 2013'),
    # Hand-authored from the held texts rather than generated from the owner's
    # spreadsheet (SS3x, SS3y). They go through the same gate as everything else:
    # a corpus outside the audit is a corpus with no citation check.
    ('rules/ca_supplement.json', 'rules', 'Companies Act 2013'),
    ('rules/depositories_master.json', 'rules',
     'SEBI Depositories & Participants 2018'),
    ('rules/lodr_supplement.json', 'rules', 'SEBI LODR 2015'),
    ('rules/pit_supplement.json', 'rules', 'SEBI PIT Regulations 2015'),
    ('rules/lodr_debt.json', 'rules', 'SEBI LODR 2015'),
    ('rules/pit_schedules.json', 'rules', 'SEBI PIT Regulations 2015'),
]

# The Act text predates every amendment since April 2021, so a section it does
# not contain may be a wrong citation OR a provision added after that date.
# This audit cannot tell those apart, so Companies Act results are reported and
# never block. Failing every release over a five-year-old PDF would only teach
# everyone to skip the gate.
CA_STALE = 'Companies Act 2013'


def load_text(path):
    t = io.open(path, encoding='utf-8', errors='replace').read()
    # The PDF extraction breaks words across spaces ("REQUI REMENTS"), so a
    # whitespace-normalised copy is what we search.
    return re.sub(r'\s+', ' ', t)


def regs_present(text):
    """Regulation numbers that appear as a numbered provision in the text."""
    found = set()
    # "24A." / "30 (2)" / "Regulation 47" — the heading form and the cross-reference form
    # A heading can carry a footnote marker between the number and the body —
    # "91C. 634[(1)" — which is why Reg 91C first read as absent from a text
    # that plainly contains it.
    for m in re.finditer(r'(?<![\d.])(\d{1,3}[A-Z]{0,2})\s*\.\s*(?:\d+\[)?\(1\)', text):
        found.add(m.group(1).upper())
    for m in re.finditer(r'[Rr]egulation\s+(\d{1,3}[A-Z]{0,2})\b', text):
        found.add(m.group(1).upper())
    for m in re.finditer(r'(?<![\d.])(\d{1,3}[A-Z]{0,2})\s*\.\s*[A-Z]', text):
        found.add(m.group(1).upper())
    return found


def cited_regs(s):
    """The regulation numbers a rule's own citation names."""
    s = str(s or '')
    out = []
    for m in re.finditer(r'\bReg(?:ulation)?s?\.?\s*(\d{1,3}[A-Z]{0,2})(?![A-Za-z0-9])', s, re.I):
        out.append(m.group(1).upper())
    return out


def sections_present(text):
    """Section numbers that appear as a numbered provision in the Act."""
    found = set()
    # "198. Calculation of profits." — the heading form. Also the amended form
    # "3[185. Loans to directors", where a footnote marker precedes the number,
    # which is how s.185 first read as absent from a text that contains it in
    # full.
    for m in re.finditer(r'(?:^|\s|\[)(\d{1,3}[A-Z]{0,2})\s*\.\s*[A-Z]', text):
        found.add(m.group(1).upper())
    for m in re.finditer(r'\bsections?\s+(\d{1,3}[A-Z]{0,2})\b', text, re.I):
        found.add(m.group(1).upper())
    return found


def cited_sections(s):
    """The section numbers a rule's citation names.

    The corpus writes these several ways — "Section 92", "Sections 12, 15",
    "Sec 173(1)", "Sections 77-87". A range is expanded to its endpoints only:
    asserting that every number between them is a real section would invent
    citations the rule never made.
    """
    s = str(s or '')
    out = []
    for m in re.finditer(r'\bSec(?:tion)?s?\.?\s*([\d\s,\-]+[A-Z]{0,2})', s, re.I):
        blob = m.group(1)
        for n in re.finditer(r'(\d{1,3}[A-Z]{0,2})', blob):
            out.append(n.group(1).upper())
    return out


# The lead-in the statute actually uses, not just "within": provisions say
# "within a period of thirty days" (Reg 39(2)), "not later than three months"
# (Reg 6(1A)), "not later than 21 calendar days" (Reg 13(1)), "at least 21 days"
# (Reg 46(2)). Requiring "within" plus at most two words made every one of those
# invisible -- including ones printed verbatim in this audit's own output.
# "within" arrives from the PDF as "w ithin", "wit hin", "wi thin" and
# "with in" -- 23 times across the three texts. A space may fall between any
# two letters, so every gap is optional.
_WITHIN = r'w\s?i\s?t\s?h\s?i\s?n'
# A roman-numeral list item counts as its own lead-in. Reg 30(6) reads "not
# later than the following: (i) thirty minutes ... (ii) twelve hours ...", so
# the governing words sit before the list and each item has none. Without this
# the twelve-hour limb -- which most Schedule III rules turn on -- is invisible.
LEAD = (r'(?:' + _WITHIN + r'|not\s+later\s+than|no\s+later\s+than|at\s+least'
        r'|before\s+the\s+expiry\s+of|\((?:i{1,3}|iv|v)\))')
# "a period of", "a further period of" etc. sit between the lead-in and the number.
FILLER = r'(?:\s+(?:a|an|the|further|maximum|minimum|period|of|such)){0,4}'
UNITS = (r'calendar\s+days?|working\s+days?|business\s+days?|trading\s+days?|'
         r'clear\s+days?|days?|hours?|months?|weeks?|years?')
# Up to three word-tokens, so "forty -five" and "one hundred and twenty" are
# captured whole. Anything that does not resolve to a number is dropped below
# rather than guessed at.
# Digits FIRST. With the word-branch first, "within 2 working days" captured
# "2 working" as the number and "days" as the unit, int() threw, and the match
# was silently dropped -- so a plainly readable period parsed as none at all.
PERIOD = re.compile(LEAD + FILLER + r'\s+(\d+|(?:\w+[\s-]+){0,2}?\w+)\s+(' + UNITS + r')', re.I)

# The regulations spell numbers, and not always with a hyphen — "twenty one
# days" is two words in the LODR text. Reading only "twenty-one" made Reg 31's
# own period invisible to this audit and produced a mismatch against itself.
_WORDS = {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,
          'nine':9,'ten':10,'eleven':11,'twelve':12,'thirteen':13,'fourteen':14,
          'fifteen':15,'sixteen':16,'eighteen':18,'twenty':20,'twentyone':21,
          'twentyfour':24,'thirty':30,'thirtyone':31,'forty':40,'fortyfive':45,
          'fortyeight':48,'sixty':60,'seventy':70,'ninety':90,'onehundred':100,
          'hundred':100,'onehundredandtwenty':120,'hundredandtwenty':120}
# Keyed with spaces and hyphens stripped, so every way the texts write a number
# collapses to one entry.
WORDNUM = dict((re.sub(r'[\s-]+', '', k), v) for k, v in _WORDS.items())


# A substitution marker sits wherever the amendment fell, including between
# the lead-in and the number: Reg 44(3) reads "within 436[two working days] of
# conclusion of its General Meeting". The marker is typography, not meaning, so
# it is removed before the period is read -- otherwise a period printed in full
# on the page parses as none at all.
FOOTMARK = re.compile(r'\d{1,4}\[')


# A CADENCE IS NOT A DEADLINE, and it is written in a shape the deadline
# pattern cannot see. PERIOD wants the number just after the lead-in, so
# "at least three working days" parses and "at least once every three years"
# does not -- the number sits behind "once every".
#
# Five rules state one: Reg 23(1) (RPT policy reviewed once every three years),
# Reg 55, Reg 31B(1), PIT Reg 9A(4) and Schedule B cl. 1. Every one was filed as
# "rule states no period" and its number was never compared against the held
# text -- including three written by hand in SS4a and SS4d.
#
# Two shapes, kept apart deliberately rather than folded into FILLER: loosening
# FILLER to reach across "once every" would also let it reach across anything
# else, and a parser that matches more than it understands is SS2x's check that
# cries wolf.
CADENCE_N = re.compile(
    r'once\s+(?:in\s+)?every\s+(\d+|(?:\w+[\s-]+){0,2}?\w+)\s+(' + UNITS + r')', re.I)
# No number means one: "once a year", "once in a financial year".
CADENCE_1 = re.compile(
    r'once\s+(?:in\s+)?(?:a|an|each|per)\s+(?:financial\s+|calendar\s+)?('
    + UNITS + r')', re.I)


def _norm(n, unit):
    """One number and one unit, however the three texts happen to write them."""
    n, unit = str(n).lower().strip(), re.sub(r'\s+', ' ', unit.lower())
    key = re.sub(r'[\s-]+', '', n)
    n = WORDNUM.get(key, WORDNUM.get(n, n))
    try:
        n = int(n)
    except Exception:
        return None
    u = ('working day' if 'working' in unit or 'business' in unit
         else unit.replace('calendar ', '').replace('clear ', '')
                  .replace('trading ', '').rstrip('s'))
    return (n, u)


def periods_in(s):
    s = FOOTMARK.sub(' ', s or '').replace(']', ' ')
    out = set()
    for m in CADENCE_N.finditer(s):
        got = _norm(m.group(1), m.group(2))
        if got:
            out.add(got)
    for m in CADENCE_1.finditer(s):
        got = _norm(1, m.group(1))
        if got:
            out.add(got)
    for m in PERIOD.finditer(s):
        n, unit = m.group(1).lower().strip(), re.sub(r'\s+',' ',m.group(2).lower())
        # "within a period of thirty days" can also match with n='of'; the
        # WORDNUM lookup below drops anything that is not a number, so a
        # non-numeric capture simply falls through rather than being invented.
        # The PDF extraction splits words across spaces — the LODR text contains
        # "within se ven days". Reading that as an unknown token made Reg 61A(2)
        # look like it contradicted itself when it says exactly what the rule says.
        # One canonical key: lowercase with every space and hyphen removed. The
        # extraction writes "forty -five", the regulation writes "forty-five"
        # and the corpus writes "forty five"; all three are the same number and
        # were three different misses.
        key = re.sub(r'[\s-]+', '', n)
        n = WORDNUM.get(key, WORDNUM.get(n, n))
        try: n = int(n)
        except Exception: continue
        # calendar/clear/trading days are all "day" for comparison: the corpus
        # and the regulation frequently differ on the adjective while stating
        # the same number, and flagging that as a mismatch is noise.
        u = ('working day' if 'working' in unit or 'business' in unit
             else unit.replace('calendar ', '').replace('clear ', '')
                      .replace('trading ', '').rstrip('s'))
        out.add((n, u))
    return out


# A provision that hands the period to rules or to the Board states no period
# itself, and saying so is a different finding from contradicting the rule.
DELEGATES = re.compile(
    r'as\s+may\s+be\s+(?:prescribed|specified)|as\s+(?:may\s+be\s+)?specified\s+by\s+the\s+Board'
    r'|in\s+such\s+(?:time|form|manner)[^.]{0,60}as\s+may\s+be\s+prescribed', re.I)


def body_start(text, law):
    """Where the numbered provisions begin.

    The Act opens with an ARRANGEMENT OF SECTIONS listing every section in
    order, so searching from character zero matches the contents line rather
    than the section. Section 96 resolved to "96. Annual general meeting. 97.
    Power of Tribunal..." -- the contents -- and every Companies Act period
    check was reading it.
    """
    if law != CA_STALE:
        return 0
    m = re.search(r'An Act to consolidate', text, re.I)
    return m.start() if m else 0


def body_end(text, law):
    """Where the numbered provisions stop.

    After the schedules, the LODR compilation prints a numbered list of
    superseded circulars. Reg 52 matched item 52 of that list -- a table of
    2002-03 circulars -- instead of Regulation 52. Numbering restarts there,
    the same trap as the Schedule III paragraphs in SS3t.
    """
    if law == CA_STALE:
        return len(text)
    m = re.search(r'SCHEDULE\s+I\b', text)
    return m.start() if m else len(text)


_SPANS = {}


def provision_spans(text, law):
    """First position of every numbered provision, and where each one ends.

    Located once per text and cached. Each provision runs to the NEXT heading,
    so a long one is not truncated -- Regulation 33 runs several times past the
    2600-character window that used to cut it off before sub-regulation (3)(a),
    which is the part its rules cite.
    """
    key = (id(text), law)
    if key in _SPANS:
        return _SPANS[key]
    a, b = body_start(text, law), body_end(text, law)
    body = text[a:b]
    pats = ([r'(?<![\d.])(\d{1,3}[A-Z]{0,2})\s*\.\s*(?:\d{1,4}\[)?\(1\)']
            if law != CA_STALE else
            [r'(?:^|\s|\[)(\d{1,3}[A-Z]{0,2})\s*\.\s*[A-Z]'])
    first = {}
    for pat in pats:
        for m in re.finditer(pat, body):
            p = m.group(1).upper()
            if p not in first:
                first[p] = m.start()
    order = sorted(first.items(), key=lambda x: x[1])
    spans = {}
    for i, (p, pos) in enumerate(order):
        end = order[i + 1][1] if i + 1 < len(order) else len(body)
        spans[p] = (a + pos, a + end)
    _SPANS[key] = spans
    return spans


def context_of(text, reg, law=None, span=2600):
    """The cited provision's own text, heading to next heading."""
    spans = provision_spans(text, law)
    hit = spans.get(str(reg).upper())
    if not hit:
        return None
    s, e = hit
    # A provision shorter than the old window keeps the window, so nothing that
    # used to be reachable stops being so.
    return text[s:max(e, min(len(text), s + span))]


# ── the parser checks itself before it checks the law ─────
# Every "finding" on this audit's first three runs was its own bug (SS2v), and
# SS3w added a fourth: a widening that fixed the digit case and left every
# spelled one broken, "which is worse than the bug it replaced because it looked
# like progress". Both shapes of every form are pinned here, so a parser change
# that silently narrows the audit fails the gate instead of quietly comparing
# fewer rules.
PARSER_CASES = [
    # cadences -- the shape SS4h added. Digit AND spelled.
    ('Review at least once every 3 years',           {(3, 'year')}),
    ('at least once every three years',              {(3, 'year')}),
    ('Once in every five years starting from grant', {(5, 'year')}),
    ('once in every 5 years',                        {(5, 'year')}),
    ('At least once a year',                         {(1, 'year')}),
    ('At least once in a financial year',            {(1, 'year')}),
    ('not less than once in a year',                 {(1, 'year')}),
    # deadlines -- every one of these is a bug this audit actually had.
    ('within 30 days',                  {(30, 'day')}),          # the plain case
    ('not later than twenty one days',  {(21, 'day')}),          # SS2v, two words
    ('within se ven days',              {(7, 'day')}),           # SS2v, split word
    ('within forty -five days',         {(45, 'day')}),          # SS3v, split number
    ('w ithin forty eight hours',       {(48, 'hour')}),         # SS3v, split "within"
    ('within 2 working days',           {(2, 'working day')}),   # SS3w, greedy branch
    ('within a period of thirty days',  {(30, 'day')}),          # SS3v, filler
    ('at least three working days',     {(3, 'working day')}),
]
_bad = [(s, exp, periods_in(s)) for s, exp in PARSER_CASES if periods_in(s) != exp]
if _bad:
    print('PARSER SELF-CHECK FAILED — the audit cannot be trusted this run.')
    for s, exp, got in _bad:
        print('   %-46r expected %s, got %s' % (s, sorted(exp), sorted(got)))
    print('\nEvery case above is a shape one of these texts actually uses.')
    sys.exit(2)

findings = collections.defaultdict(list)
counts = collections.Counter()

# ── per-rule verdicts, for the app ──────────────────────────────────
# Everything below is already computed to print a total. A reviewer opening a
# rule in Rule Governance sees its title and nothing this gate established, so
# they re-do by hand the reading it already did. SS3t set out to make verifying
# a rule REVIEW rather than research and delivered half of it: the amendment
# footnotes reach the screen, the period comparison does not.
verdicts = {}


def excerpt(s, limit=340):
    """The provision's own opening words, readable.

    This extraction writes `w ithin`, `forty -five` and inline footnote markers
    (SS2v, SS3z). Those are left ALONE - repairing them here would show the
    reviewer a text that differs from the one they are checking against, which
    is worse than an awkward one. Only whitespace is collapsed."""
    s = re.sub(r'\s+', ' ', (s or '')).strip()
    if len(s) <= limit:
        return s
    cut_at = s.rfind(' ', 0, limit)
    return s[:cut_at if cut_at > limit - 60 else limit].rstrip() + '\u2026'


def verdict(rid, code, cite, states=None, carries=None, text=None):
    if not rid:
        return
    v = {'v': code, 'c': cite or ''}
    if states:
        v['w'] = sorted('%d %s' % (n, u) for n, u in states)
    if carries:
        v['h'] = sorted('%d %s' % (n, u) for n, u in carries)[:6]
    if text:
        v['x'] = excerpt(text)
    verdicts[str(rid)] = v

texts = {}
for law, (path, asof) in SOURCES.items():
    try:
        texts[law] = load_text(path)
        print('%-28s %s  (%d KB)' % (law, asof, len(texts[law]) // 1024))
    except Exception as e:
        print('%-28s COULD NOT READ: %s' % (law, e))

print()
present = {law: (sections_present(t) if law == CA_STALE else regs_present(t))
           for law, t in texts.items()}
for law, s in present.items():
    print('%-28s %d numbered provisions located in the text' % (law, len(s)))
print()

for path, key, law in CORPORA:
    try:
        data = json.load(io.open(path, encoding='utf-8'))
    except Exception as e:
        print('skip %s (%s)' % (path, e)); continue
    if law not in texts:
        continue
    text = texts[law]
    for r in data.get(key, []):
        rid = r.get('id')
        cite = r.get('regulation') or ''
        regs = cited_sections(cite) if law == CA_STALE else cited_regs(cite)
        counts['checked'] += 1

        if not regs:
            counts['no citation'] += 1
            findings['no citation to check'].append((rid, cite, ''))
            verdict(rid, 'nocite', cite)
            continue

        missing = [g for g in regs if g not in present[law]]
        if missing:
            if law == CA_STALE:
                # Two possible causes and this cannot separate them: a wrong
                # citation, or a provision inserted after April 2021. Reported,
                # never blocking — see CA_STALE.
                counts['not in the 2021 Act text'] += 1
                findings['Companies Act — not in the 01.04.2021 text '
                         '(wrong citation, or newer than the text)'].append(
                    (rid, cite, 'missing: ' + ', '.join(missing)))
                verdict(rid, 'stale', cite)
            else:
                counts['citation not found'] += 1
                findings['cites a provision not found in the current text'].append(
                    (rid, cite, 'missing: ' + ', '.join(missing)))
                verdict(rid, 'missing', cite)
            continue
        counts['citation found'] += 1

        # Does the stated period appear near the provision?
        tl = r.get('timelineText') or r.get('disclosureTimelineText') or ''
        want = periods_in(tl)
        ctx0 = context_of(text, regs[0], law)
        if not want:
            counts['rule states no period'] += 1
            # Still worth carrying the provision's own words: "states no period"
            # is the commonest verdict by far (212 of 419) and it is exactly the
            # rule a person has to read for themselves.
            verdict(rid, 'noperiod', cite, text=ctx0)
            continue
        ctx = ctx0
        if not ctx:
            verdict(rid, 'noctx', cite, states=want)
            continue
        have = periods_in(ctx)

        # A Schedule entry cites the regulation that ENABLES it. Where that
        # regulation carries periods but not this one, the Schedule item itself
        # carries it -- Part A items 7B, 7C and 15(b) are exactly this. Checked
        # BEFORE delegation, because the id is a fact and the delegation test is
        # a phrase that may belong to a different sub-provision entirely.
        if have and not (want & have) and re.search(r'SCH|SCHEDULE', str(rid), re.I):
            counts['schedule entry: period not in the citing regulation'] += 1
            findings['schedule entry — period is in the Schedule item, '
                     'not the regulation it cites'].append(
                (rid, cite, 'rule says %s; %s carries %s' % (
                    sorted(want), regs[0], sorted(have)[:4])))
            verdict(rid, 'sched', cite, states=want, carries=have, text=ctx)
            continue

        if DELEGATES.search(ctx) and not (want & have):
            # The provision delegates. The number the register shows comes from
            # a rule or circular, and whether that is the right number cannot be
            # settled from the text held here.
            counts['period delegated by the provision'] += 1
            findings['provision delegates the period to rules or the Board'].append(
                (rid, cite, 'rule says %s; the provision says "as may be prescribed"'
                 % sorted(want)))
            verdict(rid, 'deleg', cite, states=want, text=ctx)
            continue
        if not have:
            # The rule states a period and the provision states none. Not a
            # contradiction -- the period may live in a Schedule, a circular or
            # a rule not held here -- but it is the worklist, because nothing
            # in the held text confirms the number the register shows.
            counts['period not stated in the provision'] += 1
            findings['rule states a period the provision does not'].append(
                (rid, cite, 'rule says %s; nothing timed near %s' % (sorted(want), regs[0])))
            verdict(rid, 'nostate', cite, states=want, text=ctx)
            continue
        counts['period compared'] += 1
        if have and not (want & have):
            counts['period mismatch'] += 1
            findings['stated period not found near the provision'].append(
                (rid, cite, 'rule says %s; text near %s says %s' % (
                    sorted(want), regs[0], sorted(have))))
            verdict(rid, 'mismatch', cite, states=want, carries=have, text=ctx)
        else:
            verdict(rid, 'ok', cite, states=want, carries=have, text=ctx)

print('─' * 70)
for k in ['checked', 'citation found', 'citation not found', 'not in the 2021 Act text',
          'no citation', 'rule states no period',
          'schedule entry: period not in the citing regulation',
          'period delegated by the provision',
          'period not stated in the provision',
          'period compared', 'period mismatch']:
    print('  %-38s %d' % (k, counts[k]))
# A count of mismatches means nothing without the count of comparisons behind
# it. This audit compared SIX of 327 rules until v186 and said only "period
# mismatch: 0", which reads as a clean bill of health for the whole corpus.
print('  %-38s %s' % ('periods actually compared',
      ('%d of %d rules (%.0f%%)' % (counts['period compared'], counts['checked'],
       100.0 * counts['period compared'] / max(1, counts['checked'])))))
print('─' * 70)

for group, rows in findings.items():
    print('\n── %s — %d ──' % (group, len(rows)))
    show = rows if DETAIL else rows[:12]
    for rid, cite, note in show:
        print('   %-38s %-26s %s' % (str(rid)[:37], str(cite)[:25], note[:70]))
    if not DETAIL and len(rows) > 12:
        print('   ... %d more (run with --detail)' % (len(rows) - 12))

if counts['not in the 2021 Act text']:
    print()
    print('The Companies Act text here is amended only to 01.04.2021. A section it does')
    print('not contain may be a wrong citation OR a provision added since — this cannot')
    print('tell them apart, so those %d are reported and never block. They are the'
          % counts['not in the 2021 Act text'])
    print('worklist for the day a current Act reaches reference/.')

print('\nEvery line above is a question for the CS, not a finding. A citation the')
print('parser cannot locate may be a heading this extraction mangled; a period')
print('mismatch may be a proviso the context window missed.')
print()
print('KNOWN LIMIT: a period is compared against the WHOLE cited provision, not')
print('against the sub-provision the rule names. So an agreement may be with a')
print('neighbouring sub-section — s.90 states "thirty days" in sub-section (6),')
print('about a different duty entirely, while s.90(4) states no period at all.')
print('Narrowing to the sub-provision was tried and withdrawn: a cross-reference')
print('such as "sub-regulation (4)" reads as the next sub-provision and cut Reg')
print('7(5) off before its own period. An agreement here means the number appears')
print('in the provision, NOT that it appears in the clause the rule cites.')

# ── release gate ────────────────────────────────────────────────
# Only two categories block. A rule citing a provision that is not in the
# current text may have been amended out from under us, and a stated period that
# contradicts its own provision is either wrong or the parser is — both need a
# person before the build ships.
#
# "No citation to check" and "schedule-derived" are observations, not defects.
# Failing a release over those would teach everyone to skip the gate, which
# costs more than it saves.
# What the reviewer gets.
#
# Written EVERY run, not behind a flag. A generated file that has to be
# regenerated by hand goes stale the first time somebody forgets -- SS3t
# recorded that about amendments.py and SS4b about the corpus blobs. The gate
# already runs before every deploy, so the embed cannot drift behind it.
OUT = 'rules/audit_findings.json'
EMBED_KEY = 'var LG_GATE = '
APP = 'index.html'

payload = {
    'generatedBy': 'tools/rule_audit.py',
    'asOf': {law: asof for law, (path, asof) in SOURCES.items()},
    # Printed on screen beside the verdict, because SS3v measured this at 4 of
    # 23 and withdrew the narrowing rather than ship one that is wrong half the
    # time. A reviewer who does not know it will read more into an agreement
    # than the check can support.
    'limit': ('A period is compared against the WHOLE cited provision, not '
              'against the sub-clause the rule names. An agreement means the '
              'number appears in the provision, not that it appears in the '
              'clause cited.'),
    'codes': {
        'ok':       'the period this rule states appears in the provision it cites',
        'mismatch': 'the provision carries periods and none of them is this one',
        'noperiod': 'this rule states no period, so there is nothing to compare',
        'nostate':  'the rule states a period and the provision states none',
        'deleg':    'the provision delegates the period to rules or to the Board',
        'sched':    'a Schedule entry: the period is in the Schedule item, not in '
                    'the regulation it cites',
        'nocite':   'this rule cites no numbered provision',
        'missing':  'the cited provision was not found in the held text',
        'stale':    'not in the 01.04.2021 Act text \u2014 a wrong citation, or newer '
                    'than the text held here',
        'noctx':    'the provision was located but no readable span came back',
    },
    'rules': verdicts,
}

blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
io.open(OUT, 'w', encoding='utf-8', newline='\n').write(blob)
print('\nwrote %s (%d rules, %d KB)' % (OUT, len(verdicts), len(blob) // 1024))

try:
    html = io.open(APP, encoding='utf-8', newline='').read()
except Exception as e:
    print('could not read %s (%s) -- embed not updated' % (APP, e))
else:
    i = html.find(EMBED_KEY)
    if i < 0:
        print('%s does not contain "%s" -- embed not updated' % (APP, EMBED_KEY))
    else:
        j = html.find(';\n', i)
        if j < 0:
            print('could not find the end of the LG_GATE statement -- not updated')
        else:
            new = html[:i] + EMBED_KEY + blob + html[j:]
            if new == html:
                print('embed in %s already current' % APP)
            else:
                io.open(APP, 'w', encoding='utf-8', newline='').write(new)
                print('updated the embed in %s (%d -> %d chars)'
                      % (APP, len(html), len(new)))

BLOCKING = counts['citation not found'] + counts['period mismatch']
print()
if BLOCKING:
    print('RELEASE GATE: %d finding(s) need a decision before shipping.' % BLOCKING)
    print('Run with --detail, and record the outcome on the Rule Governance screen.')
    sys.exit(1)
print('RELEASE GATE: clear — %d citations checked, none unresolved.'
      % counts['citation found'])
sys.exit(0)
