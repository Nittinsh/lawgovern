"""
Build the forms master.

Inputs
  rules/forms_seed.json   — FORM_MASTER (91 thin rows) + FORMS (19 rich rows),
                            extracted out of index.html
  rules/ca_master.json    — the owner's own master sheets. Every form named in a
  rules/pit_master.json     rule brings that rule's section, timeline and
  rules/lodr_periodic.json  applicability across with it, which is what answers
  rules/lodr_events.json    "why would I file this form".

Output
  rules/forms_master.json  {meta, forms[], withdrawn[]}

Why the detail is not authored here: the set of currently valid forms, their
timelines and their penalties is legal content. Inventing entries would be
exactly the fabrication this product exists to avoid. This script only cleans,
normalises and joins material that either the owner supplied or the app already
carried, and labels every record with how well evidenced it is.
"""
import io, json, os, re, sys
from collections import Counter, defaultdict

SEED = 'rules/forms_seed.json'
OUT = 'rules/forms_master.json'
RULE_FILES = ['rules/ca_master.json', 'rules/pit_master.json',
              'rules/lodr_periodic.json', 'rules/lodr_events.json']

# Forms omitted or superseded. These are pulled OUT of the master list into a
# separate `withdrawn` array — the owner asked for them gone from the working
# data. They are kept as a short record rather than erased so that a search for
# "MGT-9" answers "omitted in 2017" instead of returning nothing, which is the
# failure mode that gets an old checklist item filed by mistake.
WITHDRAWN = {
    'INC-1':  'Omitted. Name reservation is now SPICe+ Part A (or RUN for an existing company).',
    'INC-2':  'Omitted. OPC incorporation is now through SPICe+.',
    'INC-7':  'Omitted. Incorporation is now through SPICe+.',
    'INC-29': 'Omitted. Integrated incorporation is now through SPICe+.',
    'INC-21': 'Omitted. Commencement of business is now declared in INC-20A.',
    'MGT-9':  'Omitted by the Companies (Amendment) Act 2017. The extract of the annual '
              'return is no longer prepared; the annual return itself is placed on the '
              'company website and the web link is given in the Board\'s Report.',
}

# Entries that are not forms. "Physical" is a spilled cell from the AOC-2 row.
JUNK = {'Physical'}

# Known defects in the existing list.
FIXES = {
    'AO4- CGS': 'AOC-4 CFS',
    'MSME Form 1': 'MSME-1',
    'INC 16/17': 'INC-16',
}

# Cells that spilled, so the row lost its own values.
PATCH = {
    'AOC-2': {'type': 'Physical',
              'desc': 'Particulars of contracts or arrangements entered into with related '
                      'parties under Section 188(1) — annexed to the Board\'s Report.'},
}

# Well-known trade names, so a search for either spelling finds the form.
ALIASES = {
    'INC-32': ['SPICe+', 'SPICe Plus', 'SPICe+ Part B'],
    'INC-33': ['eMOA', 'e-MOA'],
    'INC-34': ['eAOA', 'e-AOA'],
    'INC-35': ['AGILE-PRO-S', 'AGILE PRO'],
    'INC-22A': ['ACTIVE'],
    'DIR-3 KYC': ['DIR-3-KYC', 'KYC'],
    'MGT-7A': ['Abridged Annual Return'],
    'MR-3': ['Secretarial Audit Report'],
}

FORM_PAT = re.compile(
    r'(?<![A-Za-z0-9])(INC|DIR|AOC|MGT|DPT|ADT|CHG|PAS|SH|MR|CRA|BEN|MSC|IEPF|FC|CAA|'
    r'STK|RSC|MSME|NDH|GNL|URC|CSR|NCLT)[\s\-]?([0-9]{1,3}[A-Z]{0,3})(?![A-Za-z0-9])')


def norm_form(name):
    """DPT 3, DPT-3 and DPT3 are one form. Normalise to the hyphenated spelling."""
    s = str(name or '').strip()
    s = FIXES.get(s, s)
    s = re.sub(r'\s+', ' ', s)
    m = re.match(r'^([A-Za-z]+)[\s\-]*([0-9]+[A-Za-z]?)(.*)$', s)
    if m:
        return (m.group(1).upper() + '-' + m.group(2).upper() + m.group(3)).strip()
    return s


def law_of(form, category):
    # Derived from the form's own series, never from the law of a rule that
    # happens to mention it — MGT-4/5/6 are Companies Act forms even though a
    # PIT rule refers to them, and inferring the other way mislabels them.
    f = form.upper()
    # Whole words only: "Share Capital & Charges" contains the letters "pit",
    # which quietly filed four charge forms under the insider-trading rules.
    c = set(re.findall(r'[a-z]+', (category or '').lower()))
    if 'lodr' in c or f.startswith('LODR'):     return 'SEBI LODR 2015'
    if 'pit' in c or f.startswith('PIT'):       return 'SEBI PIT 2015'
    if f.startswith('IEPF'):                    return 'IEPF Rules 2016'
    if f.startswith('CRA'):                     return 'Companies (Cost Records & Audit) Rules 2014'
    if f.startswith('FC'):                      return 'Companies Act 2013 — Foreign Companies'
    if f.startswith('NDH'):                     return 'Nidhi Rules 2014'
    return 'Companies Act 2013'


def rows_of(path):
    """These files are sometimes a bare list, sometimes {meta, rules|events}."""
    d = json.load(io.open(path, encoding='utf-8'))
    if isinstance(d, list):
        return d
    for k in ('rules', 'events', 'obligations'):
        if isinstance(d.get(k), list):
            return d[k]
    raise SystemExit('cannot find rows in %s (keys: %s)' % (path, list(d)))


def collect_triggers():
    """For each form, the obligations in the owner's sheets that call for it."""
    out = defaultdict(list)
    for path in RULE_FILES:
        if not os.path.exists(path):
            print('   (skipped, missing: %s)' % path)
            continue
        for r in rows_of(path):
            blob = json.dumps(r, ensure_ascii=False)
            for grp in set(FORM_PAT.findall(blob)):
                key = grp[0].upper() + '-' + grp[1].upper()
                out[key].append({
                    'ruleId': r.get('id'),
                    'law': r.get('law'),
                    'ref': r.get('regulation') or r.get('section') or '',
                    'obligation': (r.get('title') or r.get('event') or '').strip(),
                    'timeline': (r.get('timelineText')
                                 or r.get('disclosureTimelineText') or '').strip(),
                    'frequency': r.get('frequency') or '',
                    'appliesTo': r.get('appliesTo') or {},
                    'appliesToText': r.get('appliesToText') or '',
                })
    return out


def main():
    if not os.path.exists(SEED):
        sys.exit('!! %s not found — run the extractor first' % SEED)
    seed = json.load(io.open(SEED, encoding='utf-8'))
    master, detail = seed.get('master', []), seed.get('detail', {})
    triggers = collect_triggers()

    detail_by_form = {norm_form(k): v for k, v in detail.items()}

    forms, withdrawn, dropped = [], [], []
    seen = set()

    def add(form, row, d):
        trg = triggers.get(form, [])
        note = WITHDRAWN.get(form)
        # The owner's own detail can also declare a form dead.
        if not note and str(d.get('status', '')).lower() in ('abolished', 'omitted', 'withdrawn'):
            note = d.get('notes') or 'No longer filed as a separate form.'

        rec = {
            'form': form,
            'kind': 'form',
            'aliases': ALIASES.get(form, []),
            'category': re.sub(r'^\d+\.\s*', '', row.get('category') or 'Other'),
            'law': law_of(form, row.get('category')),
            'referencedBy': sorted({t['law'] for t in trg if t.get('law')}),
            'type': (row.get('type') or d.get('type') or '').strip().rstrip(',').lstrip('>') or 'e-Form',
            # A form the rules call for but neither list describes still gets a
            # purpose — the obligation that calls for it, from the owner's own
            # sheet. Attributed via purposeFrom so it is never mistaken for the
            # official form description.
            'purpose': d.get('title') or row.get('desc')
                       or (trg[0]['obligation'] if trg else ''),
            'purposeFrom': ('official' if (d.get('title') or row.get('desc'))
                            else ('rule' if trg else '')),
            'description': row.get('desc') or '',
            'whenRequired': d.get('applies') or '',
            'timeline': d.get('timeline') or (trg[0]['timeline'] if trg else ''),
            'section': d.get('section') or (trg[0]['ref'] if trg else ''),
            'penalty': d.get('penalty') or '',
            'portal': d.get('portal') or '',
            'lastAmended': d.get('updated') or '',
            'filingStatus': d.get('status') or '',
            'linked': d.get('linked') or '',
            'notes': d.get('notes') or '',
            'steps': d.get('steps') or [],
            'triggers': trg,
        }
        # How well evidenced is this record? Shown in the UI verbatim, so that a
        # thin entry never looks as authoritative as a complete one.
        if d:
            rec['detailLevel'] = 'full'
        elif trg:
            rec['detailLevel'] = 'linked'
        else:
            rec['detailLevel'] = 'basic'

        if note:
            rec['status'] = 'withdrawn'
            rec['statusNote'] = note
            withdrawn.append(rec)
        else:
            rec['status'] = 'active'
            rec['statusNote'] = None
            forms.append(rec)

    for row in master:
        raw = row.get('form')
        if raw in JUNK:
            dropped.append((raw, 'not a form — spilled cell')); continue
        form = norm_form(raw)
        if form in seen:
            dropped.append((raw, 'duplicate of ' + form)); continue
        seen.add(form)
        row = dict(row)
        row.update(PATCH.get(form, {}))
        add(form, row, detail_by_form.get(form, {}))

    # Rich records that never made it into the thin list (MGT-7, MGT-7A, CSR-2 …).
    for form, d in sorted(detail_by_form.items()):
        if form in seen:
            continue
        seen.add(form)
        add(form, {'category': 'Other', 'type': 'e-Form', 'desc': ''}, d)

    # Forms the owner's rules call for that neither list carries at all.
    for form in sorted(triggers):
        if form in seen:
            continue
        seen.add(form)
        add(form, {'category': 'Other', 'type': 'e-Form', 'desc': ''}, {})

    # A form the owner listed as omitted but which never appeared in either
    # list still deserves a record — someone working from an old checklist will
    # search for it, and silence is the answer most likely to cause a mistake.
    for form, note in sorted(WITHDRAWN.items()):
        if form in seen:
            continue
        seen.add(form)
        withdrawn.append({
            'form': form, 'kind': 'form', 'aliases': ALIASES.get(form, []),
            'category': 'Other', 'law': law_of(form, ''), 'referencedBy': [],
            'type': 'e-Form', 'purpose': '', 'description': '', 'whenRequired': '',
            'timeline': '', 'section': '', 'penalty': '', 'portal': '',
            'lastAmended': '', 'filingStatus': '', 'linked': '', 'notes': '',
            'steps': [], 'triggers': [], 'detailLevel': 'basic',
            'status': 'withdrawn', 'statusNote': note,
        })

    # ── LODR and PIT ────────────────────────────────────────────────
    # Neither regime works through numbered forms the way the Companies Act
    # does; the obligation is to submit a prescribed disclosure under a named
    # regulation. Those belong in this register too, or the answer to "what do
    # I file for a listed company" is silently incomplete. Taken verbatim from
    # the owner's own sheets — nothing here is authored.
    filings = 0
    for path, keep, tag in (
        ('rules/lodr_periodic.json',
         lambda r: any(w in (r.get('submitTo') or '')
                       for w in ('Stock Exchange', 'Website')),
         'SEBI LODR 2015'),
        ('rules/pit_master.json',
         lambda r: (r.get('area') == 'Disclosures'
                    or str(r.get('regulation') or '').startswith('Reg. 7')),
         'SEBI PIT 2015'),
    ):
        if not os.path.exists(path):
            continue
        for r in rows_of(path):
            if not keep(r):
                continue
            ref = str(r.get('regulation') or '').strip()
            if not ref or ref in seen:
                continue
            seen.add(ref)
            filings += 1
            forms.append({
                'form': ref,
                'kind': 'filing',
                'aliases': [],
                'category': r.get('chapter') and ('Chapter ' + str(r['chapter'])) or \
                            r.get('area') or 'Disclosure',
                'law': tag,
                'referencedBy': [],
                'type': 'Disclosure / submission (not a numbered form)',
                'purpose': (r.get('title') or '').strip(),
                'description': (r.get('detail') or '').strip(),
                'whenRequired': (r.get('appliesToText') or '').strip(),
                'timeline': (r.get('timelineText') or '').strip(),
                'section': ref,
                'penalty': '',
                'portal': (r.get('submitTo') or '').strip(),
                'lastAmended': '',
                'filingStatus': '',
                'linked': '',
                'notes': (r.get('notes') or '').strip(),
                'steps': [],
                'triggers': [],
                'frequency': r.get('frequency') or '',
                'signedBy': r.get('signedBy') or r.get('owner') or '',
                'detailLevel': 'linked',
                'status': 'active',
                'statusNote': None,
                'ruleId': r.get('id'),
                'needsReview': bool(r.get('needsReview')),
            })

    forms.sort(key=lambda x: (x['law'], x['category'], x['form']))
    withdrawn.sort(key=lambda x: x['form'])

    io.open(OUT, 'w', encoding='utf-8').write(json.dumps({
        'meta': {
            'active': len(forms),
            'forms': sum(1 for f in forms if f['kind'] == 'form'),
            'filings': sum(1 for f in forms if f['kind'] == 'filing'),
            'withdrawn': len(withdrawn),
            'generated': 'rules/build_forms.py',
            'sources': ['index.html FORM_MASTER + FORMS'] + RULE_FILES,
        },
        'forms': forms,
        'withdrawn': withdrawn,
    }, ensure_ascii=False, indent=1))

    print('active forms   : %d' % len(forms))
    print('withdrawn      : %d  (%s)' % (len(withdrawn),
                                         ', '.join(w['form'] for w in withdrawn)))
    print('  detail level :', dict(Counter(f['detailLevel'] for f in forms)))
    print('  by law       :', dict(Counter(f['law'] for f in forms)))
    print('  with triggers: %d' % sum(1 for f in forms if f['triggers']))
    if dropped:
        print('  dropped      :', ', '.join('%s (%s)' % d for d in dropped))
    thin = [f['form'] for f in forms if f['detailLevel'] == 'basic']
    print('  name+description only (%d): %s' % (len(thin), ', '.join(thin)))


if __name__ == '__main__':
    main()
