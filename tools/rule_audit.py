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
}

CORPORA = [
    ('rules/lodr_periodic.json', 'rules', 'SEBI LODR 2015'),
    ('rules/lodr_events.json',   'events', 'SEBI LODR 2015'),
    ('rules/pit_master.json',    'rules', 'SEBI PIT Regulations 2015'),
]


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


PERIOD = re.compile(
    r'within\s+((?:\w+[\s-])?\w+|\d+)\s+(working\s+days?|days?|hours?|months?)', re.I)

# The regulations spell numbers, and not always with a hyphen — "twenty one
# days" is two words in the LODR text. Reading only "twenty-one" made Reg 31's
# own period invisible to this audit and produced a mismatch against itself.
WORDNUM = {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,
           'nine':9,'ten':10,'eleven':11,'twelve':12,'fourteen':14,'fifteen':15,
           'twenty':20,'thirty':30,'forty':40,'forty five':45,'forty-five':45,
           'forty eight':48,'forty-eight':48,'sixty':60,'ninety':90,
           'twenty one':21,'twenty-one':21,'twenty four':24,'twenty-four':24,
           'one hundred':100,'hundred':100,'seven':7}


def periods_in(s):
    out = set()
    for m in PERIOD.finditer(s or ''):
        n, unit = m.group(1).lower().strip(), re.sub(r'\s+',' ',m.group(2).lower())
        # The PDF extraction splits words across spaces — the LODR text contains
        # "within se ven days". Reading that as an unknown token made Reg 61A(2)
        # look like it contradicted itself when it says exactly what the rule says.
        n = WORDNUM.get(n,
            WORDNUM.get(n.replace('-', ' '),
            WORDNUM.get(n.replace(' ', '').replace('-', ''), n)))
        try: n = int(n)
        except Exception: continue
        out.add((n, 'working day' if 'working' in unit else unit.rstrip('s')))
    return out


def context_of(text, reg, span=2600):
    """Text around the numbered heading for a regulation, if it can be located."""
    for pat in [r'(?<![\d.])' + re.escape(reg) + r'\s*\.\s*\(1\)',
                r'(?<![\d.])' + re.escape(reg) + r'\s*\.\s*[A-Z]']:
        m = re.search(pat, text)
        if m:
            return text[m.start():m.start() + span]
    return None


findings = collections.defaultdict(list)
counts = collections.Counter()

texts = {}
for law, (path, asof) in SOURCES.items():
    try:
        texts[law] = load_text(path)
        print('%-28s %s  (%d KB)' % (law, asof, len(texts[law]) // 1024))
    except Exception as e:
        print('%-28s COULD NOT READ: %s' % (law, e))

print()
present = {law: regs_present(t) for law, t in texts.items()}
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
        regs = cited_regs(cite)
        counts['checked'] += 1

        if not regs:
            counts['no citation'] += 1
            findings['no citation to check'].append((rid, cite, ''))
            continue

        missing = [g for g in regs if g not in present[law]]
        if missing:
            counts['citation not found'] += 1
            findings['cites a provision not found in the current text'].append(
                (rid, cite, 'missing: ' + ', '.join(missing)))
            continue
        counts['citation found'] += 1

        # Does the stated period appear near the provision?
        tl = r.get('timelineText') or r.get('disclosureTimelineText') or ''
        want = periods_in(tl)
        if not want:
            continue
        # A Schedule entry cites the regulation that ENABLES it, while its own
        # period lives in the Schedule — Schedule III Part E items all cite
        # Reg 87B(1) and take their 24 hours from the Schedule, not from 87B.
        # Comparing the two produces two dozen mismatches that are all artefacts
        # of where the period is written, so they are counted separately rather
        # than presented as questions about the law.
        if re.search(r'SCH|SCHEDULE', str(rid), re.I):
            counts['schedule-derived (period lives in the Schedule)'] += 1
            continue

        ctx = context_of(text, regs[0])
        if not ctx:
            continue
        have = periods_in(ctx)
        if have and not (want & have):
            counts['period mismatch'] += 1
            findings['stated period not found near the provision'].append(
                (rid, cite, 'rule says %s; text near %s says %s' % (
                    sorted(want), regs[0], sorted(have))))

print('─' * 70)
for k in ['checked', 'citation found', 'citation not found', 'no citation',
          'schedule-derived (period lives in the Schedule)', 'period mismatch']:
    print('  %-24s %d' % (k, counts[k]))
print('─' * 70)

for group, rows in findings.items():
    print('\n── %s — %d ──' % (group, len(rows)))
    show = rows if DETAIL else rows[:12]
    for rid, cite, note in show:
        print('   %-38s %-26s %s' % (str(rid)[:37], str(cite)[:25], note[:70]))
    if not DETAIL and len(rows) > 12:
        print('   ... %d more (run with --detail)' % (len(rows) - 12))

print('\nEvery line above is a question for the CS, not a finding. A citation the')
print('parser cannot locate may be a heading this extraction mangled; a period')
print('mismatch may be a proviso the context window missed.')
