# -*- coding: utf-8 -*-
"""Pull the amendment history out of the held texts, per provision.

    python tools/amendments.py            # write rules/amendments.json
    python tools/amendments.py --detail   # and print what was found

WHAT THIS IS FOR, AND WHAT IT IS NOT

Rule Governance (CLAUDE.md SS2s) says out loud that not one of the 327 rules is
tied to a published instrument, and that a rule nobody has read reads "Never
checked" rather than "current". That is honest and it is also a standing
worklist of 327 items that nobody is ever going to work through, because each
item means opening a 700 KB compilation and reading footnotes.

This does the reading. For every provision the corpus cites, it collects the
dated amendment footnotes the held text carries -- instrument, date, verb and
the footnote verbatim -- so verifying a rule becomes REVIEWING PREPARED
EVIDENCE rather than doing research.

It does NOT decide anything. It cannot:

  * A footnote is attributed to the provision whose span contains it, which is
    a position heuristic, not a reading. A footnote at a page foot can relate
    to text that began on the previous page.
  * "Reg 17 was amended on 2024-12-13" is not "Reg 17 came into force on
    2024-12-13". An obligation amended in 2024 still applied in 2023.
  * Whether the amendment changes the obligation the rule describes, or some
    neighbouring sub-clause, is exactly the judgement a Company Secretary is
    for.

So every record carries `basis: "positional"` and the quote, and the app
presents it as evidence beside the rule -- never as a verified date. The
absence of a check is not a pass (SS2d), and neither is a machine's guess at one.

WHY THE EXTRACTION IS SCOPED TO THE REGULATION BODY

A first cut scanned the whole LODR file for "a footnote marker sitting before a
provision number", which is the form a wholly-inserted provision takes
("634[91C. (1)"). It returned four candidates and two were wrong: paragraphs 17
and 18 of SCHEDULE III, because numbering restarts inside a schedule. Acting on
them would have dated Regulation 17 (composition of the board) and Regulation
18 (audit committee) to 2023, hiding both from any earlier year -- the SS2k
defect exactly, a date that looks like a date with nothing behind it.

Same trap as SS3f, where the one competing period in the master circular was
Reg 69(1)'s IDR holding pattern: the text contains numbers that are real,
current, and about something else.
"""
import io, json, re, sys, collections, datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
DETAIL = '--detail' in sys.argv
OUT = 'rules/amendments.json'

# ── the sources, and what each states about its own commencement ─
# The date is COMPUTED from the gazette date and the period the instrument
# itself states. Neither is remembered: both are quoted from the text, so if
# the compilation is replaced the arithmetic is redone rather than trusted.
SOURCES = [
    {'law': 'SEBI LODR 2015',
     'path': 'reference/sebi-lodr-2015/lodr.txt',
     'asOf': 'Amended up to July 14, 2026',
     'kind': 'reg', 'short': 'SEBI (LODR)',
     'gazette': '2015-09-02', 'afterDays': 90,
     'commenceWords': 'They shall come into force on the ninetieth day from the '
                      'date of their publication in the Official Gazette',
     # The proviso to Reg 1(2) brings two provisions in on the notification
     # date instead. Per-provision again, in the commencement clause itself.
     'provisos': {'23': 'sub-regulation (4) of regulation 23 came into force on '
                        'the date of notification, not the ninetieth day',
                  '31A': 'regulation 31A came into force on the date of '
                         'notification, not the ninetieth day'}},
    {'law': 'SEBI PIT Regulations 2015',
     'path': 'reference/sebi-pit-2015/sebi pit.txt',
     'asOf': 'Amended upto March 12, 2025',
     'kind': 'reg', 'short': 'SEBI (PIT)',
     'gazette': '2015-01-15', 'afterDays': 120,
     'commenceWords': 'These regulations shall come into force on the one '
                      'hundred and twentieth day from the date of its '
                      'publication in the Official Gazette',
     'provisos': {}},
    # The Act text is amended only to 01.04.2021 -- over five years stale
    # (SS2c). So its amendment history is complete only to that date, and
    # anything after it is simply absent rather than absent-and-flagged. Said
    # in the output so a reader of the review queue knows the floor.
    {'law': 'Companies Act 2013',
     'path': 'reference/companies-act-2013/'
             'Companies Act 2013 as amended upto 01.04.2021_.txt',
     'asOf': 'As amended upto 01.04.2021 - STALE by over five years',
     'kind': 'sec', 'short': 'Companies Act',
     'gazette': None, 'afterDays': None,
     'commenceWords': 'Sections were notified on various dates from 2013; the '
                      'held text does not state them per section',
     'provisos': {}},
]

CORPORA = [
    ('rules/lodr_periodic.json', 'rules',  'SEBI LODR 2015'),
    ('rules/lodr_events.json',   'events', 'SEBI LODR 2015'),
    ('rules/pit_master.json',    'rules',  'SEBI PIT Regulations 2015'),
    ('rules/ca_master.json',     'rules',  'Companies Act 2013'),
]

# ── footnote forms ──────────────────────────────────────────────
# SEBI: "72 Substituted by the ... w.e.f. 31.12.2024."
FN_SEBI = re.compile(r'^[ \t]*(\d{1,4})[ \t]+(Substituted|Inserted|Omitted|Renumbered)\b', re.M)
# Act:  "1. Ins. by Act 1 of 2018, s. 2 (w.e.f. 9-2-2018)."
FN_ACT = re.compile(r'^[ \t]*\d{1,3}\.[ \t]+(?:The [A-Za-z ]+ )?'
                    r'(Ins|Subs|Omitted)\.?\b', re.M | re.I)

VERB = {'ins': 'Inserted', 'subs': 'Substituted', 'omitted': 'Omitted',
        'inserted': 'Inserted', 'substituted': 'Substituted',
        'renumbered': 'Renumbered'}

# The extraction inserts spaces inside numbers -- "31 .12.2024", "9 -2-2018".
# The year is captured as exactly four digits with (?!\d) because a trailing
# ".NN" after the year is the NEXT footnote's number glued on, not the date.
# Numeric form, as LODR and the Act write it.
WEF = re.compile(r'w\.?\s*e\.?\s*f\.?\s*'
                 r'(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{4})(?!\d)', re.I)
# Month-name form, as PIT writes it: "(w.e.f. April 01, 2019)". Without this
# branch PIT yielded 2 dated footnotes out of 135 -- the corpus looked
# unamended when in fact the pattern simply could not read the date.
MONTHS = {'january':1,'february':2,'march':3,'april':4,'may':5,'june':6,'july':7,
          'august':8,'september':9,'october':10,'november':11,'december':12}
WEF_WORD = re.compile(r'w\.?\s*e\.?\s*f\.?\s*([A-Za-z]{3,9})\s*(\d{1,2})\s*,?\s*(\d{4})(?!\d)', re.I)

INSTR_SEBI = re.compile(r'\(([A-Za-z ]*?Amendment)\)\s*Regu\s*lations?,?\s*(\d{4})', re.I)
INSTR_ACT = re.compile(r'\bAct\s+(\d{1,3})\s+of\s+(\d{4})', re.I)


def parse_date(blob):
    m = WEF.search(blob)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = WEF_WORD.search(blob)
        if not m:
            return None
        mo = MONTHS.get(m.group(1).lower())
        if not mo:
            return None
        d, y = int(m.group(2)), int(m.group(3))
    if not (1 <= d <= 31 and 1 <= mo <= 12 and 2013 <= y <= 2027):
        return None
    try:
        return datetime.date(y, mo, d).isoformat()
    except ValueError:
        return None


def footnotes(raw, kind, short):
    """Every dated amendment footnote, with the position it sits at."""
    pat = FN_SEBI if kind == 'reg' else FN_ACT
    starts = [(m.start(), m.group(1) if kind == 'reg' else None,
               m.group(2) if kind == 'reg' else m.group(1)) for m in pat.finditer(raw)]
    out = []
    for i, (pos, num, verb) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else min(len(raw), pos + 1600)
        blob = raw[pos:end]
        date = parse_date(blob)
        if not date:
            continue
        if kind == 'reg':
            mi = INSTR_SEBI.search(blob)
            instr = ('%s %s Regulations, %s'
                     % (short, re.sub(r'\s+', ' ', mi.group(1)).strip(),
                        mi.group(2))) if mi else None
        else:
            mi = INSTR_ACT.search(blob)
            instr = ('Act %s of %s' % (mi.group(1), mi.group(2))) if mi else None
        quote = re.sub(r'\s+', ' ', blob).strip()
        # Enough to judge by, not the whole footnote: several run to hundreds of
        # words quoting the text as it stood before substitution.
        if len(quote) > 300:
            quote = quote[:300].rstrip() + ' ...'
        out.append({'pos': pos, 'num': num, 'verb': VERB.get(verb.lower(), verb),
                    'date': date, 'instrument': instr, 'quote': quote})
    return out


# A marker in the body: "72[The listed entity shall ...]"
MARKER = re.compile(r'(\d{1,4})\[')


def body_start(raw, kind):
    """Where the numbered provisions begin.

    The Act opens with an ARRANGEMENT OF SECTIONS table of contents listing
    every section in order, so first-occurrence positioning lands entirely
    inside the TOC: section 470's span then ran from the last TOC line to the
    end of the file and collected 267 amendment footnotes belonging to the
    whole Act. The enacting formula is where the body starts.
    """
    if kind != 'sec':
        return 0
    m = re.search(r'An Act to consolidate', raw, re.I)
    return m.start() if m else 0


def body_end(raw, kind):
    """Where the numbered provisions stop and the schedules begin.

    Numbering restarts inside a schedule, so a paragraph 17 there is not
    Regulation 17. Scanning past this point is what produced the two false
    positives recorded at the top of this file.
    """
    if kind != 'reg':
        return len(raw)
    m = re.search(r'SCHEDULE\s+I\b', raw)
    return m.start() if m else len(raw)


def provision_spans(raw, kind, start, end):
    """First position of each numbered provision, in order, within the body.

    Heading forms are the ones tools/rule_audit.py already had to learn: a
    footnote marker can sit between the number and the body ("91C. 634[(1)"),
    and in the Act it can sit before the number ("3[185. Loans to directors").
    """
    body = raw[start:end]
    if kind == 'reg':
        pats = [r'(?<![\d.])(\d{1,3}[A-Z]{0,2})\s*\.\s*(?:\d{1,4}\[)?\(1\)']
    else:
        pats = [r'(?:^|\s|\[)(\d{1,3}[A-Z]{0,2})\s*\.\s*[A-Z]']
    first = {}
    for pat in pats:
        for m in re.finditer(pat, body):
            p = m.group(1).upper()
            if p not in first:
                first[p] = start + m.start()
    order = sorted(first.items(), key=lambda x: x[1])
    spans = {}
    for i, (p, pos) in enumerate(order):
        spans[p] = (pos, order[i + 1][1] if i + 1 < len(order) else end)
    return spans


# The Act states its own commencement in footnote 1 to s.1(3), as 22 dated
# blocks each naming a notification. It is NOT parsed into per-section dates,
# and the reason is in the data itself: the last block reads
#
#     "21st December, 2020 - S. 1, 3, 6 to 10 (both inclusive), s. 12 to 17 ..."
#
# Sections 3 and 6 to 10 are incorporation provisions that commenced on
# 1 April 2014. Those numbers are sections of the Companies (Amendment) Act
# 2020, not of the Companies Act 2013 -- the footnote mixes commencement of the
# principal Act with commencement of later amending Acts and does not say
# which is which. Reading all 22 blocks as principal-Act commencement would
# record that incorporation came into force in December 2020 and hide it from
# every earlier year.
#
# So the block text is carried verbatim as evidence for a person to read, with
# the hazard stated. Reported, not silently repaired (SS3j).
COMMENCE_BLOCK = re.compile(
    r'(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|'
    r'August|September|October|November|December),?\s*(\d{4})\s*'
    r'[\u2013\u2014\-\u2212]')


def commencement_evidence(raw):
    m = re.search(r'\*1\.\s*12th September, 2013', raw)
    if not m:
        return None
    blob = raw[m.start():m.start() + 14000]
    stop = blob.find('*. Vide Notification')
    if stop > 0:
        blob = blob[:stop]
    hits = list(COMMENCE_BLOCK.finditer(blob))
    out = []
    for i, h in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(blob)
        txt = re.sub(r'\s+', ' ', blob[h.start():end]).strip()
        out.append({'date': '%s %s %s' % (h.group(1), h.group(2), h.group(3)),
                    'text': txt[:600] + (' ...' if len(txt) > 600 else '')})
    return {
        'blocks': out,
        'warning': 'These 22 blocks mix commencement of the Companies Act 2013 '
                   'with commencement of later amending Acts, and the footnote '
                   'does not say which. The 21 December 2020 block names '
                   '"S. 1, 3, 6 to 10" -- incorporation provisions that '
                   'commenced on 1 April 2014 -- so those are sections of the '
                   'Companies (Amendment) Act 2020. Each block must be read '
                   'against its own notification before any date is relied on.',
    }


def cited(s, kind):
    s = str(s or '')
    out = []
    if kind == 'reg':
        for m in re.finditer(r'\bReg(?:ulation)?s?\.?\s*(\d{1,3}[A-Z]{0,2})(?![A-Za-z0-9])', s, re.I):
            out.append(m.group(1).upper())
    else:
        for m in re.finditer(r'\bSec(?:tion)?s?\.?\s*([\d\s,\-]+[A-Z]{0,2})', s, re.I):
            for n in re.finditer(r'(\d{1,3}[A-Z]{0,2})', m.group(1)):
                out.append(n.group(1).upper())
    return out


# ── build ───────────────────────────────────────────────────────
result = {'generated': datetime.date.today().isoformat(), 'laws': {}}
counts = collections.Counter()

for src in SOURCES:
    try:
        raw = io.open(src['path'], encoding='utf-8', errors='replace').read()
    except Exception as e:
        print('%-28s COULD NOT READ: %s' % (src['law'], e))
        continue

    kind = src['kind']
    start = body_start(raw, kind)
    end = body_end(raw, kind)
    spans = provision_spans(raw, kind, start, end)
    notes = [n for n in footnotes(raw, kind, src['short']) if n['pos'] >= start]

    commenced = None
    if src['gazette'] and src['afterDays']:
        g = datetime.date(*map(int, src['gazette'].split('-')))
        commenced = (g + datetime.timedelta(days=src['afterDays'])).isoformat()

    per = collections.defaultdict(list)
    unattributed = 0

    if kind == 'reg':
        # By marker. Exact, provided the numbers are unique document-wide --
        # which is checked, not assumed.
        byNum, dupes = {}, set()
        for n in notes:
            if n['num'] in byNum:
                dupes.add(n['num'])
            byNum[n['num']] = n
        if dupes:
            print('    WARNING: %d footnote number(s) repeat in %s, so a marker '
                  'cannot identify one footnote. Falling back to position.'
                  % (len(dupes), src['law']))
        if dupes:
            kind_attr = 'positional'
        else:
            kind_attr = 'marker'
    else:
        kind_attr = 'positional'

    if kind_attr == 'marker':
        seen = set()
        for p, (a, b) in spans.items():
            for m in MARKER.finditer(raw[a:b]):
                n = byNum.get(m.group(1))
                if not n:
                    continue
                key = (p, n['num'])
                if key in seen:
                    continue
                seen.add(key)
                per[p].append({k: n[k] for k in ('verb', 'date', 'instrument', 'quote')})
        unattributed = max(0, len(notes) - len(set(k[1] for k in seen)))
    else:
        for n in notes:
            hit = None
            for p, (a, b) in spans.items():
                if a <= n['pos'] < b:
                    hit = p
                    break
            if hit is None:
                unattributed += 1
                continue
            per[hit].append({k: n[k] for k in ('verb', 'date', 'instrument', 'quote')})

    for p in per:
        per[p].sort(key=lambda x: x['date'])

    result['laws'][src['law']] = {
        'source': src['path'],
        'asOf': src['asOf'],
        'commenced': commenced,
        'commenceWords': src['commenceWords'],
        'gazette': src['gazette'],
        'afterDays': src['afterDays'],
        'provisos': src['provisos'],
        'basis': kind_attr,
        'commencementEvidence': commencement_evidence(raw) if kind == 'sec' else None,
        'provisions': {p: {'events': v} for p, v in per.items()},
    }

    print('%-28s %s' % (src['law'], src['asOf']))
    print('    commenced            %s%s' % (
        commenced or 'not stated per provision in the held text',
        ('   (gazette %s + %d days)' % (src['gazette'], src['afterDays'])) if commenced else ''))
    print('    provisions located   %d' % len(spans))
    print('    dated footnotes      %d  (%d not reached, attributed by %s)'
          % (len(notes), unattributed, kind_attr))
    print('    provisions with one  %d' % len(per))
    counts['footnotes'] += len(notes)
    counts['unattributed'] += unattributed

# ── coverage against the corpus that will consume it ────────────
print()
covered = missing = 0
gaps = collections.Counter()
for path, key, law in CORPORA:
    try:
        data = json.load(io.open(path, encoding='utf-8'))
    except Exception:
        continue
    L = result['laws'].get(law)
    if not L:
        continue
    kind = 'sec' if law == 'Companies Act 2013' else 'reg'
    for r in data.get(key, []):
        ps = cited(r.get('regulation') or '', kind)
        if not ps:
            continue
        if any(p in L['provisions'] for p in ps):
            covered += 1
        else:
            missing += 1
            gaps[law] += 1

print('rules whose cited provision has amendment evidence: %d' % covered)
print('rules with none found:                              %d  %s'
      % (missing, dict(gaps)))

io.open(OUT, 'w', encoding='utf-8').write(
    json.dumps(result, indent=1, ensure_ascii=False, sort_keys=True))
print('\nwrote %s  (%d KB)' % (OUT, len(io.open(OUT, encoding='utf-8').read()) // 1024))

if DETAIL:
    print()
    for law, L in sorted(result['laws'].items()):
        print('=== %s ===' % law)
        for p, v in sorted(L['provisions'].items(),
                           key=lambda x: -len(x[1]['events']))[:12]:
            ds = [e['date'] for e in v['events']]
            print('  %-6s %2d events  %s .. %s' % (p, len(ds), ds[0], ds[-1]))


# ── the compact form the app embeds ─────────────────────────────
# rules/amendments.json is 376 KB and holds every footnote in full. The app
# needs only what a reviewer reads at a glance, for the provisions the corpus
# actually cites: how many amendments, the span, the instruments, and the most
# recent few verbatim. The full file stays on disk for anyone going deeper.
EMBED = 'rules/amendments_embed.json'
KEEP = 3

wanted = collections.defaultdict(set)
for path, key, law in CORPORA:
    try:
        data = json.load(io.open(path, encoding='utf-8'))
    except Exception:
        continue
    kind = 'sec' if law == 'Companies Act 2013' else 'reg'
    for r in data.get(key, []):
        for p in cited(r.get('regulation') or '', kind):
            wanted[law].add(p)

compact = {'generated': result['generated'], 'laws': {}}
for law, L in result['laws'].items():
    provs = {}
    for p in sorted(wanted.get(law, ())):
        ev = (L['provisions'].get(p) or {}).get('events') or []
        if not ev:
            continue
        instr = []
        for e in ev:
            if e['instrument'] and e['instrument'] not in instr:
                instr.append(e['instrument'])
        provs[p] = {
            'n': len(ev),
            'first': ev[0]['date'],
            'last': ev[-1]['date'],
            # NOT "this obligation was omitted". An Omitted footnote inside
            # Regulation 30's span means some sub-clause of Reg 30 was omitted;
            # Reg 30 itself is very much alive. Surfacing it as a warning
            # flagged 102 rules including the whole of Schedule III -- a check
            # that cries wolf gets ignored (SS2x). Kept as part of the evidence,
            # named so it cannot be read as a verdict.
            'hasOmissionNote': any(e['verb'] == 'Omitted' for e in ev),
            'instruments': instr[-4:],
            'recent': [{'date': e['date'], 'verb': e['verb'],
                        'instrument': e['instrument'],
                        'quote': (e['quote'][:190] + ' ...')
                                 if len(e['quote']) > 190 else e['quote']}
                       for e in ev[-KEEP:]],
        }
    compact['laws'][law] = {
        'asOf': L['asOf'], 'commenced': L['commenced'],
        'commenceWords': L['commenceWords'], 'gazette': L['gazette'],
        'afterDays': L['afterDays'], 'provisos': L['provisos'],
        'basis': L['basis'],
        'commencementWarning': (L['commencementEvidence'] or {}).get('warning')
                               if L.get('commencementEvidence') else None,
        'provisions': provs,
    }

io.open(EMBED, 'w', encoding='utf-8').write(
    json.dumps(compact, ensure_ascii=False, sort_keys=True, separators=(',', ':')))
size = len(io.open(EMBED, encoding='utf-8').read())
print('wrote %s  (%d KB, %d provisions)'
      % (EMBED, size // 1024,
         sum(len(v['provisions']) for v in compact['laws'].values())))


# ── put it in the app ───────────────────────────────────────────
# The embed lives inside index.html as `var LG_AMEND = {...};`. Rewriting it
# here means one command regenerates and ships the evidence: a generated file
# that has to be pasted by hand goes stale the first time somebody forgets.
APP = 'index.html'
try:
    html = io.open(APP, encoding='utf-8', newline='').read()
except Exception as e:
    print('\ncould not read %s (%s) -- embed not updated' % (APP, e))
    sys.exit(0)

OPEN, CLOSE = 'var LG_AMEND = ', ';\n'
i = html.find(OPEN)
if i < 0:
    print('\n%s does not contain "var LG_AMEND = " -- embed not updated' % APP)
    sys.exit(1)
j = html.find(CLOSE, i)
if j < 0:
    print('\ncould not find the end of the LG_AMEND statement -- embed not updated')
    sys.exit(1)

payload = io.open(EMBED, encoding='utf-8').read().strip()
new = html[:i] + OPEN + payload + html[j:]
if new == html:
    print('\nembed in %s already current' % APP)
else:
    io.open(APP, 'w', encoding='utf-8', newline='').write(new)
    print('\nupdated the embed in %s (%d -> %d chars)' % (APP, len(html), len(new)))
