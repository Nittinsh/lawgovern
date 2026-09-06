# Compliance regression suite

```bash
node tests/smoke.test.js        # structural integrity — fastest, run first
node tests/compliance.test.js   # 312 assertions — run before every deploy
node tests/mutation.js          # proves the suite can actually fail
python tools/rule_audit.py      # release gate: rules vs the held regulation texts
node tests/backend.test.js      # 94 checks against the live Supabase project (read-only)
```

Both run against `index.html` itself, not against a copy of the logic. A test
that exercises a reimplementation proves nothing about what deploys.

## Why these tests exist

Almost every assertion guards a bug that really happened here. Each carries the
CLAUDE.md section that explains it, so a failure points at the write-up rather
than leaving you to work out what the expected value was supposed to mean.

**A wrong date in a compliance register does not look wrong. It looks like a
date.** That is the whole argument for this suite. The 63 obligations that all
sat on 31 March 2027 were on screen for months; nobody could see them because a
plausible date is invisible.

| group | what it pins down |
|---|---|
| date arithmetic | month-end clamping, leap days, `toISOString` never touching a date |
| financial year | quarter ends land in the FY in progress, not the previous one |
| period end is not a deadline | derived rules carry no date; quarterly keeps four occurrences |
| stated offsets | the four `LG_DUE_PATCH` rules, and event-anchored rules staying undated |
| known statutory dates | AGM 30 Sep, AOC-4 30 Oct, MSME-1 31 Oct, and a December year end |
| registers | meetings, charges, allotments, beneficial interest → real deadlines |
| applicability | a private company gets no LODR or PIT; conditions are surfaced |
| thresholds | each Sec 135 limb at its boundary |
| citation parsing | `Reg 30`, `Section 129A`, `Sections 73-76A`, and prose with no citation |
| event matching | concept resolution, passive-voice 179(3)(g), the private-company exemption |
| status | no breach is ever claimed; no undated row escapes the no-date guard |
| dashboard invariants | both gauge legends sum to their own total |

## Time is frozen

Nearly every date here is computed relative to *now* — which FY is in progress,
which quarter, whether something is overdue. A suite asserting real dates
against a moving clock would rot within days.

`harness.js` pins it to **29 August 2026** (inside FY 2026-27). `new Date()`
returns that instant; parsing, arithmetic and formatting are otherwise the real
`Date`. To move it, change `FROZEN_NOW` — the expected values move with it.

## The mutation check

`mutation.js` reintroduces eight bugs that actually shipped here, runs the suite
against each broken build, and reports whether it noticed. `index.html` is never
modified; each mutant goes to a temp copy and the suite is pointed at it with
`LG_INDEX`.

It earned its place on the first run. The minutes-splitting test asserted only
*how many* decisions came back, and both the correct and the broken splitter
returned two on that input — so it passed against the bug. It now checks where
each item heading lands, which is what the bug actually got wrong.

**A missed mutation means the suite has a blind spot, not that the bug is
harmless.** Strengthen the assertion; don't delete the row.

## Adding a test

When you fix a compliance bug, add the case that would have caught it, and add
the mutation that reintroduces it. The second half matters: it is the only thing
that proves the first half works.
