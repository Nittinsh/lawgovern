# CLAUDE.md — LawGovern Project Handoff

> This file gives Claude Code everything it needs to work on LawGovern. Read it fully before touching code.

---

## 1. WHAT THIS IS

**LawGovern** is an AI-powered corporate-compliance web app for India — a "Compliance Operating System" for Company Secretaries (CS), CAs, CFOs, and compliance teams. Built and used by **Nittin Sharma**, a practising CS in India managing 30+ client companies.

- **Live site:** https://nittinsh.github.io/lawgovern
- **GitHub repo:** https://github.com/nittinsh/lawgovern (the app is a single file uploaded as `index.html`)
- **Owner login:** lawgovernsolutions@gmail.com
- **The whole app is ONE self-contained HTML file** (~1.56 MB) — all CSS and JS inline. This is deliberate (simple GitHub Pages deploy) but makes it large and hard to edit safely.

### Product concept
"Know what applies. Know what's due. Know what changed. Know what to do. Prove it was done."
An intelligent compliance platform: determine applicable laws per company, track statutory deadlines, draft documents, generate resolutions, monitor regulatory changes, keep an audit trail. Covers Companies Act 2013, SEBI (LODR/PIT/ICDR/SAST), FEMA, IBC, IEPF, etc.

---

## 2. RESOLVED — THE THREE-IDENTICAL-TABS BUG (fixed, v8)

**Status: FIXED.** Root cause found and corrected. Kept here because the diagnosis is the useful part.

**Symptom as reported:** after login, Command Center (`p-home`), Compliance Universe (`p-universe`) and My Work (`p-mywork`) all showed the same content.

**Actual root cause — nothing to do with panels or `sw()`.**
`updateMode()` did this, with no null guard:
```js
var b = document.getElementById('modebadge');
b.textContent = '● AI Active';   // #modebadge no longer exists
```
`#modebadge` was deleted during the Command Center theme redesign (replaced by `#modeind`), but the reference survived. So `updateMode()` threw `TypeError: Cannot set properties of null` on **every login**.

`enterApp()` called it *unguarded*, so the throw aborted the rest of the function:
```js
if(typeof updateMode === 'function') updateMode();          // ← threw here
if(typeof renderCommandCenter === 'function') ...            // never ran
if(typeof loadCloudClients === 'function'){ ... }            // never ran → CLIENTS stayed []
```
With `CLIENTS` empty, all three modules fell through to their empty states — which use the same `.cc-empty` component (icon + heading + blurb + "+ Add a company"). Three near-identical screens. The panels and `sw()` were correct the whole time.

**Why chat-based debugging never caught it:** the isolated tests set `CLIENTS` directly and called `sw()`, bypassing `enterApp()` entirely — so `updateMode()` never ran and the crash never happened.

**The fix (v8):**
1. Null-guard `b` in `updateMode()`.
2. Wrap the `updateMode()` call in `enterApp()` in try/catch — a cosmetic header refresh must never abort data loading.
3. Removed the v7 diagnostic markers ("◆ DASHBOARD", "▦ TABLE", "✓ TASKS"); bumped header to v8.

**Verified locally** (`python -m http.server 8000`): `enterApp()` no longer throws, `loadCloudClients()` runs, and the three tabs render structurally distinct output — Command Center 5 metric cards + gauge + 0 tables, Universe 1 table / 28 rows, My Work 124 task-card nodes / 0 tables.

**Lesson worth keeping:** never let a cosmetic DOM update sit unguarded on a critical startup path. A scan for the same pattern (`getElementById('x').prop = ...` where `x` is absent from the markup) found 7 more ids — `add-client-form`, `cl-name`, `cl-cin`, `akerr`, `akinput`, `gemini-key-input`, `gemini-key-status` — but all are in dead/orphaned code with no live call sites. Worth cleaning up (see the dead-code task).

## 2b. RESOLVED — DUE-DATE AND THRESHOLD DEFECTS (fixed, v9)

Three defects in `getComplianceChart()`, all invisible on screen because a wrong date still
looks like a date. Found 22 Aug 2026 while planning the rules-as-data split.

1. **`fyend` parsed as `MM-DD` but stored as `YYYY-MM-DD`.** `split('-')[0]` returned the year,
   so AGM/AOC-4/MGT-7/ADT-1/MR-3 all computed to ~2195. They never went overdue, never appeared
   in Due Soon, and vanished from every My Work bucket. Now tolerates both formats.
2. **`toISOString()` shifted every date back one day.** IST is UTC+5:30, so 30 Sep was emitted
   as 29 Sep. Dates are now formatted from local parts, never round-tripped through UTC.
3. **Applicability thresholds were 10x low**, and Sec 204 ignored the public-company restriction.
   Corrected against Sec 204 r/w Rule 9 and Sec 135 (confirmed by the owner, a practising CS):
   - MR-3: listed; OR **public** with paid-up capital >= Rs 50 cr or turnover >= Rs 250 cr;
     OR any company with borrowings from banks/PFIs >= Rs 100 cr.
   - CSR: net worth >= Rs 500 cr, turnover >= Rs 1000 cr, or net profit >= Rs 5 cr.

Verified with 15 assertions (31 Mar and 31 Dec year-ends, legacy `MM-DD`, each threshold at and
just below its boundary, private-company exclusion, borrowings limb).

### OPEN — CSR currently under-reports
`networth`, `netprofit` and `borrowings` are **not columns on `companies`**. The code reads them
if present and defaults to 0, so today only the CSR turnover limb (>= Rs 1000 cr) can fire. The
**net profit >= Rs 5 cr** limb is the one most likely to catch real clients, and it cannot be
evaluated until that column exists. Adding these three columns is the next data-model change.

### Note — dead twin
`getDeadlines()` (~line 3297) carries identical date and threshold bugs but is only reachable from
`askAboutClient()`, which has no call sites. Left alone; slated for the dead-code cleanup.

---

## 2c. ENTITIES MODULE + FINANCIAL COLUMNS (v10)

**Why:** Sec 135 (CSR) and Sec 204 r/w Rule 9 have limbs that cannot be evaluated from
`capital`/`turnover` alone. Net profit >= Rs 5 cr is the limb most likely to catch a real client,
and it was silently unevaluable.

**Added:** `networth`, `netprofit`, `borrowings` on `companies`, plus a real Entities panel
(`p-entities` -> `renderEntities`) — the first working company create/edit UI in the app.
Previously `showAddClient`/`saveClient` were orphaned and scavenged the Checklist Generator's
`cl-*` inputs. The "+ Add a company" empty-state buttons now call `entOpen()` instead of
`sw('cl')`, which used to dump you in the checklist generator.

### UNITS — the trap
The Checklist Generator's inputs are labelled **Rs. Crore**; `getComplianceChart` compares
**rupees**. Two conventions in one app. Settled as:
- **Storage: RUPEES** (matches how the statute states thresholds)
- **UI: CRORE** (`entToCrore` / `entToRupees` convert at the boundary)

`saveClient()` used to read the crore-denominated `cl-capital` and store it raw, so any company
created through it holds crore values and **no threshold would ever fire**.

### DB SCRIPTS — run in order, in the Supabase SQL editor
1. `db/000_audit_units.sql` — READ-ONLY. Shows whether stored capital/turnover are rupees or
   crore, and what `fyend` actually contains. **Run this first.**
2. `db/001_add_financial_columns.sql` — adds the three columns. Idempotent, no data change.
3. `db/002_normalise_units_IF_NEEDED.sql` — ONLY if step 1 showed crore. Dry run first; the
   UPDATE is commented out deliberately. Take a backup before uncommenting.

Until step 2 runs, `entSave()` fails with a "column does not exist" error and says so explicitly.

### Still open
- Blank net worth / net profit means the limb is **skipped, not passed**. Entities with missing
  figures show an amber warning in the list. CSR stays under-determined for those rows.
- Sec 135(1) applicability is measured "during **the immediately preceding financial year**"
  (verified against the bare act), so a single `netprofit` field is the correct model for
  applicability. Confirmed verbatim: net worth Rs 500 cr / turnover Rs 1000 cr / net profit Rs 5 cr.
- Sec 204(1) in the Act only says "every listed company and a company belonging to other class of
  companies **as may be prescribed**" — the Rs 50 cr / Rs 250 cr / Rs 100 cr figures live in Rule 9
  of the Companies (Appointment and Remuneration of Managerial Personnel) Rules, 2014, which is NOT
  in the PDF supplied. Those thresholds currently rest on the owner's confirmation, not on a text
  we hold. Worth adding the Rules PDF to `reference/`.
- **The Companies Act PDF is "as amended upto 01.04.2021" — over five years stale.** Any threshold
  or timeline verified from it must be re-checked against a current compilation before relying on it.
- ~~The CSR *spend* calculation (2% of average net profit over three preceding FYs) is not modelled
  at all — only applicability is.~~ **Built in v163**, see section 2y. The Explanation to s.135 fixes
  the basis as s.198, so the net-profit calculator feeds it directly.

---

## 2d. EVIDENCE ENGINE — no status without a basis (v13)

**The problem it fixes.** The dashboard asserted things it had never checked. For a listed
entity with zero filing data it reported *"Breach 29%"* and *"84d overdue"* on Reg 24A — a written
accusation of non-compliance against a client that had almost certainly filed. The mirror-image
bug was worse-hidden: `ccComputeStats` counted anything due >30 days out as **compliant**, so the
health score was inflated by obligations nobody had done.

**The rule now:** the system may only claim `compliant` when evidence exists. It may never claim
`breach` at all, because no filing source is connected.

### Eight states (`LG_STATE`)
`NOT_APPLICABLE` · `FILED` · `FILED_LATE` · `MANUALLY_VERIFIED` · `UPCOMING` · `DUE_SOON` ·
`DUE_TODAY` · `NO_EVIDENCE` · `DATA_UNAVAILABLE` · `MANUAL_REQUIRED`

Each carries `asserts: 'compliant' | 'none'`. Only the first four ever claim compliance, and only
when the user has recorded a filing date or reference.

`lgResolveStatus(row, company)` is the single place status is decided. Key behaviours:
- Past due + no evidence + **no source connected** -> `DATA_UNAVAILABLE`, not "overdue".
- Not yet due -> `UPCOMING`, never counted as compliant.
- Evidence with a filing date -> `FILED` or `FILED_LATE` (compares filing date to due date).
- The automated conclusion is retained in `autoState` even when the user overrides it.

### Gauge is COVERAGE, not health
`stats.health` = share of applicable obligations with evidence on record. Labels deliberately
describe the evidence, never the company: "No Evidence Recorded" at 0, up to "Well Evidenced".
`stats.breach` is hardcoded to 0.

### UI
- "Why?" link on every attention row -> `lgWhy()` panel: legal basis, due-date calculation,
  filing evidence, and a **sources-checked table** stating plainly that nothing is connected and why.
- `lgRecordOpen/Save/Clear` — record a filing date + SRN. A reference raises confidence to `high`.
- `db/003_evidence_trail.sql` adds `filing_ref`, `evidence_note`, `evidence_source`, `verified_by`,
  `verified_at` plus the unique index `lgPersist()` upserts on. Code tolerates their absence.

### Deliberately NOT built (blocked, not forgotten)
Live MCA/SEBI/NSE/BSE connectors (spec sections 2, 6, 9, 20). MCA filing documents are paid;
NSE/BSE publish no official API. `LG_SOURCES` models them as `connected:false` with the reason,
so the UI degrades honestly. Wiring a real source = flip `connected` and populate evidence.

---

## 2e. EVIDENCE INTEGRITY — documents + maker-checker (v21)

**The question this answers:** what stops a clerk typing a plausible SRN to close out a red item?
Honest ceiling: nothing can *prove* a reference is genuine without a live MCA/exchange feed. What
these controls do is block the realistic shortcuts and make everything attributable.

### Hard blocks (`lgValidateEvidence`)
- **Duplicate reference** across ALL companies and obligations. Normalised, so `AA1234567` and
  `AA-123-4567` collide. This is the single strongest free control.
- Filing date in the future.
- Filing date before incorporation (year comes from the CIN).
- Nothing entered at all.

### Warnings (allowed, flagged)
Placeholder text (`NA`, `TEST`, `XXXX`), reference with no digits, filed long before the period
ended, filed after the due date (recorded as `FILED_LATE`).

Format checks WARN rather than block on purpose: MCA SRNs and BSE/NSE acknowledgement numbers
have different shapes, and rejecting a valid reference we do not recognise is worse than the problem.

The filing register validates **every row together before writing anything**, including duplicates
entered on the same screen, and highlights offending rows. A half-saved register is worse than none.

### Maker-checker
Recording and confirming are separate acts by different people.
- Recording sets `recorded_by` / `recorded_at`, `check_state='unchecked'` -> state `AWAITING_CHECK`,
  which **asserts nothing** and is NOT counted in "Filed".
- A different user confirms -> `check_state='verified'`, sets `verified_by` -> `FILED` / `FILED_LATE`.
- `lgCanCheck()` refuses when maker == checker; `db/005` also enforces it with a CHECK constraint,
  so the UI is not the only guard.
- Rejection sets `CHECK_REJECTED` with a reason, returning it to the maker.

### Evidence documents
Private Supabase Storage bucket `evidence`, path `<company_id>/<compliance_key>/<ts>_<name>`.
RLS derives ownership from the folder via the companies table. PDF/PNG/JPEG/WebP, 10 MB cap.
Links are short-lived signed URLs (300s) — the bucket is never public.

### Confidence
`high` = document + reference · `medium` = one of them · `low` = date only.

### Migration
`db/005_maker_checker_and_documents.sql` — columns, the maker<>checker CHECK constraint, the
storage bucket and its three policies. Idempotent. Until it runs, uploads fail with a message
naming the file.

---

## 2f. EVENT -> COMPLIANCE IMPACT (v126, Phase 2 item 11)

**What it answers.** Something happened at a company; several obligations follow from it across
different laws. The register already contained the answer and had no way of being asked. Describe
the event in plain words and it returns the disclosures, obligations and forms that follow.

Panel `p-impact` -> `renderImpact()` -> `#imp-root`. Nav item "Event Impact" under Intelligence.

### Nothing is generated
Three corpora, all the owner's own data:
- **125 LODR Schedule III events** (`LODR_EVENT_DATA`) — listed entities only. A private company
  is not shown LODR disclosures at all, because for it they are not obligations.
- **The entity's own obligations** (`getComplianceChart(c)`).
- **155 forms** (`FORMS_MASTER`) — purpose, whenRequired, description.

Every row that appears is a real record and opens. A disclosure row calls `mevLogOpen(id)` with
that event preselected, so assess -> log -> Reg 30 clock is one click.

### Why it is concept matching and not keyword matching
The first cut compared the words in the description to the words in each record. It failed in both
directions at once:
- *"board approved borrowing of Rs 50 crore"* returned **nothing**. The register never says
  "borrowing" — it says loans, debentures, charge, security. 19 LODR events and 5 forms were
  sitting there unreachable.
- *"a director resigned"* returned **31 rows headed by "FRAUD OR DEFAULTS by the listed entity,
  its promoter, director..."**, matched on the word "director".

So `IMP_CONCEPTS` holds ~31 concepts, each with **two** regexes: `say` (what a CS types) and
`find` (what the register actually says). They are deliberately different vocabularies.

`kind` splits **action** (what happened) from **subject** (what it happened to). **Where the
description contains an action, a record must share that action to appear at all.** That single
rule is what removes the fraud row from a resignation search while keeping every genuine one.

### The rules that were learned by running it, not by reasoning about it
- **Disqualification is not resignation.** Folding `disqualif` into resignation put DIR-10
  ("remove a disqualified director") at the top of a resignation. Now its own concept.
- **"Board approved X" is a description of X, not of a meeting.** Framing phrases pulled every
  board-meeting row above the actual event. `meeting.say` no longer matches them.
- **Bare `securities` matched 21 unrelated LODR events**; bare `order` matched "Specified
  Companies Order as amended", putting MSME-1 top of a SEBI penalty order. Both narrowed.
- **A record can share a word and be about something else.** Records expressing actions the
  description never raised are ranked down, and dropped when they are mostly about those. The
  threshold **scales with how much matched** — a raw count punished long Schedule III entries,
  which dropped "Acquisition(s) (including agreement to acquire)" from an acquisition search,
  the one row that search exists to find.
- **The confidence chip read "related" on every row** for one release: `impMatch` computed
  `actions`/`subjects` and the pushed result objects never copied them. A label identical on
  every row looks like a judgement and is not one.

### Honesty controls
- Each row shows **which concepts put it there** (`matched on ...`). A match the reader cannot
  check is just an assertion.
- Confidence describes **the match, not the law**: `close` (action + subject) / `possible`
  (action only) / `related`.
- **The footer names the corpus and its depth**, e.g. `SEBI LODR 2015 (309) · Companies Act 2013
  (147) · ... · FEMA / RBI (1)`.
- **`IMP_THIN`** warns *above* the results when the description engages something the register
  barely holds. FEMA has **one** obligation, and the brief for this feature expects FEMA
  consequences — so an empty section would read as "checked, nothing required" when the truth is
  "not covered, look elsewhere". Same rule as the evidence engine: no conclusion without a basis.
- Truncation at 15 says so ("Showing the 15 closest of N"). A silently cut list reads as complete.

### Known limits
- FEMA/RBI is one obligation and IBC/IBBI is unmodelled — both are flagged, not fixed. Fixing them
  means adding those rule sets to `rules/`, not touching this engine.
- Concepts are hand-written. A transaction nobody has described before will not resolve, and the
  screen says so rather than guessing ("Could not tell what kind of event that is").
- No AI call is made. This is deliberate: the user's spec excludes a generic chatbot, and every
  consequence has to trace to a record.

---

## 2g. COMPLIANCE IMPACT FROM BOARD MINUTES (v128, Phase 2 item 12)

Second mode on the Event Impact screen (`IMP_MODE`, tabs "An event" / "Board minutes"). Paste the
minutes; each decision is read on its own through the same concept engine as item 11, plus an
MGT-14 test that item 11 does not do.

### The MGT-14 matrix is now real data
The register's row `CA-SECTION-117-AND-APPLICABLE-EXEMPTIONS-33` ("MGT-14 filing matrix") has
`trigger: "Depends on resolution and company-class exemptions"` — it flags the question and does
not answer it. So the matrix was extracted from the Act text in `reference/`:
- **`MGT14_179_3`** — section 179(3)(a)–(k), the powers exercisable only by board resolution.
- **`MGT14_117_3`** — section 117(3)(a)–(g), the resolutions that must be filed.

Each limb carries its own statutory words, so a hit **cites the clause** and can be checked against
the bare act. `mgt14Assess(text, company)` returns the hits or null.

### What it refuses to decide
- **Private companies are exempted from 117(3)(g)** by an MCA exemption notification that is NOT in
  `reference/`. Applying it would be guessing; ignoring it would flag every private company's
  borrowing resolution. So the limb matches and the UI says the exemption must be checked. Note the
  exemption covers only the **179(3) route** — a private company passing a *special* resolution
  still files under 117(3)(a), and the code distinguishes these.
- **The proviso to 117(3)(g)** excludes loans/guarantees/security given in the ordinary course of
  business. Whether this one was is a fact about the company, so `ordinaryCourse:true` on
  179(3)(f) raises the question rather than answering it.
- **The Act text is amended only to 01.04.2021** — over five years stale. Stated on screen.
- **Rule 8 of the Companies (Meetings of Board) Rules 2014** adds further 179(3)(k) matters that
  are not held. `prescribed:true` marks the limb as present-but-unpopulated.

### Splitting minutes — the bug worth remembering
The first cut split before the *line* containing "RESOLVED THAT". That stranded each ITEM heading
as its own decision AND handed the next item's heading to the previous resolution — so
"ITEM NO. 2 — BORROWING" attached to the financial-statements resolution, which was then reported
as needing MGT-14 under **179(3)(d), to borrow monies**. A filing flagged against the wrong
resolution is the one failure this feature cannot have.

Now: where **ITEM headings** exist they are the decision boundary (the author already divided the
document); otherwise split before `RESOLVED THAT` itself — **never** before `RESOLVED FURTHER
THAT`, which continues the resolution above it.

### And the limbs must match the passive voice
Minutes say "the financial statements ... be and are hereby approved", not "approve the financial
statements". Matching only the section's word order meant **179(3)(g) never fired on an approval of
accounts** — close to the commonest board resolution there is. 179(3)(c) and (g) now match both
orders.

---

## 2h. REGULATORY CHANGE IMPACT (v131, Phase 2 items 13 + 18)

The radar fetched circulars and asked a model for generic action points. The owner's brief lists
**"news feed without entity-level impact analysis"** among the things he explicitly does not want,
and that is exactly what it was. Every circular now says which of his entities it reaches and which
of their obligations it touches — from the register, not from a model.

`trkImpact(item, sourceKey)` → `trkItemCard()`, used by **both** render paths (`renderCirculars`
and the AI-summary path), so the two cannot drift apart.

### Three filters, cheapest first
1. **Regime** (`TRK_REGIME`) — a SEBI circular is matched against SEBI obligations, an MCA
   notification against the Companies Act. Matching across would produce confident nonsense.
2. **Entity type** — `listedOnly:true` on the SEBI sources. A listing regulation cannot reach a
   private company, and on a book of 30 companies with 3 listed this answers most items alone.
3. **Subject** — citation first, concepts second.

### Citation matching beats concept matching, and it was sitting in plain sight
A circular names the provision it amends; the register records the provision each obligation comes
from (`Reg 30`, `Reg. 2(1)(n)`, `Section 184(1)`, `Sections 12, 15`). `trkParseCites()` parses both
sides into reg/section/rule numbers and intersects them. **Where a circular cites something, that
decides it and the concepts are not consulted.**

"Amendments to Regulation 30 of LODR" — the most consequential kind of SEBI circular a listed
client gets — resolved to *no concept at all* and returned nothing. By citation it finds exactly
the **14 rows that cite Reg 30**.

**The bug worth remembering:** the suffix pattern was `(\d+\s*[A-Z]?)` under the `i` flag. `[A-Z]`
matches lowercase when case-insensitive, and `\s*` let it cross the space — so "Regulation 30 **of**
LODR" parsed as reg `30O` and "Section 117 **and** Rule 24" as section `117A`. *Every citation
followed by an ordinary English word was corrupted.* Fixed with the suffix glued to the digits plus
`(?![A-Za-z])`. Verified: `129A`, `73-76A`, `Reg. 2(1)(n)`, `Section 117 and Rule 24` all parse.

### Refusing to answer
- `TRK_TOO_BROAD = 15` — "SEBI Board Meeting outcome" (a press release about SEBI's own board)
  matched **41 obligations** via the words "meeting" and "approved". 41 matches is not a finding;
  it means the headline was generic enough to touch everything. Past the threshold the card says it
  cannot be narrowed and needs reading. **Citation matches bypass this** — naming a provision that
  appears on 30 rows is still naming that provision.
- `held:false` on `incometax` and `ibbi` — the register holds no obligation under either, so those
  items say the register cannot see them rather than reporting nothing found. Different claims.
- `trkReadNote()` — stated once per fetch: matching only ever saw the headline and the feed
  summary, never the circular.

---

## 2i. SINCE LAST REVIEW (v133, Phase 2 item 17)

Tab on the Audit Trail panel (`AUD_MODE` = `digest` | `trail`; `renderAuditDigest`).

**No model is involved, deliberately.** The brief files this under the AI items, but the audit
trail already records every status transition and every field change with actor, timestamp and
old/new value — that IS the answer. Asking a model to summarise records held exactly would add a
paraphrase and a chance of being wrong.

### Three kinds of change; only one comes from the trail
1. **What people did** — grouped by `AUD_GROUPS` into Filings / Confirmations / Ownership /
   Applicability / Priority and stage / Status transitions. Grouping matters: "4 owners named" is
   reviewable, four rows each saying "Owner" is not.
2. **What time did** — `audDateMoves()` computes what crossed its due date inside the window from
   the register's own dates. Nobody did it, so it is in no trail, and it is the change most worth
   seeing. Each row says whether anything is recorded against it.
3. **What is coming** — the next 30 days, so a review ends looking forward.

### Rules carried over from earlier sections
- `audIso()` formats from local parts. **Never `toISOString()`** — section 2b: it shifted every
  date back a day in IST.
- **Empty sections state themselves** ("Fell due in this period — none", "Due in the next 30 days —
  none"). A vanished section is indistinguishable from one that was never built. This is the same
  defect class as the legends that didn't sum to their own total.

### The review point is per browser, on purpose
`localStorage['lg_review_point']`, defaulting to 30 days back. It is a reading position, not a fact
about the company — writing it to the record would make one person's scroll position look like a
team-wide review that may never have happened.

### Stated limit
The register is not snapshotted. If an entity's figures change and obligations become applicable as
a result, this shows the field change that caused it, **not** "3 obligations became applicable".
The screen says so.

---

## 2j. WHAT APPLIES — the conditions nobody had decided (v136, Phase 2 item 14)

Panel `p-applies` -> `renderApplies()`. Nav: Intelligence > What Applies.

**The finding this was built on.** The rules engine matches on entity *class* — listed, public,
private. But **39 of a listed entity's 237 obligations carry a qualification in their own
`appliesToText` that nothing in the system can evaluate**, and every one was silently resolved in
favour of "applies":

| condition | rows |
|---|---|
| Equity-listed **with a monitoring agency** | 8 |
| Equity-listed **with unutilised issue proceeds** | 5 |
| Equity-listed **with subsidiaries** | 5 |
| Equity-listed **(incl. SME from 01.04.2025)** | 5 |
| Equity-listed **under CIRP/implemented plan** | 4 |
| All listed entities **(except MF units)** | 4 |
| + 7 more conditions | 8 |

For a listed company with no subsidiaries and no recent issue that is a page of obligations it does
not owe — **and each sat in the denominator of every coverage figure on the dashboard**, so the
evidence percentage was measured against work that was never required.

### One answer per condition, not per row
`appConditions(c)` groups by the exact `appliesToText`; `appResolve(condition, applies)` settles the
whole group. "This company has no subsidiaries" clears 5 obligations in one click — verified live:
237 → 232 rows, 39 undecided → 34, and a "5 ruled out" chip appears. Asking row by row is the same
question five times, and a control that tedious does not get used.

### db/017_applicability_review.sql — the missing third state
`not_applicable` is `boolean not null default false`, so it could only say "does not apply". It
could not tell **"somebody checked and it applies"** from **"nobody has looked"**, and those are
different facts. Adds `applies_confirmed`, `applies_confirmed_by`, `applies_confirmed_at`.

**Bug worth remembering:** `lgPersist` wrote it and the loader read it into `c.chart`, but the chart
is not what anything renders — `getComplianceChart` copies selected fields onto each row, and a
field missing from that list round-trips through the database and reaches no screen. `userNA` was
copied there; `appliesConfirmed` was not. Confirming a condition saved correctly and changed nothing.

### Also on the screen
Applies-on-class-alone (grouped by law, expandable), ruled-out-by-you with each reason,
and never-applied via `lgExcludedFor(c)` with `lgWhyNotApplies` reasons.

### Mobile
The two decision buttons sat beside the condition text and pushed to 396px on a 375px viewport.
The page did not scroll — the card clipped them — so **the one control this screen exists for was
unreachable on a phone while looking fine from the outside**. `@media(max-width:640px)` stacks them.

---

## 2k. A PERIOD END IS NOT A DEADLINE (v141, Phase 2 item 15, stage 1)

**The finding.** 63 of a listed entity's 132 dated obligations — nearly half — all sat on
**31 March 2027**. Not computed from any rule: it is the end of the period the obligation relates
to, emitted as if it were the date the filing is owed.

| provision | what the source actually says | what was shown |
|---|---|---|
| Reg 47(1) | "Within 48 hours of conclusion of the board meeting" | 31 Mar 2027 |
| Reg 52(8) | "Within 2 working days of conclusion of the board meeting" | 31 Mar 2027 |
| Reg 23(2) | "Prior to the transaction" | 31 Mar 2027 |
| SS-2 | "21 clear days unless valid shorter-notice consent" | 31 Mar 2027 |
| Sec 184(1) | "First Board meeting of each FY" | 31 Mar 2027 |

Wrong by months, and two of them are not calendar-driven at all — driving the calendar, Due Soon,
and every overdue count.

### The rule data makes the split unambiguous
Every rule marked **`exact`** carries a real offset (`event_offset`, `quarter_end_offset`,
`agm_offset`, `fy_end_offset`) or is a genuine fixed date. Every rule marked **`derived`** carries
**no offset at all** — 79 of them — so the only date the engine can produce is the period end.

`lgHasDeadline(rule)` decides; `lgStripDeadlines()` nulls the due date. **Tested on the offset, not
the confidence flag, deliberately** — adding a real offset in `rules/` is all it takes to bring a
date back. That is stage 2.

### The occurrences survive
The first cut returned `[]`, which also threw away the occurrences: quarterly collapsed 4 rows to 1
and the register went 237 → 188. That is a functional loss — evidence is recorded per row, so one
row means one filing per year could be recorded for a quarterly return. Now each occurrence keeps
its `periodEnd` and its own row; only the invented `due` goes. Register stays at 237.

### NO_DEADLINE vs STANDING
`STANDING` = no date because none is fixed (continuous or event-driven) — right for Reg 10(1),
wrong for a Q1 return, which recurs quarterly and is merely missing its offset. `NO_DEADLINE`
("Deadline not established") says which it is, asserts nothing, and cannot be overdue.
Result for a listed entity: **105 STANDING, 111 NO_DEADLINE, 16 UPCOMING, 5 past due** — and every
remaining date is a real statutory deadline (AGM 30 Sep, AOC-4 30 Oct, MSME-1 31 Oct,
Reg 33(3)(a) 14 Aug, FLA 15 Jul).

### Two bugs the new state exposed
- **`null >= 0` is `true` in JavaScript.** The late/upcoming split tests `days < 0` / `days >= 0`,
  and `days` is null for an undated row — so all 111 would have fallen into the **upcoming agenda**,
  listed as work coming up with no date against it. `lgNoDate(state)` now guards every date-driven
  count.
- **The gauge legend read 348 of 237.** "Scheduled, not yet due" was a *residual* —
  `total − everything else` — so the new band's rows were still inside it. This is the same shape as
  the `onTrack` subtraction removed from these cards once before. **A residual always sums, which is
  exactly its danger: it cannot report a miscount, it absorbs one.** Each band is now counted from
  the states it represents, and any remainder gets its own visible band
  ("Not covered by the bands above") instead of being folded into a neighbour.

### The Exceptions module (item 16) followed from this
`dateDerived` ("Due date computed, not stated") became unsatisfiable — it tests `dueConfidence ===
'derived'` **and** a past-due date, and a derived rule no longer has a date at all. Permanently
zero: a control that cannot fire. Repurposed to **`noDeadline`** ("Recurs, but no deadline
recorded"), which reports the 111 rows that are now the stage-2 worklist.

Verified consistent with the dashboard on one listed entity: unassigned 21 = 21, overdue 5 = 5.
(An earlier reading of 396 unassigned was duplicated test entities in `CLIENTS`, not a defect.)

### Stage 2 — partly done, and smaller than it looked
Of the **96** rules with no offset, only **9** state a period in their own `timelineText` at all.
Most of those 9 are anchored to an **event**, not to a period end:

| rule | wording | anchor |
|---|---|---|
| Reg 47(1) | "within 48 hours of conclusion of the board meeting" | board meeting |
| Reg 52(8) | "within 2 working days of conclusion of the board meeting" | board meeting |
| Reg 34(1)(b) | "not later than 48 hours after the AGM" | AGM |
| Reg 6(1B) | "within 3 months of approval of resolution plan" | resolution plan |
| Sec 117 | "within 30 days" of passing | the resolution |

**Those are correctly undated.** Their clock starts on a date the *registers* hold (`meetings.held_on`),
not on a quarter end — giving them a quarter-end offset would reinstate exactly the invented dates
just removed. **This is the real stage 2: drive them off the meetings register**, which `db/010`
already populates and `regDerivedRows` already reads.

**4 were genuinely period-anchored and are now applied** via `LG_DUE_PATCH` (v144), each quoting the
wording it came from: Reg 33(3)(b) 45d, Reg 31(1)(b) proviso 21d, Reg 24A(2) 60d, Reg 44(5) 5 months.
Verified: Q1 30 Jun + 45 = 14 Aug; 31 Mar + 5 months = 31 Aug. Dated rows 21 -> 29.

`LG_DUE_PATCH` lives in code because `rules/*.json` is generated by `build_master.py` /
`build_lodr.py` from the owner's spreadsheet (`~/OneDrive/Desktop/master sheet.xlsx`, **not present
on this machine**) and must not be hand-edited. **Migrate it into `build_lodr.py` when that sheet is
next available.** `lgPatchRule` is applied where the *row* is built, not in the date builder — doing
it in the builder gave correct dates on rows still reporting `derived`.

The remaining **87** state no period at all ("within statutory period", "apply route-specific
statutory timelines"). Those need the deadline looked up per rule against `reference/` and confirmed
by the owner — they are not recoverable by parsing.

---

## 2l. DEADLINES THAT RUN FROM A MEETING (v146)

Reg 47(1) is *"within 48 hours of conclusion of the board meeting at which the financial results
were approved"*. Reg 34(1)(b) is *"not later than 48 hours after the AGM"*. Neither is anchored to a
quarter end — which is why both correctly lost their invented dates in 2k, and why neither had any
date afterwards.

**The anchor was not missing; it was in the meetings register.** `LG_EVENT_ANCHOR` + `lgAnchorDue()`
compute the deadline from a row the user entered. Verified live: results board meeting recorded
5 Aug 2026 -> Reg 47(1) **Q1 due 7 Aug**; AGM 25 Sep -> Reg 34(1)(b) **due 27 Sep**; the non-results
board meeting on 10 Jul correctly ignored; **Q2-Q4 stay undated** because no results meeting is
recorded for them.

### db/018_meeting_outcomes.sql — NOT YET RUN
Adds `meetings.approved_results boolean`. The register recorded *that* a board meeting happened, not
*what it transacted*, so the engine could not tell the results meeting from any other. Attaching the
deadline to every board meeting would have invented deadlines for meetings that never considered
results — the 31 March defect arriving by a different road.

Register field added (`t:'bool'`, "Financial results approved"). Until the migration runs, saving
names the file: `regSave` now maps a missing *column* to its migration, not just a missing table.

### Section 118 minutes — one obligation per meeting (v147)
The register carried this as a single undated row reading *"Prepare, enter and preserve within
statutory framework"* — true, and useless. Section 118(1), verbatim from `reference/`:

> "...to be prepared and signed in such manner as may be prescribed and kept **within thirty days
> of the conclusion of every such meeting** concerned"

It covers **every** board, committee, general and class meeting, so it is one duty per meeting, not
one per year. Now emitted from `regDerivedRows` per meeting (same shape as DIR-3 KYC per director):
due = `held_on` + 30, and **`minutes_state` supplies the evidence automatically** — `signed` or
`entered` closes the row, `minutes_signed_on` shows whether that happened inside the thirty days.
Scoped to the FY in progress, matching the board-cadence row above it.

Verified: meeting 20 May -> due 19 Jun, signed 10 Jun -> evidence on record; meetings 5 Aug -> due
4 Sep, UPCOMING; an audit-committee meeting gets its own row; a meeting in the previous FY excluded.

### Stated limits
- `held_on` is a **date**, not a timestamp, so "48 hours from conclusion" is computed as the second
  day after and each row says so. The register does not hold the hour the meeting closed.
- **Reg 52(8)** ("two *working* days") is deliberately not wired — there is no holiday calendar
  here, and a working-day count without one is a guess.
- Matching is earliest-qualifying-meeting-on-or-after the period end, so one recorded results
  meeting settles the quarter it belongs to and leaves later quarters undated.

---

## 2m. CHARGES REGISTER (v148) — db/019 NOT YET RUN

Sections 77-87 were the largest group of undated obligations, and not because the deadline was
unknown. Verbatim from `reference/`:

> **s.77(1)** "...to register the particulars of the charge ... with the Registrar **within thirty
> days of its creation**"
> **s.82(1)** "...intimation ... of the payment or satisfaction in full of any charge ... **within a
> period of thirty days** from the date of such payment or satisfaction"

Thirty days *from what* was the gap. Nothing recorded that a charge had been created or satisfied —
the same shape as Reg 47(1) before the meetings register was wired to it.

`db/019_charges_register.sql` adds the `charges` table (holder, nature, amount, property,
`created_on`, `modified_on`, `satisfied_on`, `charge_id`, `chg1_filed_on`/`chg1_srn`,
`chg4_filed_on`/`chg4_srn`). Panel `p-charges`, nav "Charges" — the register engine dispatches
generically off `LG_REG[id]`, so no new render function.

### Obligations emitted (`regDerivedRows`)
- **Sec 77(1) / CHG-1** — due `created_on` + 30. A `modified_on` takes precedence as the anchor and
  the row switches to "Sec 79 r/w Sec 77".
- **Sec 82(1) / CHG-4** — due `satisfied_on` + 30.
- `chg1_filed_on` + `chg1_srn` (and the CHG-4 pair) become `autoEvidence`, so the row closes from
  the practice's own record.

### The extension routes are deliberately NOT the deadline
s.77's proviso allows 60 days on additional fees; s.82's allows 300. **Both are applications to the
Registrar, not the date the filing is owed.** Using them as the due date would tell a CS that a late
filing is on time. The 30-day date is the deadline; the extension is named in the note.

### Retention
A row shows while the filing is outstanding **however old the charge**, and for a year after it is
filed. An unregistered charge from three years ago is still a live problem; a registered one is not.
Verified: 2023 charge unfiled -> still past due; 2019 charge filed -> dropped off.

---

## 2n. ALLOTMENTS REGISTER (v150) — db/020 NOT YET RUN

Same pattern as charges: three duties run from the date securities are allotted, and nothing
recorded that an allotment had happened. `db/020_allotments_register.sql` adds `allotments`
(route, security, `allotted_on`, number, amount, allottees, `pas3_filed_on`/`pas3_srn`,
`certificates_on`). Panel `p-allotments`, nav "Allotments".

### The periods are NOT equally well founded, and each row says so
| obligation | period | authority |
|---|---|---|
| PAS-3, private placement | **15 days** | **s.42(8), stated in the Act** |
| PAS-3, every other route | 30 days | **Rule 12** — s.39(4) says only "in such manner as may be prescribed", and that rule is **not in `reference/`**. The row states this. |
| Certificates, shares | **2 months** | **s.56(4)(b), stated in the Act** |
| Certificates, debentures | **6 months** | **s.56(4)(d), stated in the Act** |

Section label reflects it: `Sec 42(8)` vs `Sec 39(4) r/w Rule 12`.

### Subscribers to the memorandum raise NO obligation
Shares taken by subscribing to the memorandum are **subscribed, not allotted** — s.39(4) bites where
a company "makes any allotment", and s.56(4)(a) runs from *incorporation*, a date this register does
not hold. The first cut raised a PAS-3 for them, which is a filing that is not owed. **Creating an
obligation that does not exist is the same defect as inventing a date for one that does.** The row
is kept as a record and generates nothing.

### lgAddMonths
Months are added by calendar and clamped to the last day of the target month — 31 Dec + 2 months is
**28 Feb**, and approximating in days would move the deadline. Verified: `2025-12-31 +2m ->
2026-02-28`, `2026-08-31 +6m -> 2027-02-28`.

---

## 2o. BENEFICIAL INTEREST — sections 89 and 90 (v151) — db/021 NOT YET RUN

`db/021_beneficial_interests.sql` adds `beneficial_interests`. Panel `p-beneficial`, nav
"Beneficial Interest". Register key is `beneficial`, table is `beneficial_interests`.

### The anchor is receipt, not the change — and the Act says so
s.89(6), verbatim: *"the company shall ... file, **within thirty days from the date of receipt of
declaration by it**, a return in the prescribed form with the Registrar"* -> **MGT-6**.

So `change_on` and `received_on` are separate columns and **only `received_on` produces a filing**.
The declarant's clock under s.89(3) runs from the change; the company's runs from receipt, and they
are often weeks apart. Dating MGT-6 from the change would make it overdue before anybody told the
company anything had happened. A declaration recorded as changed but not received raises nothing.

Verified: change 1 Jul, received 10 Aug -> MGT-6 due **9 Sep**.

### s.90 is the mirror image and less well founded
s.90(4) states only *"within such time ... as may be prescribed"*. The thirty days for **BEN-2**
comes from the Companies (Significant Beneficial Owners) Rules 2018, **not in `reference/`**.
Section label reads `Sec 90(4) r/w SBO Rules` and the row says the period rests on rules not held —
same treatment as PAS-3 under Rule 12.

---

## 2p. BOARD COMPLIANCE REPORT (v154, Phase 3 items 1 + 2)

Panel `p-board` -> `renderBoard()`. Nav: Intelligence > Board Report.

**Items 1 and 2 are one feature.** A board dashboard that cannot be put in front of a board is
another screen, and a board-ready report built from different numbers will disagree with the
dashboard in the room.

Deliberately **not** the Command Center. That is the CS's worklist across every entity, ordered by
what to do next. This is **one entity, one period**, ordered by what a board is answerable for.

### Period defaults to "since the board last met"
`brdDefaultFrom(c)` reads the meetings register for the latest past `kind:'board'` meeting. No
meeting recorded -> 90 days, and the header says which basis was used.

### Six sections
1. **Summary** — every figure counted from the register, none a residual of another
2. **Filings recorded in the period**
3. **Past due, nothing recorded** — *not* limited to the window; a board is answerable for
   everything outstanding as at the report date
4. **Requiring a decision** — the undecided applicability conditions from `appConditions`, plus
   obligations with no owner
5. **Falling due in the next ninety days**
6. **Basis of this report, and its limits** — states plainly that **nothing is verified against
   MCA21 or the exchanges**, and that "past due, nothing recorded" describes the register rather
   than asserting the filing was not made. Then a signature block.

### The bug worth remembering
Section 3 listed "Minutes — Board meeting held 20 May 2026" as *nothing recorded* while its own
status cell three columns right read **"Filed"**. A filing entered by hand lands on `st.filing`;
one supplied by a register lands on `row.autoEvidence` and never reaches it. Testing only the first
made the report contradict itself inside a single row, in the section a board reads first. Both are
now honoured, and a register-sourced filing says which register it came from.

### Printing is the deliverable
`@media print` hides `.appside`, `.appheader`, `.brd-noprint` and every other panel, leaving the
document alone with `page-break-inside:avoid` on each section. **Print selectors were verified
against the real DOM** — the first cut targeted `.sidebar`, which does not exist in this app.

---

## 2q. ADT-1 FROM THE MEETING (v155) — db/022 NOT YET RUN

**No auditor register was needed for this.** The third proviso to s.139(1) gives the period and the
anchor in one sentence, verbatim from `reference/`:

> "...file a notice of such appointment with the Registrar **within fifteen days of the meeting in
> which the auditor is appointed**."

and the Explanation: *"'appointment' includes re-appointment"* — so an annual re-appointment files
too, which is the one people forget.

`db/022_meeting_auditor.sql` adds `meetings.auditor_appointed`. Same pattern as `approved_results`:
the register knew a meeting happened, not what it did.

One flag covers both routes because the filing is identical — members appointing at an AGM under
s.139(1), or the Board filling a casual vacancy under s.139(8). The row says which from
`meetings.kind`, and adds the s.139(8) thirty-day note for the Board route.

**Not FY-scoped**, unlike the Sec 118 minutes rows: an appointment holds to the conclusion of the
sixth AGM, so the meeting that made it can sit in an earlier year while ADT-1 is still outstanding.
Verified: AGM 20 Aug -> due 4 Sep; Board casual vacancy 5 Jul -> due 20 Jul; an ordinary board
meeting raises nothing; a Sep 2025 AGM still appears.

### Tenure is deliberately NOT modelled
s.139(1) runs a term to the conclusion of the sixth AGM and s.139(2) forces rotation — five
consecutive years for an individual, two terms of five for a firm. That is a multi-year clock across
appointments, cannot be computed from one meeting, and would need its own register. **This is the
one remaining auditor obligation worth a register**, and the highest-consequence one: miss it and
the auditor is disqualified.

---

## 2r. DEAD CODE SPRINT (v156) — 49 functions, 33 KB

Both independent assessments (29 Aug 2026) put a dead-code sprint at **P0**, for the same reason:
legacy and replacement paths sitting side by side means "one feature, one authoritative
implementation" is not true, so two answers to one question can both exist.

**Removed: 49 functions over 2 rounds, 2,333,485 -> 2,299,717 chars.**

### The criterion, and why the first attempt was wrong
First pass built a call graph by matching `name(`. It missed every function passed **by reference** —
`[['coverage', ccCardCoverage], ...]` — and confidently reported the live dashboard as dead. Acting
on it would have removed the Command Center.

The criterion actually used: **a function whose name appears exactly once in the whole file** is its
own definition and nothing else — no inline handler, no dispatch table, no reference by name. That
cannot be a false positive. Iterated to a fixed point, so removing `askAboutClient` in round 1 made
`getDeadlines` unreferenced in round 2.

**`getDeadlines` is the "dead twin"** section 2b flagged: same `fyend` and threshold bugs that were
fixed in the live path, still sitting there as a second, wrong answer. Gone.

Bodies located by brace matching that tracks strings, template literals and comments — not by
guessing where the next `function` starts. Every round syntax-gated; failure aborts without writing.

### What went
Old dashboard (`ccRenderGauge`, `ccHealthColor/Label`, `ccLegendRow`, `ccMetric`, `ccSig`, `ccTag`),
old detail modal (`cdAddEvidence`, `cdAdvanceApproval`, `cdApprovalChain`, `cdDelEvidence`,
`cdToggle*`, `cdLog`), old client management (`saveClient`, `deleteClient`, `exportClients`,
`_old_*`), the **legacy access-code path** (`addCode`, `saveKey`, `changeKey`) that assessment §16
flags as a second competing authentication concept, the **Gemini leftovers**
(`getGeminiKey`, `setGeminiKey`, `saveGeminiKeyFromAdmin`, `loadGeminiKeyToAdmin`), and the orphaned
legal-research handlers (`runOpinion`, `runSCN`, `runCompound`, `runCases`, `runXLaw` — their panels
had already been removed).

### Verified after
29 panels / 29 nav items, **no orphans either way**. No JS errors. Every engine answers:
`getComplianceChart` 238, `ccComputeStats` 238, `impAssess` 4, `mgt14Assess` 1, `appConditions` 13,
`excBuild` 8 types. Both gauge legends still sum to their own total. A sweep of every inline handler
in the DOM found **no handler naming a function that no longer exists**.

---

## 2s. RULE VERSION GOVERNANCE (v157, assessment P0) — db/023 NOT YET RUN

Panel `p-governance` -> `renderGovernance()`. Nav: Administration > Rule Governance.

Both independent assessments lead with this: a compliance product cannot rest on a static rule
corpus with no effective dates and no source verification.

### The position it states, out loud
> **Not one of these 327 rules is tied to a published instrument.**

Verified live: **327 rules** (Companies Act 54, LODR 231, PIT 42), **327 never checked**, **53
flagged `needsReview`** in the source data. Every corpus traces to a *spreadsheet* —
`master sheet.xlsx` and `LODR Compliance Calendar and Material Events.xlsx` — not to a regulation.
`LG_CORPUS` names each corpus, what generated it, and its known weakness (the Act text in
`reference/` is "as amended upto 01.04.2021").

This does not make the rules current — only reading the law does that. It stops the gap being
invisible, which is the same rule the evidence engine runs on: **the absence of a check is not a
pass.** A rule nobody has checked reads "Never checked", not "current".

### Three distinct states, as in db/023
- **no row** -> nobody has looked (`unverified`, or `flagged` if the source flagged it)
- **`current`** -> a person checked it against a *named* instrument
- **`needs_update` / `superseded`** -> known stale, with a reason

### It refuses a verification with no authority behind it
`govSave` blocks on an empty instrument: *"A verification with no instrument behind it records
nothing more than a date."* That is the whole point of the record.

### A worklist, not a report
The assessments ask for `needsReview` to become "a managed review queue rather than remain
indefinitely unresolved". Tabs: To check (327) / Flagged in the source (53) / Stale / Checked / All,
with search, and a stated cap at 200 rows.

### Bug worth remembering
The modal was written against `.cd-title`, `.cd-sub`, `.cd-x`, `.ent-f` — **none of which exist**.
Same invented-class trap as `.cd-shell` (section 6) and `.sidebar` (section 2p). The real shell is
`regOpen`'s: `.cd-inner > .cd-body > .cd-head` with inline-styled heading and close button.
**Check every class against the stylesheet before writing markup in this app.**

---

## 2t. COMPLIANCE REGRESSION SUITE (assessment P0)

`node tests/compliance.test.js` — **78 assertions**, run against `index.html` itself rather than a
copy of the logic. `node tests/mutation.js` — proves the suite can fail.

Both assessments ask for "a formal suite of statutory edge cases (month-end, leap year, FY variants,
prior-year references, event-driven dates)" to prevent silent compliance errors. **A wrong date does
not look wrong; it looks like a date** — the 63 obligations sitting on 31 Mar 2027 were on screen
for months.

### Time is frozen
`harness.js` pins `new Date()` to **29 Aug 2026** (FY 2026-27) while leaving parsing and arithmetic
real. Every date here is computed relative to now, so a suite asserting real dates against a moving
clock would rot in days. Change `FROZEN_NOW` and the expected values move with it.

### It loads the shipped app under Node
The script block is extracted and run in a VM with a small browser shim (`document`, `localStorage`,
`window.addEventListener` — that last one is what blocked the first attempt). Every engine is then
directly callable: `getComplianceChart`, `lgAddMonths`, `lodrInFY`, `trkParseCites`, `mgt14Assess`,
`impAssess`, `appConditions`, `lgResolveStatus`, `ccComputeStats`.

### The mutation check earned its place immediately
`mutation.js` reintroduces 8 real bugs (§2g, §2h, §2k, §2n, §2o) and reports whether the suite
noticed. **8 caught, 0 missed** — but only after it found a genuine blind spot: the minutes-split
test asserted only *how many* decisions came back, and both the correct and broken splitter returned
two on that input. It now asserts where each ITEM heading lands, which is what the bug got wrong.

**A missed mutation is a blind spot in the suite, not a harmless bug.** Strengthen the assertion.

### When fixing a compliance bug
Add the assertion that would have caught it **and** the mutation that reintroduces it. The second
half is the only thing that proves the first half works.

---

## 2u. NAVIGATION CONSOLIDATION (v158, assessment §5.2 / §20)

Thirty destinations across five headings that had stopped meaning anything: **"Operate" held
eighteen items** including the board report and the applicability review, and **"Reference" held the
audit trail and Administration**. Both assessments make the same point — the user ends up thinking
about the product's structure instead of about the compliance problem.

### Nothing was deleted
All six panels the assessments want demoted (`chat`, `penalty`, `deeplaw`, `ff`, `res`, `docs`) were
checked first: **all six render and none has a dead button.** The recommendation is to subordinate
them, not to remove working features.

### Nine groups, named by the question each answers
| group | items | default |
|---|---|---|
| *(ungrouped)* Dashboard | 1 | — |
| **Compliance** — what applies, what is due, what is evidenced | 5 | open |
| **Events & change** — what happened, and what changed | 3 | open |
| **Registers** — what we know about the entity | 7 | open |
| **Evidence** — can I prove it was done | 3 | open |
| **Reports** — what can I present | 2 | open |
| **Drafting** | 2 | **closed** |
| **Reference** | 4 | **closed** |
| **Administration** | 3 | **closed** |

**30 items preserved, 21 visible at rest.** State persists in `localStorage['lg_nav_closed']`.

### navReveal — the bit that would have been a bug
A collapsed group **opens itself when you navigate into it** (`navReveal` called from `sw()`).
Without it, `ccGo()` or an Event Impact row jumping to a collapsed destination leaves the sidebar
looking like it lost the page. Verified explicitly: group closed → item hidden → `sw('deeplaw')` →
group open, item visible, panel shown.

### The patch re-emits rather than retypes
Existing `.navitem` markup is parsed out by id and re-emitted in the new order, so every SVG icon
survives byte-for-byte. The script **aborts** if any item would be dropped or any placed id has no
panel. (First run caught its own regex: `class="navitem on"` on the active item didn't match
`class="navitem"`, so `home` went missing — 29 of 30.)

---

## 2v. RULE AUDIT AGAINST THE HELD TEXTS (v159) — assessment P0 #1

`python tools/rule_audit.py [--detail]`

**Correction to an earlier belief in this project: the 2026 SEBI amendments ARE here.**

| text in `reference/` | as of |
|---|---|
| SEBI LODR 2015 | **amended up to 14 July 2026** — the second amendment the assessments name |
| SEBI PIT 2015 | amended upto 12 March 2025 |
| Companies Act 2013 | 01.04.2021 — **stale, over five years** |

So the corpus the reports flag hardest *can* be checked. Result:

```
checked                  273
citation found           255      citation not found  0
no citation               18      (Schedule A/B, SDD framework — not checkable this way)
schedule-derived          92      (period lives in the Schedule, not the cited regulation)
period mismatch            0
```

### Every "finding" on the first three runs was the audit's own bug
- **Reg 91C "missing"** — the heading is `91C. 634[(1)`; a footnote marker sits between the number
  and the body, and the matcher required `91C.(1)`.
- **Reg 31(1)(b) "21 days vs 10 days"** — the text says *"within twenty one days"* as **two words**,
  which the number map (holding only `twenty-one`) could not read; the 10 days came from limb (c).
  **The 21-day `LG_DUE_PATCH` offset is confirmed correct against the current text.**
- **Reg 61A(2) "7 days vs 30 days"** — the PDF extraction splits the word: *"within se ven days"*.
  The rule states exactly what the regulation states.
- **24 Schedule III entries** — they cite `Reg 87B(1)`, the enabling provision, while their 24-hour
  timing lives in the Schedule. Counted separately, not reported as questions about the law.

A noisy audit gets ignored, so each was fixed rather than tolerated.

### What it establishes, and what it does not
Stated on the governance screen in those words: the citations are sound. It does **not** establish
that a rule's substance is current — **a regulation can be amended in ways that leave its number and
its deadline untouched.** A rule still reads "never checked" until a person verifies it. A mechanical
citation check is not a professional's sign-off and the screen must not let one pass for the other.

---

## 2w. PIT CONTROL CENTRE (v161) — db/024 NOT YET RUN

Panel `p-pit` -> `renderPIT()`, plus four registers on the generic engine:
`dp` / `upsi` / `sdd` / `preclear`. Nav group **Insider trading**.

Both assessments name this a major differentiator. It is also the
highest-consequence area in the product — an insider-trading failure is not a
late-filing penalty. Grounded in `reference/sebi-pit-2015` (**amended upto 12 March 2025**), with
every number cited on screen.

### The trading window is computed, not typed
> **Schedule B cl. 4(2)** — "Trading restriction period shall be made applicable from the end of
> every quarter till 48 hours after the declaration of financial results."
> **Schedule B cl. 5** — re-opening "shall not be earlier than forty-eight hours after the
> information becomes generally available."

Both ends come from data already held: the quarter end closes it, and the **results board meeting in
the meetings register** — the same `approved_results` flag Reg 47(1) uses — reopens it. One recorded
meeting drives both. `pitWindow(c)` returns the state plus a cited reason per cause.

Verified across every branch (today 30 Aug 2026, Q1 ended 30 Jun):
| scenario | result |
|---|---|
| no results meeting since the quarter end | **CLOSED** — cl. 4(2) |
| results approved 5 Aug (reopened 7 Aug) | open |
| results approved 29 Aug | **CLOSED**, reopens 31 Aug — cl. 4(2) |
| results approved *exactly* on the reopen date | open (correct: `today < reopen`) |
| unpublished UPSI marked as closing | **CLOSED** — cl. 4(1) |
| UPSI published 29 Aug | **CLOSED** until 31 Aug — cl. 5 |
| UPSI **not** marked as closing | open (the 2025 proviso) |
| a **non-results** board meeting | does not reopen it |

### What it refuses to decide
- **Closing the window for any other reason is the compliance officer's judgement** — cl. 4(1) says
  "when the compliance officer determines...". So `window_closed` is a per-item flag on the UPSI
  register and the screen names which item is holding it shut. The 2025 proviso (UPSI not emanating
  from within the company) is why it is not automatic.
- **There is no exchange trading calendar here**, so Reg 7(2)'s "two trading days" is counted as two
  calendar days and every row says so. That errs early — the safe direction for a deadline, but not
  the real date.

### The SDD says what an empty database means
Reg 3(5) requires one to be maintained. An empty `upsi_access` therefore reads *"an empty database is
not the same as no UPSI having been shared"* rather than showing a reassuring zero.

### Not listed
The screen is not hidden for an unlisted entity — it says the PIT Regulations do not bite, because
"not applicable" is a more useful answer than an empty dashboard.

---

## 2x. THE CHEAP HARDENING (v162) — from the 30 Aug re-audit

The 30 Aug re-audit scored every dimension I had worked on higher and left **architecture at 5.5**,
the one item I declined. Three of its asks were cheap; all three found real things.

### `tests/smoke.test.js` — 12 structural checks, no browser
Codifies what had been run by hand after every change. Each check exists because it caught a bug:
nav ↔ panel pairing (both ways), `sw()` targets exist, every inline handler names a live function,
every class used is defined **or addressed by script**, build marker present.

**It found two undefined classes on its first run** — `.ent-f` (the "Has this been filed?" field
group, which had no spacing) and `.cmd-head-l` (a flex child with no `min-width`). That is the
fourth time invented class names have reached markup here; now it cannot happen silently.

**Two bugs in the check itself, both worth remembering:**
- It read only the **last** `<script>` block. The auth functions live in an earlier one, so it
  reported `lgSignIn`, `lgSignUp` and `lgResetPassword` as missing. A check that cries wolf about
  the login button is worse than no check.
- A shell heredoc turned `` into a literal **0x08 backspace** inside a regex — CLAUDE.md §6's
  recurring failure, twice. The regex silently matched nothing, so every script block vanished and
  every handler looked dead. **Write patch scripts with the Write tool.**

### `tools/rule_audit.py` — now a release gate
Exits non-zero on *citation not found* or *period mismatch*. "No citation to check" and
"schedule-derived" are observations and do **not** block — failing a release over those would teach
everyone to skip the gate. Currently: `RELEASE GATE: clear — 255 citations checked`.

### Mutation coverage extended to status transitions
Four new mutations, and **three passed against the bug** — real blind spots:
- `NO_DEADLINE` collapsing into `STANDING` — the suite asserted the two **together**, so merging one
  into the other changed nothing it looked at.
- `userNA` no longer honoured in `lgResolveStatus`, and `userNA` rows no longer excluded from the
  register — **nothing covered the not-applicable path at all**, the control the whole applicability
  review exists to drive.

Now closed. Suite is **99 assertions**; mutations **14 caught, 0 missed**.

### One mutation deliberately retired
"A private company starts receiving LODR obligations" was attempted three ways and passed every
time. The reason is worth keeping: the exclusion is guarded **twice, independently** — the outer
`if(isListed)` never calls `lodrObligations`, and `lodrApplies` refuses every rule anyway because
`lodrListingTypes` returns nothing. Breaking either alone changes nothing. That is defence in depth,
recorded in `mutation.js` as a note rather than worked around by mutating both until something fails.

Its slot went to the **PIT trading window**, which had no automated coverage at all — 13 assertions
across cl. 4(1), cl. 4(2) and cl. 5, plus three mutations.

---

## 2y. STATUTORY CALCULATORS (v163)

Panel `p-calc` -> `renderCalc()`. Nav: Compliance > Calculators.

**The gap this fills.** The app could say *what* is due and *whether* it was evidenced, and could
not compute a single statutory number. Applicability, deadlines, evidence, registers all answer
"what" and "when". None of them answers **"how much"**, which is most of what a CS is actually
asked on the phone.

Eight calculators, one panel, tabs -- deliberately not eight nav destinations. The owner's
not-wanted list names "too many dashboards", and section 2u had just cut thirty destinations into
nine groups; adding eight more would have undone it.

### Every engine is a pure function, and that is the point
`calc198Compute` / `calc197Limits` / `calcCSRSpend` / `calc186Limit` / `calc403Fee` /
`calcBoardCheck` take a plain object and return **the working line by line**, each line carrying
the clause it comes from. Nothing returns a bare number: a figure a client cannot trace is a figure
the CS cannot sign. The forms are only a way of calling them -- which is also why the suite can
exercise all six directly. **A calculation reachable only through a form is a calculation nobody
can test.**

### What each rests on, verbatim from `reference/`
| tab | provision | the words it turns on |
|---|---|---|
| Net profit | s.198(1)-(5) | credit for (2), none for (3); (4) deducted, (5) not |
| Managerial remuneration | s.197(1) | 11% / 5% / 10% / 1% / 3%, and the public-company limit |
| CSR spend | s.135(5), (9) | "at least two per cent of the average net profits ... three immediately preceding financial years" |
| Loan & investment | s.186(2) | "sixty per cent ... or one hundred per cent ... **whichever is more**" |
| Loan to a director | s.185(1)-(3) | the prohibition, the s.185(2) route, the four s.185(3) exceptions |
| Dividend | s.123(1) + provisos | the sources test only |
| Late filing fee | s.403(1), first proviso | "not less than one hundred rupees per day" |
| Board composition | s.149(1), (3), (4), 177(2), 178(1) | minimums, the fifteen cap, the one-third rule |

### The three decisions worth keeping

**1. s.197 adds directors' remuneration back, and forgetting it understates every ceiling.**
s.197(1) computes on the s.198 figure *"except that the remuneration of the directors shall not be
deducted from the gross profits"*. So remuneration already charged in the accounts is added back
before the percentages are taken. This is the commonest error in the calculation and it fails
**quietly** -- it produces a lower, entirely plausible ceiling.

**2. CSR closes a gap section 2c recorded as unmodelled.** That section says the CSR *spend*
calculation "is not modelled at all -- only applicability is". The Explanation to s.135 settles the
basis: net profit here *"shall be calculated in accordance with the provisions of section 198"* --
so the first tab feeds the third directly. s.135(9)'s fifty-lakh Committee threshold is
**inclusive** ("does not exceed"), so exactly fifty lakh needs **no** Committee; the suite asserts
that boundary from both sides.

**3. s.403 refuses to price most forms.** The Act says the fee is *"such fee as may be prescribed"*.
Only the first proviso names a figure, and only for s.92 and s.137 filings -- Rs 100/day. Every
other form's slabs are in the Companies (Registration Offices and Fees) Rules, **not in
`reference/`**. So the screen says it cannot price them. Naming a number we cannot cite would be
worse than the gap: a CS would file on it. Same treatment as PAS-3 under Rule 12 (section 2n).

### Board composition runs on the register, and says what it cannot test
`calcBoardCheck` reads the directors register rather than a form, so it answers for a real company.
s.149(4)'s Explanation rounds any fraction in the one-third **up**, so seven directors need three
independent, not two -- asserted from both sides.

What the register does not hold is reported as **`not tested`, never as a pass**: residency under
s.149(3), and committee membership for s.177(2)/178(1). The committee rows say only whether a
compliant committee *could* be formed from the board as it stands. Same rule as the evidence engine
-- **the absence of a check is not a pass.** Every untested row carries its reason, and the suite
asserts that too.

### The bug the browser found that Node could not
Every field updates as you type, except a date. The date inputs listened on `change` alone, which
for a hand-typed date does not fire until blur -- so the answer sat stale while the user looked at
it, which reads as broken. Now `oninput` **and** `onchange`: a picked date fires one, a typed date
fires the other. **Node could not have caught this; only driving the real form did.**

### Coverage
**52 new assertions** (suite 99 -> 151) and **10 new mutations** (14 -> 24 caught, 0 missed). The
mutations reverse a sign or move a boundary rather than breaking the code, because that is how this
class of bug actually arrives: `Math.max` -> `Math.min` on s.186, `>` -> `>=` on the CSR threshold,
`ceil` -> `floor` on the one-third, a s.198(5) add-back turned into a deduction. **A wrong figure
looks exactly like a right one**, which is the whole reason this suite exists.

### Not built, and why
- **Resume builders** -- not a compliance product's job.
- **A statutory-audit checklist** -- the auditor's workpaper, not the CS's.
- **NIC code finder** -- needs the NIC-2008 corpus, which is not held. A partial list would be a
  dummy item.
- **Schedule V Part II slabs** (remuneration where profits are inadequate) -- they turn on
  *effective capital*, a different computation with its own definition. Named on screen as not
  computed.
- **Annual compliance calendars per company class** -- `getComplianceChart` already does this per
  entity from its actual figures, which beats a generic list by class.

---

## 3. ARCHITECTURE

### Frontend
- Single `index.html`. Inline `<style>` and one large main `<script>` (the last `<script>` block, ~1.3 MB of JS).
- **Design system (current):** "Command Center" enterprise theme. Fonts: **Manrope** (UI) + **IBM Plex Mono** (codes: CIN, DIN, SRN, sections, dates). Colors: Deep Navy `#0B1220`, Ice White `#F7F9FC`, Electric Blue `#2563EB`, Regulatory Cyan `#06B6D4`, Success `#10B981`, Warning `#F59E0B`, Critical `#EF4444`, Border `#E2E8F0`. Restrained color, big confident headings, soft shadows.
- **Navy left sidebar** grouped: Intelligence / Operate / Document Studio / Reference / Administration. Header has gradient logo, global search (currently non-functional placeholder), user + logout.
- **Mobile:** responsive with a hamburger (`toggleMobileNav`/`closeMobileNav`) that slides in the sidebar; wide tables become stacked cards below 640px; table scrolls horizontally in-card 641–900px. Tested clean (no horizontal overflow) at 360/390/430/768/1024px.
- A small version marker lives in the header (`.appbrand .t`, currently "Compliance OS · v7") — bump it each deploy to confirm what's live.

### Panels / navigation
- Panels have ids `p-<name>`; nav items `t-<name>`; switching via `sw('<name>')`.
- Current nav targets: home, universe, mywork, chat, ff, xlaw, tracker, cal, cl, res, docs, opinion, scn, penalty, cases, compound, deeplaw, admin.
- `sw(id)` removes `.on` from all navitems + panels, force-hides all panels inline, shows the target, then calls the matching render: `home→renderCommandCenter`, `universe→renderUniverse`, `mywork→renderMyWork`, `cal→rc`.

### Key modules built (all render from real client data)
- **Command Center** (`renderCommandCenter`→`#cc-dash-root`): compliance-health gauge (custom segmented SVG arc, not a donut), 6 clickable metric cards (Applicable obligations / Due this week / Overdue / Upcoming / In good standing / Entities — each calls `ccGo(filterKey,val)` to jump into filtered Universe), and a "Requires your attention" list. Stats via `ccComputeStats()`.
- **Compliance Universe** (`renderUniverse`→`#cu-root`): master data table of every applicable obligation across all entities. Columns: Compliance, Law, Section/Reg, Entity, Frequency, Due, Risk, Status. Filters (`CU_FILTERS`: entity/law/risk/status/freq/q), sortable (`CU_SORT`), summary chips, CSV export (`cuExport`), row → detail. Rows built from `cuBuildRows()` which iterates `CLIENTS` and calls `getComplianceChart(c)`.
- **My Work** (`renderMyWork`→`#mw-root`): personal task center. Tabs Today/Overdue/Due Soon/Assigned to Me/Completed (`MW_TAB`), buckets via `mwBucket()`. Each task shows legal basis, entity, owner, risk, due, days, next action.
- **Compliance Detail Workspace** (`openComplianceDetail(entityId,key)` → modal `#cd-modal`): overview grid, legal basis, "why this applies", step checklist (`CD_STEPS` per obligation type, progress bar), document states, approval chain (`cdApprovalChain`), evidence upload, audit trail. Per-obligation state persisted in `localStorage` (`lg_cd_<entityId>_<key>`). `cuOpenDetail` is aliased to `openComplianceDetail`.
- **Older still-working panels:** AI chat (`p-chat`), Form Finder (`p-ff`, 91-form master `FORM_MASTER` + detailed `FORMS`, `getFormDetail`), Circulars/Regulatory (`p-tracker`), Cross-Law (`p-xlaw`), Resolutions (`p-res`, `draftRes`), Notices/Minutes (`p-docs`, `draftDoc`), Legal Opinion, SCN, Penalty Calc, NCLT Cases, Compounding, Deep Law, Checklist (`p-cl`, `genCL()` renders into `#clc` — this is the DPT-3/DIR-3-KYC list that was bleeding through earlier), Admin (`p-admin`, admin-only).

### Client data model
- `CLIENTS` = array loaded from Supabase (`loadCloudClients()`), each: `{id, name, type, fyend, capital, turnover, cin, chart}`.
  - `type`: private / public / listed / opc / sec8 / llp.
  - `chart`: per-obligation status map (done/pending).
- `getComplianceChart(company)` returns ~18 obligation rows per company, each: `{key, law, section, form, obligation, owner, due, risk, penalty, applicable}`. This is the single source of truth all three modules read from.

---

## 4. BACKEND — SUPABASE

- **Project URL:** https://sykrgryrefwjerybyubq.supabase.co  (ref `sykrgryrefwjerybyubq`, region Mumbai, FREE tier).
- **anon key** is embedded in the HTML (safe — it's the public anon key).
- **Auth:** email/password. "Confirm email" is turned OFF. The ONLY gate is **admin approval** — new users sign up, sit in a pending list, and an admin approves them. `profiles` table has `approved` + `is_admin`.
- **Tables:** `companies`, `compliance_status`, `corrections`, `profiles`, `templates` (vetted-template library: category, template_key, title, body, vetted_by). RLS on all; `is_admin_user()` security-definer function gates admin writes.
- **Edge Functions:**
  - `ai-proxy` — hides the OpenRouter key, verifies the logged-in user, calls OpenRouter chat completions. **Has a FALLBACK MODEL LIST** (tries models in order, falls to next on error) because OpenRouter free models rotate/delist constantly. Strips `<think>` reasoning tags server-side.
  - `admin-actions` — full delete via SERVICE_ROLE_KEY (deployed; HTML Delete button currently only REVOKES, not wired to hard-delete yet — optional TODO).
  - Secrets set in Supabase: `OPENROUTER_KEY`, `SERVICE_ROLE_KEY`.
- **Local Supabase project folder (Windows):** `C:\Users\NITTIN SHARMA\supabase` (contains `functions/`, `config.toml`).
- **Deploy an Edge Function:** from that folder, `supabase functions deploy ai-proxy`. (Docker warning is harmless.)

### AI backend notes (IMPORTANT, learned the hard way)
- Uses **OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`), key stored ONLY as a Supabase secret. **Never hardcode API keys** in the HTML or repo — Google/OpenRouter auto-scan and revoke them.
- **Free models churn weekly.** Any single hardcoded free model WILL break. The fix that works: a fallback list ending in the auto-router. Models seen working recently: `meta-llama/llama-3.3-70b-instruct:free`, `google/gemma-4-26b-a4b-it:free`, `nvidia/nemotron-3-super-120b-a12b:free` (good for structured output), and `openrouter/free` (auto-router, best safety-net last entry). Reasoning models (Nemotron) need `<think>` stripping — done both server-side (Edge Function) and client-side (`stripReasoning` inside `formatAI`).
- Free tier is SLOW (low-priority queue). Owner has chosen to stay free. Paid OpenRouter credits (~$10) would fix speed + reliability if ever desired.
- `callAIProxy(messages, maxTokens)` in the HTML: throws if `!supaClient || !CURRENT_USER`; POSTs to `SUPA_URL + '/functions/v1/ai-proxy'` with the session bearer token; returns `data.text`.

---

## 5. DEPLOY PROCESS

**Frontend (the app):**
1. Edit `index.html`.
2. Commit + push to the `nittinsh/lawgovern` repo (Claude Code can do this directly with git — a huge improvement over the old manual download→rename→GitHub-upload→wait-for-green→hard-refresh loop).
3. GitHub Pages rebuilds (~1–2 min). Hard-refresh (Ctrl+Shift+R) to bust cache.
4. **A `.nojekyll` file MUST exist in the repo** or GitHub Pages hangs on the build (learned the hard way). Confirm it's there.
5. Bump the header version marker each deploy to confirm what's live.

**Edge Functions:** edit `functions/ai-proxy/index.ts`, then `supabase functions deploy ai-proxy`.

---

## 6. HARD-WON LESSONS (don't repeat these)

- **Editing a 1.5 MB single file blind is error-prone.** Past bugs: a panel injected inside the wrong parent div (0×0 size), double-`await` (`await await fn()`), undefined vars after refactor (`DOC_SYS`/`RES_SYS`), white-on-white text after a theme flip (variables like `--ink` flipped meaning). Claude Code should consider splitting into separate files, or at minimum always view the surrounding context before editing and run the app to verify.
- **Windows PowerShell copy-paste mangles multi-line code.** The Edge Function got corrupted to a single line twice via paste/here-strings. The reliable method was `Copy-Item` from Downloads, or editing in an editor. Claude Code writing files directly avoids this entirely.
- **JS validation habit:** extract the main script (`html[html.rfind('<script>')+8 : html.rfind('</script>')]`) and `node --check` it before every deploy.
- **Run the suite before every deploy:** `node tests/smoke.test.js` (12 structural checks), `node tests/compliance.test.js` (151 assertions, run against `index.html` itself), `node tests/mutation.js` (24 bugs reintroduced, all caught), and `python tools/rule_audit.py` (the release gate). See `tests/README.md`.
- **No AI model auto-updates to current law.** Staying current = fetch fresh sources (RSS via rss2json/allorigins for SEBI/MCA/IBBI/RBI/IncomeTax) + human curation + (optionally) paid web-search. Vetted human templates + AI drafting is the right model.
- **Drafting quality:** resolution/notice prompts (`RES_SYS`, `DOC_SYS`) were tuned to a senior-CS standard (exact sub-section citations with read-with clauses, SEBI LODR cross-refs, full RESOLVED THAT/FURTHER THAT cascade, standard severally-authorised CS clause, Certified True Copy headers, Section 102 explanatory statements, MCA form+deadline line). There's an anti-reasoning guard telling the model to output ONLY the final document (some free models leaked their chain-of-thought). Keep these standards.
- **Child/again:** all AI legal output must carry a "verify on MCA/SEBI portal before filing" caveat — the CS signs and carries professional responsibility.

---

## 7. WHERE THINGS STAND / WHAT'S NEXT

**Header is at v163.** Phase 1 of the owner's implementation spec is complete; Phase 2 is in
progress. Migrations through `db/016` are applied. **`db/017_applicability_review.sql` is new and has not been run** — until it is, confirming an applicability condition fails with a message naming the file. `db/013` is the drop script, deliberately left commented out.

**Phase 2 — the owner's spec:**
- [x] 11. Event -> Compliance Impact Engine (section 2f)
- [x] 12. Compliance impact from board minutes (section 2g)
- [x] 13. Regulatory change impact analysis (section 2h)
- [x] 14. Applicability engine (section 2j) &mdash; built without a model
- [x] 15. Due-date reasoning (section 2k) &mdash; stage 1 done, stage 2 is data work
- [x] 16. Compliance gap analysis (section 2k) &mdash; the Exceptions module, audited and corrected
- [x] 17. "What changed / since last review" (section 2i) &mdash; built without a model
- [x] 18. Regulatory Radar impact analysis (section 2h)


**On the three remaining Phase 2 items (14, 15, 16).** All three are framed in the brief as "AI"
features, and items 11, 12, 13, 17 and 18 were all built *without* a model — each turned out to be
answerable from data the app already holds, which is both more accurate and traceable. Before
reaching for `callAIProxy` on the rest, note what already exists:

- **14. AI applicability engine** — `getComplianceChart()` already decides applicability, and
  `lgWhyApplies()` / `lgWhyNotApplies()` already explain it per rule. What is genuinely missing is a
  *review screen* over the **21 rules with unconfirmed applicability** and the ones flagged
  `needsReview`, so the gaps are visible rather than silently defaulted.
- **15. AI due-date reasoning** — `lgWhy()` already shows the due-date calculation. The real gap is
  the **29 event timings flagged `needsReview`**.
- **16. AI compliance gap analysis** — the Exceptions module (`excBuild`, `EXC_TYPES`) is this,
  already deterministic.

The owner's NOT-wanted list includes "random AI scorecards" and a "risk score that cannot explain
its calculation". A model summarising records we hold exactly is the same failure in a different
coat. Use AI where it maps free text onto the register's own vocabulary (as item 11's concept layer
does, without an API call) — not to generate conclusions the data can already support.

**Phase 3 — in progress:**
- [x] Board compliance dashboard + board-ready reports (section 2p)
- [ ] Client portal
- [ ] Information-request workflow
- [ ] Management certification
- [ ] Obligation version history
- [ ] Dependency mapping

**Standing constraints from the owner — these govern every decision:**
- *"if anything is not working it should not be there, i dont want any dummy items"*
- *"Every number on the dashboard must be traceable to an underlying record."*
- Explicitly NOT wanted: random AI scorecards, decorative charts, "AI-powered" badges, a generic
  chatbot, fake predictive graphs without historical data, too many dashboards, a document vault
  with no workflow, generic task counters, excessive colour-coded widgets, a risk score that
  cannot explain its calculation, a news feed without entity-level impact analysis.
- *"Do not force clients to upload confidential documents merely to prove compliance."*

**Open data debt:**
- 70 forms carry only name + description; 16 LODR rules and 29 event timings are `needsReview`;
  21 rules have unconfirmed applicability.
- 31 legacy variable names (`--gold`, `--ink2`, `--slate`) remain in `draftRes`/`draftDoc`/
  `renderCirculars`. Aliased correctly — naming debt only.
- **Nothing verifies against MCA or the exchanges.** MCA filing documents are paid, NSE/BSE publish
  no official API, and MCA's terms prohibit bulk collection from MCA21. `FILED` is structurally
  unreachable; everything reads "Filed — Verification Pending". **This is a purchasing decision,
  not an engineering one.**

**Running it locally:** `.claude/launch.json` is set up, or `python -m http.server 8000`. Login
needs real Supabase credentials. To exercise a render path without them, push a company onto
`CLIENTS` at runtime in the console and call `sw(...)` — but never stub around `enterApp()`, which
is exactly what hid the v7 bug.

---

## 8. QUICK REFERENCE

- Repo: `github.com/nittinsh/lawgovern` → `index.html` (+ `.nojekyll`)
- Live: `nittinsh.github.io/lawgovern`
- Supabase ref: `sykrgryrefwjerybyubq` | folder `C:\Users\NITTIN SHARMA\supabase`
- Deploy app: git commit + push. Deploy function: `supabase functions deploy ai-proxy`.
- Main data fn: `getComplianceChart(company)` → obligations. `CLIENTS` array from `loadCloudClients()`.
- Render fns: `renderCommandCenter`→`#cc-dash-root`, `renderUniverse`→`#cu-root`, `renderMyWork`→`#mw-root`, `openComplianceDetail`→`#cd-modal`.
- Never hardcode API keys. Keep the OpenRouter fallback model list. Keep the "verify on portal" caveats.
