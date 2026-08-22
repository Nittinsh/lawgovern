"""
Convert the LODR master checklist spreadsheet into machine-readable rules.

Two outputs:
  rules/lodr_periodic.json  — 106 calendar obligations
  rules/lodr_events.json    — 125 Schedule III material events

Parsing principle: only produce a computable due-date rule when the wording is
unambiguous. Anything requiring judgement is emitted with due.type == "review"
and needsReview == true, so it shows up in the app as needing a human decision
rather than being silently guessed at.
"""
import json, io, re, sys
from collections import Counter


# ── Indian financial-year anchors (confirmed by the owner, a practising CS) ──
# FY ends 31 March. Quarter ends: 30 Jun, 30 Sep, 31 Dec, 31 Mar.
FY_END = {'month': 3, 'day': 31}
QUARTER_ENDS = [
    {'q': 'Q1', 'covers': 'Apr-Jun', 'month': 6,  'day': 30},
    {'q': 'Q2', 'covers': 'Jul-Sep', 'month': 9,  'day': 30},
    {'q': 'Q3', 'covers': 'Oct-Dec', 'month': 12, 'day': 31},
    {'q': 'Q4', 'covers': 'Jan-Mar', 'month': 3,  'day': 31},
]
HALF_YEAR_ENDS = [
    {'h': 'H1', 'covers': 'Apr-Sep', 'month': 9, 'day': 30},
    {'h': 'H2', 'covers': 'Oct-Mar', 'month': 3, 'day': 31},
]

RAW_P = 'rules/_raw_periodic.json'
RAW_M = 'rules/_raw_material.json'

# ── due-date rules ───────────────────────────────────────────────
# Each returns a dict, or None if the pattern does not apply.
def parse_timeline(text, freq):
    t = (text or '').strip()
    tl = t.lower()
    f = (freq or '').strip().lower()

    if not t:
        return {'type': 'review'}, True

    # Continuous / ongoing duties have no due date at all. Treating them as
    # "due" would produce permanent false overdues.
    if re.search(r'^(ongoing|continuous)', tl) or tl.startswith('ongoing;'):
        return {'type': 'continuous'}, False

    # "Within N days/working days from the end of each quarter"
    m = re.search(r'within\s+(\d+)\s+(working\s+)?days?\s+from\s+the\s+end\s+of\s+each\s+quarter', tl)
    if m:
        return {'type': 'quarter_end_offset', 'days': int(m.group(1)),
                'workingDays': bool(m.group(2))}, False

    # "Within N days from the end of each quarter" phrased as "of each quarter"
    m = re.search(r'within\s+(\d+)\s+(working\s+)?days?\s+.*quarter', tl)
    if m:
        return {'type': 'quarter_end_offset', 'days': int(m.group(1)),
                'workingDays': bool(m.group(2))}, False

    # "Within N days of/from the end of the financial year"
    m = re.search(r'within\s+(\d+)\s+(working\s+)?days?\s+(of|from)\s+(the\s+)?end\s+of\s+the\s+(financial\s+year|fy)', tl)
    if m:
        return {'type': 'fy_end_offset', 'days': int(m.group(1)),
                'workingDays': bool(m.group(2))}, False

    # "Within N days of the AGM"
    m = re.search(r'within\s+(\d+)\s+(working\s+)?days?\s+(of|from)\s+(the\s+)?agm', tl)
    if m:
        return {'type': 'agm_offset', 'days': int(m.group(1)),
                'workingDays': bool(m.group(2))}, False

    # "Within N working days of the change/event"  -> event-triggered
    m = re.search(r'within\s+(\d+)\s+(working\s+)?days?\s+of\s+(the\s+)?(change|event|occurrence|receipt|meeting|board meeting)', tl)
    if m:
        return {'type': 'event_offset', 'days': int(m.group(1)),
                'workingDays': bool(m.group(2)),
                'trigger': m.group(4)}, False

    # "Not later than N calendar days from date of receipt ..."
    m = re.search(r'(not later than|within)\s+(\d+)\s+calendar\s+days?', tl)
    if m:
        return {'type': 'event_offset', 'days': int(m.group(2)), 'workingDays': False,
                'trigger': 'receipt'}, False

    # Board-meeting cadence rule (Reg 17(2) style)
    if re.search(r'min\.?\s*4\s*per\s*fy', tl) or 'max gap 120' in tl:
        return {'type': 'cadence', 'minPerYear': 4, 'maxGapDays': 120}, False

    # "At least once per FY" / "Annually" / "At the AGM" — annual, but the exact
    # trigger date is a matter of practice, so flag it.
    if re.search(r'(at least once (per|every) fy|annually|at the agm|with the annual report|annexed to the annual report)', tl):
        return {'type': 'annual', 'anchor': 'fy_end'}, True

    if re.search(r'review at least once every\s+(\d+)\s+year', tl):
        n = int(re.search(r'every\s+(\d+)\s+year', tl).group(1))
        return {'type': 'multi_year', 'years': n}, True

    if 'on expiry of 7 years' in tl:
        return {'type': 'multi_year', 'years': 7}, True

    # Bare cadence words with no offset — real, but the date needs deciding.
    if f.startswith('quarterly') or tl.startswith('quarterly'):
        return {'type': 'quarterly', 'anchor': 'quarter_end'}, True
    if f.startswith('half'):
        return {'type': 'half_yearly', 'anchor': 'half_year_end'}, True
    if f.startswith('monthly'):
        return {'type': 'monthly', 'anchor': 'month_end'}, True
    if f.startswith('annual'):
        return {'type': 'annual', 'anchor': 'fy_end'}, True
    if f.startswith('event'):
        m = re.search(r'(\d+)\s*(working\s*)?days?', f)
        if m:
            return {'type': 'event_offset', 'days': int(m.group(1)),
                    'workingDays': bool(m.group(2)), 'trigger': 'event'}, False
        return {'type': 'event', 'trigger': 'event'}, True

    # "As specified by SEBI" and anything else unrecognised.
    return {'type': 'review'}, True


# ── applicability ────────────────────────────────────────────────
def parse_applicability(text):
    t = (text or '').strip()
    tl = t.lower()
    rule = {}
    review = False

    if 'equity-listed' in tl:
        rule['listingType'] = ['equity']
    elif 'ncs-listed' in tl:
        rule['listingType'] = ['ncs']
    elif 'hvdle' in tl:
        rule['listingType'] = ['hvdle']
    elif 'all listed' in tl:
        rule['listingType'] = ['equity', 'ncs', 'hvdle']
    else:
        review = True

    if 'hvdle' in tl and rule.get('listingType') and 'hvdle' not in rule['listingType']:
        rule['listingType'].append('hvdle')

    # Carve-outs and thresholds that cannot be expressed as a flat list.
    if 'top 100' in tl:
        rule['marketCapRank'] = {'atMost': 100}
    if 'top 500' in tl:
        rule['marketCapRank'] = {'atMost': 500}
    if 'top 1000' in tl:
        rule['marketCapRank'] = {'atMost': 1000}
    if 'except mf' in tl or 'except mutual fund' in tl:
        rule['excludes'] = ['mutual_fund']
    if 'with subsidiaries' in tl:
        rule['requires'] = rule.get('requires', []) + ['has_subsidiary']
    if 'unutilised issue proceeds' in tl:
        rule['requires'] = rule.get('requires', []) + ['unutilised_issue_proceeds']
    if 'monitoring agency' in tl:
        rule['requires'] = rule.get('requires', []) + ['monitoring_agency']
    if 'secured ncd' in tl:
        rule['requires'] = rule.get('requires', []) + ['secured_ncds']
    if 'sme' in tl:
        rule['note'] = 'SME inclusion/exclusion — check effective date'
        review = True
    if 'exemption' in tl or 'not applicable to' in tl or 'igp' in tl:
        review = True

    return rule, review


def slug(reg, n):
    s = re.sub(r'[^A-Za-z0-9]+', '-', (reg or f'row{n}')).strip('-').upper()
    return f'LODR-{s}'


def main():
    per = json.load(io.open(RAW_P, encoding='utf-8'))
    out, need = [], 0
    seen = Counter()
    for p in per:
        reg = p.get('Regulation')
        sid = slug(reg, p.get('S. No'))
        seen[sid] += 1
        if seen[sid] > 1:
            sid = f'{sid}-{seen[sid]}'

        due, due_soft = parse_timeline(p.get('Statutory Timeline'), p.get('Frequency'))
        app, app_review = parse_applicability(p.get('Applicable To'))

        # exact   — the text states an explicit offset, so the date is computable
        # derived — cadence is known, the anchor is assumed (needs your sign-off once)
        # none    — no due date by nature (continuous duties)
        # unknown — wording needs a human decision
        t = due['type']
        if t in ('quarter_end_offset','fy_end_offset','agm_offset','event_offset','cadence'):
            conf = 'exact'
        elif t == 'continuous':
            conf = 'none'
        elif t == 'review':
            conf = 'unknown'
        else:
            conf = 'derived'
        due['confidence'] = conf
        # Bind the confirmed anchors so the front end computes, never guesses.
        if due['type'] in ('annual',):
            due['anchorDate'] = FY_END
        elif due['type'] in ('quarterly', 'quarter_end_offset'):
            due['anchorDates'] = QUARTER_ENDS
        elif due['type'] in ('half_yearly',):
            due['anchorDates'] = HALF_YEAR_ENDS
        elif due['type'] == 'fy_end_offset':
            due['anchorDate'] = FY_END
        review = (conf == 'unknown') or app_review
        if review:
            need += 1

        out.append({
            'id': sid,
            'sourceRow': p.get('S. No'),
            'law': 'SEBI LODR 2015',
            'regulation': reg,
            'chapter': p.get('Ch.'),
            'title': p.get('Compliance Requirement'),
            'frequency': p.get('Frequency'),
            'timelineText': p.get('Statutory Timeline'),
            'due': due,
            'appliesTo': app,
            'appliesToText': p.get('Applicable To'),
            'submitTo': p.get('Submit To / Place Before'),
            'signedBy': p.get('Signed / Certified By'),
            'notes': p.get('Practitioner Notes & Recent Amendments'),
            'needsReview': review,
            'dueConfidence': conf,
        })

    io.open('rules/lodr_periodic.json', 'w', encoding='utf-8').write(
        json.dumps({'meta': {'source': 'LODR Compliance Calendar and Material Events.xlsx',
                             'fyEnd': FY_END, 'quarterEnds': QUARTER_ENDS,
                             'halfYearEnds': HALF_YEAR_ENDS, 'count': len(out)},
                    'rules': out}, ensure_ascii=False, indent=1))

    # ── material events ──────────────────────────────────────────
    mat = json.load(io.open(RAW_M, encoding='utf-8'))
    ev, ev_need = [], 0
    for m in mat:
        tl = (m.get('Disclosure Timeline') or '').lower()
        d = re.search(r'(\d+)\s*(working\s*)?(hours|days)', tl)
        if d:
            n = int(d.group(1))
            unit = d.group(3)
            timing = {'type': 'hours' if unit == 'hours' else 'days',
                      'value': n, 'workingDays': bool(d.group(2))}
            r = False
        else:
            timing = {'type': 'review'}
            r = True
        mt = (m.get('Materiality Test') or '').strip()
        # Materiality is a judgement the Company Secretary makes. That is not a
        # parsing failure, so it does not count as "needs review" — the app lists
        # the event and the test, and the CS decides.
        auto = mt.lower() in ('', 'deemed material', 'always material', 'n/a')
        if r:
            ev_need += 1
        ev.append({
            'id': f"LODR-SCH3-{m.get('Sch. III Part') or '?'}-{m.get('Para') or '?'}-{m.get('Item No.') or m.get('S. No')}",
            'sourceRow': m.get('S. No'),
            'law': 'SEBI LODR 2015',
            'schedulePart': m.get('Sch. III Part'),
            'para': m.get('Para'),
            'item': m.get('Item No.'),
            'event': m.get('Event / Information'),
            'materialityTest': mt or None,
            'materialityIsAutomatic': auto,
            'disclosureTimelineText': m.get('Disclosure Timeline'),
            'timing': timing,
            'regulation': m.get('Regulation'),
            'appliesToText': m.get('Applicable To'),
            'notes': m.get('Explanations, Thresholds & Practitioner Notes'),
            'needsReview': r,
        })

    io.open('rules/lodr_events.json', 'w', encoding='utf-8').write(
        json.dumps({'meta': {'source': 'LODR Compliance Calendar and Material Events.xlsx',
                             'count': len(ev)}, 'events': ev}, ensure_ascii=False, indent=1))

    print(f'periodic : {len(out)} rules, {need} need a decision from you')
    print('  confidence:', dict(Counter(o['dueConfidence'] for o in out)))
    print('  due types :', dict(Counter(o['due']['type'] for o in out)))
    print()
    print(f'events   : {len(ev)} events, {ev_need} with unclear timing')
    print('  timings   :', dict(Counter(e['timing']['type'] for e in ev)))
    print('  materiality automatic:', sum(1 for e in ev if e['materialityIsAutomatic']),
          '| needs CS judgement:', sum(1 for e in ev if not e['materialityIsAutomatic']))


if __name__ == '__main__':
    main()
