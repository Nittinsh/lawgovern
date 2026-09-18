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

### db/018_meeting_outcomes.sql — APPLIED (confirmed by `node tests/backend.test.js`)
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

## 2m. CHARGES REGISTER (v148) — db/019 — APPLIED (confirmed by `node tests/backend.test.js`)

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

## 2n. ALLOTMENTS REGISTER (v150) — db/020 — APPLIED (confirmed by `node tests/backend.test.js`)

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

## 2o. BENEFICIAL INTEREST — sections 89 and 90 (v151) — db/021 — APPLIED (confirmed by `node tests/backend.test.js`)

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

## 2q. ADT-1 FROM THE MEETING (v155) — db/022 — APPLIED (confirmed by `node tests/backend.test.js`)

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

## 2s. RULE VERSION GOVERNANCE (v157, assessment P0) — db/023 — APPLIED (confirmed by `node tests/backend.test.js`)

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

## 2w. PIT CONTROL CENTRE (v161) — db/024 — APPLIED (confirmed by `node tests/backend.test.js`)

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

## 2z. ENTITY CLASS, AND THE REST OF THE TOOL LIST (v164)

A coverage audit against a list of tools the owner wanted matched found eleven covered, four
partly, nine not at all -- and, more importantly, **two live defects where the product asserted
wrong law against a real entity**. Those are the same failure class as the 31 March dates in
section 2k: a confident statement with nothing behind it.

### The two defects

**An LLP was told to hold four board meetings under Sec 173(1).** An LLP has no Board and no
s.173. It was receiving exactly two obligations, one of which was wrong law and the other of which
(FLA) was right by accident -- while **Form 11 and Form 8, the only two filings an LLP actually
owes, were absent entirely**. The cause: `regDerivedRows` emitted Companies Act rows for every
entity, and the generated CA corpus filtered LLPs out but the register-derived rows did not.

**A One Person Company was told to hold an annual general meeting.** s.96(1) opens *"Every company
**other than a One Person Company** shall in each year hold ... an annual general meeting"*. The
hardcoded row had `applicable:!isOPC`, but that row is superseded by the generated corpus, which
does not carry the exclusion. The guard was there and had stopped being reached.

### One place, and every exclusion cites its provision
`lgClassExclusions(c)` decides what a class does not owe; `lgClassNote(c, row)` decides what it owes
**in a different form**. Both applied in `getComplianceChart` so every screen inherits them. A
silent filter would have been the same defect wearing different clothes.

- `lgIsSmallCompany` implements s.2(85) properly, including the provisos the size test alone
  misses: **not a public company, not a holding or subsidiary company, not a s.8 company**. A
  holding company is excluded *however small its figures*. The prescribed figures (Rs 4 crore /
  Rs 40 crore) are in **Rule 2(1)(t), not in the Act text**, and the code says so where it uses them.
- `lgEntityRegime` answers which Act governs at all, and `regDerivedRows` now returns immediately
  for an LLP.
- Class notes resolve what the corpus raises and leaves open. The register says *"Annual return -
  MGT-7 / MGT-7A"* -- true for every company and therefore useless to whoever is filing. Now it
  says which, and that s.92(1)'s proviso lets the CS or a director sign. For an OPC the Board's
  report note quotes **s.134(4)**, where the Act itself narrows the report to comments on the
  auditor's qualifications.

### Three more calculators
**s.180(1)(c)** is computed outright -- capital + free reserves + securities premium, less
*"temporary loans obtained from the company's bankers in the ordinary course of business"*, which
the Explanation defines and which the screen quotes. Forgetting to exclude them is the error the
Explanation exists to prevent. Note it is a **different test from s.186**: one caps borrowing, the
other lending, and a company can be inside one and outside the other.

**Deposits** narrows the question and names the rule. The Act settles the prohibition (s.73(1)) and
the s.73(2) conditions; *what is excluded from the word "deposit" at all* is Rule 2(1)(c) and the
private-company limit is Rule 3(3), **neither in `reference/`** -- so both are named, not relied on
silently.

**LLP fees** refuses to state an amount. The slabs turn on contribution and sit in Annexure A to the
LLP Rules 2009, which is not held. It counts the delay and says why it will not price it.

### Checklists, and the mark that makes them worth having
Panel `p-checks`: Directors' Report (s.134(3)(a)-(q) + the five clauses of s.134(5)), board meeting,
general meeting, statutory audit (s.143(3)(a)-(j)), post-incorporation.

**Every item is marked `held` or `rests on a text not held`.** The Secretarial Standards are
mandatory by **s.118(10)** -- that is in the Act and is quoted -- but SS-1 and SS-2 are ICSI
documents that are not in `reference/`, so their individual requirements cannot be. A checklist that
mixes "the Act says this" with "I believe this" and marks neither is worse than no checklist,
because the reader assumes the stronger. The suite asserts that every unheld item explains what is
missing.

The Directors' Report **generator emits headings and the statutory language with every figure left
blank**. A Board's report with plausible invented numbers in it is the one thing this product must
never hand a CS to sign.

### NIC 2008 -- and the count that was wrong
Complete at section and division level, which is the whole of NIC 2008 at those two levels. The
five-digit sub-class SPICe+ wants is two levels below; the NIC booklet is not held, so those are not
listed rather than invented.

**My own test caught the claim before it shipped.** The screen said "all 99 divisions". Divisions run
01-99 **with gaps** -- there is no 04, 34, 40, 44, 48, 54, 57, 67, 76, 83 or 89 -- so the count is
**88**. The list was right; the sentence describing it was not, which is exactly the kind of
unverified number this product is not allowed to state. The suite now counts the table.

### Coverage
Suite **151 -> 212 assertions**, mutations **24 -> 32 caught, 0 missed**. Both live defects have a
mutation that puts them back.

### Still not covered, and why
- **Resume builders** -- excluded by the owner.
- **Five-digit NIC sub-classes** -- would have to be invented.
- **Full MCA fee slabs** beyond s.92 and s.137, and the LLP slabs -- in Rules not held.
- **SS-1 / SS-2 clause-level checks** -- the ICSI standards are not in `reference/`. Adding those
  two documents would make this the most complete meeting checklist in the product.

---

## 3a. ORGANISATIONS — the change that makes it sellable (v165) — db/025 — APPLIED (confirmed by `node tests/backend.test.js`)

Every table was scoped `user_id = auth.uid()`, with no org, team or firm anywhere. Two consequences:

1. **Two people in one practice could not see the same company**, so it could not be sold to
   anyone not working alone.
2. **Maker-checker could never complete.** `db/005` enforces `checker <> maker` in the database,
   but if only a row's creator can see it, no second person can ever confirm anything. The
   strongest control in the product was structurally unreachable. It was not a bug in the feature
   — the feature was correct and the visibility model made it impossible.

### The safety rule for db/025
Every policy reads **`( membership test ) OR ( user_id = auth.uid() )`**. The legacy limb is
deliberate: if the backfill misses a row, or a company ends up with a null `org_id`, the owner
still sees their own data exactly as before. **A migration that can lock the only user out of a
live compliance database is not worth any amount of tidiness.** Drop that limb later, in its own
migration, once every row is confirmed to carry an org.

The suite asserts this both ways: with no role at all `lgCanWrite()` returns **true**, and
`lgScopeToOrg` keeps rows with no `org_id` — because on a database where db/025 has not run,
every row has a null org and filtering them would empty the screen.

### One anchor, not seventeen
Only `companies` and `rule_verifications` carry `org_id`. Every register row already has
`company_id`, so its access derives from the company through `lg_see_company()` /
`lg_write_company()` rather than being duplicated across seventeen tables and kept in step by hand.

`SECURITY DEFINER` on the helpers is not optional: a policy on `org_members` that queries
`org_members` recurses forever.

### Roles
`owner` / `admin` / `member` / `viewer`. A viewer reads and never writes — and therefore
**cannot be a checker**, by construction rather than by a separate rule. Confirming a filing
records that a check was carried out; somebody who cannot change a record should not be able to
certify one. `lgGuardWrite()` sits at the top of `entSave`, `regSave`, `lgRecordSave`, `govSave`,
`entDelete` and `regDelete` — RLS refuses these anyway, so the guard exists to turn a red database
error into a sentence naming the role and where to change it.

### Invitations are by email
The person may not have an account yet. `org_invites` holds the pending row; `lg_claim_invites()`
runs on sign-in and matches on the signed-in email, so an invitation cannot be claimed by anyone
else. It is **separate from** the existing admin-approval gate: approval decides whether someone
gets in at all, membership decides what they see once they are.

### Switching reloads
Deliberately. Every cached register, chart and rendered screen belongs to the practice that was
open; re-rendering would leave one organisation's data on screen while the header named another.

### Coverage
**233 assertions** (was 212), **37 mutations caught, 0 missed** (was 32). Five of the new
mutations are access control — the 30 August assessment asked for that coverage and there was
none to write until there were roles.

---

## 3b. BACKEND CONFORMANCE (v166)

`node tests/backend.test.js` — **94 checks against the live Supabase project.**

Every other test in this repository runs the shipped JavaScript under Node with a browser shim.
**Not one of them touched Supabase.** That left tables, columns, row-level security, storage and
functions checked only by whether the app happened to work when somebody clicked something — and
db/025 had just rewritten every policy in the database.

### What it answers
| group | checks |
|---|---|
| Tables the app talks to exist | 21 |
| Every column the app reads exists | 21 tables, 180+ columns |
| Which migrations are applied, by witness column | 12 |
| RLS: an anonymous read returns nothing | 21 |
| RLS: an anonymous write is refused **by policy** | 7 |
| Storage: the evidence bucket is neither public nor listable | 2 |
| Database functions exist and refuse an anonymous caller | 7 |
| Edge Functions refuse an unauthenticated call | 4 |

### The schema is derived from the app, not typed out beside it
`registersFromApp()` reads `LG_REG` out of `index.html`, so adding a field to a register adds it to
this check automatically. A hand-maintained copy of the schema would drift, and a drift check that
drifts is worse than none.

### It is safe to run against production
No writes. Schema and RLS checks are `SELECT ... limit=0`. The write probes use payloads whose
foreign keys cannot resolve, so **a broken policy and a working one both end with nothing
inserted**. A test that would corrupt the database if it found a bug is not one anybody should run.

### It found three of its own bugs before it found anything else
The same pattern as the smoke test (§2x) and the rule audit (§2v).

1. **The write probe sent one payload to every table.** PostgREST rejected it with 400 *"could not
   find the column"* before RLS was ever consulted — six confident failures that tested nothing but
   my own payload. Per-table payloads now.
2. **A refusal by constraint was being counted as a refusal by policy.** They are not the same: one
   means RLS stopped it, the other means RLS let it through and a foreign key caught it. Now
   distinguished, and the second fails.
3. **The RPC probe sent `{}` to a two-argument function.** PostgREST matches on signature, so it
   returned *"could not find the function"* — indistinguishable from the function not existing. It
   reported `admin_set_approval` as **missing**, and it is not: with its real arguments it answers
   `P0001 Not authorized`, which is the function running and correctly refusing. **A probe that
   cannot tell a missing function from a mistyped call is checking itself, not the backend.**

### It found the documentation wrong
Eight sections of this file said `db/0NN NOT YET RUN`. **All eight were applied.** That is the class
of claim this project is not allowed to make — stated once, never re-checked, untestable by the
reader. Migration status is now identified by a column only that migration creates, which is a fact
rather than a note.

### One warning, correctly a warning
`mca-directors` is not deployed. The app already handles the 404 by naming the deploy command, and
the feature degrades to "add directors by hand". A stated limitation with a working path is not a
defect.

### What it deliberately cannot answer
Everything runs as an **anonymous** caller, which proves the doors are shut. It cannot prove the
right people get through:
- does a member of one practice see its companies
- does a member of **another** practice not see them
- is a viewer refused a write the database should refuse
- did db/025 backfill every company with an `org_id`

All four need a signed-in session, and signing in means handling a password. **These stay manual.**
The two-account maker-checker walkthrough is how they get covered, and until somebody does it, the
multi-tenant isolation this product now sells on is asserted rather than demonstrated.

---

## 3c. ACCESS CHECK — the half that needs a session (v167)

**Administration → Team → Run access check.** `lgAccessCheck(probeId)`.

`tests/backend.test.js` runs anonymously, which proves the doors are shut and cannot prove the
right people get through. The four things it names as untestable all need a signed-in session, and
a session needs a password the tooling here must never hold. So the check runs **inside the app**,
where the session already exists.

It is not a developer tool. **Any customer can run it against their own tenant** and see that
another practice's data is unreachable — which is the claim this product is now sold on and, until
this, was only asserted.

### Nine checks
Signed in · member of a practice · companies readable · **every company carries an org_id** (the
backfill question `backend.test.js` names and cannot reach) · nothing visible from a practice you
are not in · register rows belong to a company you can see · **the database agrees with the UI
about your role** · maker-checker has something to check · **cross-tenant probe**.

### The write probe, and the distinction that makes it a test
One insert, whose foreign key cannot resolve. **Nothing is written on either path** — that is what
makes it safe to ship to customers.

What it reads is *which layer refused*:
- a **viewer** must be stopped by the **policy**. Stopped by the **constraint** instead means the
  policy let the write through and a foreign key happened to catch it — so that case **fails**.
- anyone else must reach the constraint. Refused by the policy means their role is not working.

Those two errors look equally like "it didn't work". Treating them as the same would let a broken
policy report a pass, which is the one thing this check must not do.

### The cross-tenant probe needs two accounts
It is the only one that does. The screen prints your own first company id for the other account to
paste into *its* probe. If the second account can read it, isolation does not hold.
`docs/two-account-walkthrough.md` is the script, including the trap that both accounts sharing a
practice makes that row fail *correctly* — the second account has to be removed from the practice
first for the test to mean anything.

### The checker is tested even though the walkthrough is not
**12 assertions and 4 mutations.** The database is stubbed and every verdict the check can reach is
driven from a controlled answer: unanchored companies, a foreign row, an orphan register row, a
viewer refused by policy vs by constraint, a member wrongly refused, the probe both ways, and no
organisation at all. **A check nobody has watched fail is a check nobody should trust** — and this
one is a tenant-isolation proof a customer will rely on, so it earns the coverage twice over.

Suite **233 → 246**, mutations **37 → 41 caught, 0 missed**.

### Line endings cost four attempts today
Twice a shell heredoc turned `\n` inside a JavaScript string into a real newline, breaking the
file — CLAUDE.md §6's recurring failure. Then a patch script written with CRLF would not match a
target file written with LF, in the opposite direction. **Write patch scripts with the Write tool,
prefer single-line anchors, and normalise line endings on both sides before matching.**

---

## 3d. DEADLINES EXPRESSED BY REFERENCE (v168)

`LG_COMPANION` / `lgResolveCompanions`.

Section 2k left 87 obligations undated and concluded they "state no period at all". That was true
of their wording and **wrong as a conclusion**. Read again, a large group states its period
precisely — by naming another filing:

> "With the annual report" · "At the AGM" · "Along with financial results"
> "Along with relevant AOC-4 family filing" · "Certification as part of the annual return process"

Those are not vague. Each names a filing **this register already dates**. The deadline was never
missing; it was expressed by reference and nothing resolved the reference.

**Result: a listed entity goes 29 → 52 dated rows; every other class 8 → 14.** 23 obligations on a
listed company, 5–6 on the others.

### No offset is invented
Each companion takes the date of an obligation already on the chart and records which one and the
wording that ties them. If the anchor moves — a different year end, an AGM held late — every
companion moves with it, which a hand-entered offset would get wrong. The Why panel shows
**"Taken from AOC-4 (Section 137)"** with the quoted wording.

Anchors: `agm` (s.96) · `annualReport` (the AGM less 21 clear days, because Reg 36(1) sends the
report with the notice and s.101(1) requires "not less than clear twenty-one days") · `results`
(the Reg 33(3)(a) submission **for the same period**) · `annualResults` (the year-end one) ·
`aoc4` · `mgt7`.

### Three things the suite caught, all of them mine

**1. Reg 34(1)(b) must NOT be a companion.** "Not later than 48 hours after the AGM" runs from the
meeting **actually held**, which §2l takes from the meetings register. Anchoring it to the statutory
last date would report 2 October when the AGM was held on 5 September and the deadline passed on
the 7th. **An assertion written in §2l failed the moment this was added** — three sections and many
commits later. That is the distinction: *"at the AGM"* is bounded by the statutory date; *"48 hours
after it"* is not bounded by it at all. The `agmPlus2` branch was removed rather than left dead.

**2. Companions must resolve AFTER the class exclusions, not before.** Resolving first dated a One
Person Company's Board's Report to 21 days before an AGM that **s.96(1) excludes it from holding** —
the exclusion then removed the AGM row, leaving a companion carrying a date derived from a row that
is not on the chart. An anchor must still be an obligation *of this company* at the moment it is
used as one.

**3. Six companions silently failed to resolve.** The Companies Act ids carry the source
spreadsheet's row number (`CA-SECTION-137-XBRL-RULES-10`) and I had guessed them without it. A
companion that finds no anchor is **indistinguishable from one that was never mapped** — both just
stay undated, and nothing says which. The suite now counts them.

### One mutation retired, and the fragility it exposed
"A companion with no anchor gets a date anyway" cannot be caught. Removing `if(!due || !src) return`
makes the next line read `src.section` on a null, which throws; the row ends with no date and no
companion — **exactly what the guard produces**. Two mechanisms, one visible result. Recorded as a
note, same as the doubly-guarded LODR exclusion in §2x.

But the exception exposed something real: it **aborted the whole loop**, silently skipping every
companion after the failing row. The same shape as `updateMode()` aborting `enterApp()` in §2. Each
row is now resolved inside its own guard, and `LG_COMPANION_STATS` records failures so a partial run
is visible rather than silent.

### What is still undated, and why — this is now the honest remainder
Of the 96 rules with no offset:
- **~23 resolved here** by reference.
- **~9 are event-anchored** to a register (§2l, §2m, §2n, §2o) and correctly undated until the event
  is recorded.
- **The rest divide into three kinds that are not deadlines at all**, and should stop being counted
  as missing ones:
  - **Continuous** — "Ongoing", "Continuous", "Prior to the transaction". `STANDING` is correct.
  - **Applicability tests** — "Test thresholds each FY", "Reassess before relying on any exemption".
    These are reviews, not filings.
  - **Specified by SEBI** — Reg 13(3), 27(2)(a), 14, 91C/91E say the form and timeline are as SEBI
    specifies, and **we do not hold the circular**. Correctly undated with a reason.

---

## 3e. "AS SPECIFIED BY SEBI", READ AGAINST THE TEXT (v169)

§3d parked a group of obligations as *"SEBI specifies the timeline by circular, and we do not hold
the circular"*. The held LODR compilation is **amended to 14 July 2026**, so that could be checked
rather than assumed. Three outcomes, and the middle one is the point of the exercise.

### 1. A bug §3d introduced, found by reading the regulation
**Reg 27(2)(ba)** — cyber-security incidents — is disclosed *"along with the report mentioned in
clause (a) of sub-regulation (2)"*. **Clause (a) has no date.** §3d read the rule's note "along with
the quarterly CG report", found the CG report undated, and anchored it to the **financial results**
instead. That gives a disclosure a date its own anchor does not have. Removed; four rows lost a
date they should never have had.

### 2. The periods were AMENDED AWAY — and saying so is the deliverable
Both of these required **twenty-one days from the quarter end** until the **Third Amendment 2024
substituted them with effect from 31 December 2024**:

| | now reads |
|---|---|
| **Reg 13(3)** | statement of grievance redressal *"in such form and **within the timelines as may be specified by the Board**"* |
| **Reg 27(2)(a)** | corporate governance report *"in the format and **within the timelines, as may be specified by the Board** from time to time"* |

So the owner's spreadsheet was right and the app was right to leave them undated. **But a Company
Secretary working from memory still reaches for twenty-one days**, and a blank cell does not correct
them. `LG_NO_DEADLINE_WHY` now states which amendment removed the period and what it used to be.

**Read the footnotes.** Both periods appear in this compilation as quoted text — inside a footnote
recording the wording *prior to* substitution. Taking either at face value would have reinstated a
period deleted eighteen months ago, sourced to the current text.

### 3. One is recoverable, and the corpus predates it
**Reg 91C(1)** was **substituted with effect from 8 September 2025** and now states real periods:
- **(ii) non-financial** — "within a period of 60 days from the end of the financial year"
- **(i) financial** — "by October 31st of each year or before the due date of filing of income tax
  return ..., **whichever is later**"

The rule data still carries the pre-amendment *"within the timelines specified by SEBI"*. The
60-day limb goes into `LG_DUE_PATCH` — the mechanism §2k already has, rather than a second one
beside it. The financial limb is **not** dated: "whichever is later" needs the income-tax return
due date, which comes from an Act not held, so the row says that instead of asserting 31 October.

### `LG_NO_DEADLINE_WHY` — a blank is not an explanation
"Deadline not established" reads identically for a continuous duty, an annual applicability test,
and a period deleted from the regulation. **Those are different facts.** Thirty rows on a listed
entity now say which, in the Why panel, and the suite asserts an explanation can only ever attach to
a row that genuinely has no date.

### The mutation that needed the contract tested directly
"An explanation is offered for a row that already has a date" passed against the bug, because none
of the mapped keys happens to be dated — sweeping the real rows could not see it. The assertion now
calls `lgNoDeadlineWhy` with a **constructed** row: a mapped key *with* a date must get nothing, the
same key *without* one must still get its explanation. **When the data cannot exercise a guard, test
the guard's contract rather than the data.**

Suite **271 → 288**, mutations **44 → 46 caught, 0 missed**.

---

## 3f. THE MASTER CIRCULAR — where the period went (v170)

§3e concluded that Reg 13(3) and Reg 27(2)(a) have no date because the Third Amendment 2024
replaced their twenty-one days with *"as may be specified by the Board"*. Right as far as it went,
and **one step short**. The Board has specified.

SEBI's **Master Circular for LODR compliance, 30 January 2026** — now in
`reference/sebi-lodr-master-circular/` — introduces **Integrated Filing** under Reg 10(1A) for
filings "for the quarter ending 31st December 2024 and thereafter", and sets the periods in a table:

| filing | regulations | period |
|---|---|---|
| **Integrated Filing (Governance)** | 13(3), 27(2)(a) | **within 30 days** of the quarter end |
| **Integrated Filing (Financial)** | 23(9), 30 r/w V-B, 32(1), 33(3) | **within 45 days**, and 60 from the last quarter and the financial year |

**The twenty-one days did not disappear. It became thirty, in a different instrument, under a filing
that did not exist before.** A blank cell said nothing about that, and a CS reading "as specified by
the Board" had nowhere to go.

**Listed entity: 49 → 65 dated rows.** Reg 13(3), 27(2)(a), 27(2)(ba) each gain four quarterly dates
at 30 days; Reg 32(1) four at 45.

### The lesson worth carrying: a delegating regulation is a pointer, not a dead end
LODR increasingly delegates. Read only the regulation and these look undatable. **When a provision
says "as specified by the Board", the circular is where the number went** — go and find it.

### Getting the document
The page is an index; the PDF is behind a JS-rendered viewer. Its URL is in an `iframe` `src`, found
by reading the page in the browser pane, not by fetching it. 291 pages, 4.3 MB.

**A hand-rolled extractor was tried first and must not be repeated.** It produced 26K chars of
fragments from 291 pages: only **12 of the 42 embedded fonts carry a ToUnicode map**, and **62 object
streams are compressed** beyond a regex's reach. A partial extraction here is worse than none —
searching it for a period and not finding one proves nothing. `pip install pypdf` gave 611K chars of
clean text in one line. Recorded in `reference/README.md`.

### Reading it needs the same care as the regulation
The one competing figure in the circular — *"within fifteen days of end of the quarter"* — is
**Reg 69(1), the IDR holding pattern**, and unrelated. Taking the first number that matched a search
would have put fifteen days on the corporate governance report. Same class of trap as the §3e
footnotes: the text contains periods that are real, current, and about something else.

### Coverage
Suite **288 → 299**, mutations **46 → 49 caught, 0 missed**. The mutations swap the Governance and
Financial periods, because 30 and 45 are both entirely plausible and being a fortnight wrong in
either direction is the hardest kind of error to see.

Three assertions written in §2k and §3e had to be repointed — they used Reg 13(3) and Reg 27(2)(ba)
as examples of *undated* rules, and both are dated now. **The examples moved; the properties they
test did not.** Reg 17(3) ("periodically", no interval fixed) is the undated example now.

---

## 3g. THE COMPANIES ACT ENTERS THE AUDIT (v170)

`python tools/rule_audit.py` checked **273 SEBI citations and zero Companies Act ones**. Fifty-four
rules, every calculator and every checklist rest on that Act, and nothing had ever verified that the
sections they cite exist.

**Now 327 rules checked, 299 citations resolved, none unresolved.** The Act text yields **497
numbered provisions**, and every section the corpus cites is in it.

### An Act is not a regulation, and the parser has to know
`sections_present` / `cited_sections` sit beside the regulation pair. Two differences that matter:
- The corpus writes citations several ways — `Section 92`, `Sections 12, 15`, `Sec 173(1)`,
  `Sections 77-87`. A **range is expanded to its endpoints only**: asserting that every number
  between them is a real section would invent citations the rule never made.
- An amended heading carries its footnote marker *before* the number — `3[185. Loans to directors`.
  Requiring the number at a line start would have read s.185 as absent from a text that contains it
  in full. Same trap as Reg 91C in §2v, mirrored.

### Companies Act misses do not block, and that is deliberate
The held Act is amended only to **01.04.2021**. A section it does not contain has **two possible
causes and this audit cannot separate them**: a wrong citation, or a provision inserted since. So
they get their own counter and never fail the gate.

Blocking on them would fail every release over a five-year-old PDF, and the first thing anyone would
do is stop running the gate — the same reasoning that keeps "schedule-derived" non-blocking (§2x).

What it produces instead is what was missing: **a specific, per-rule list of what the 2021 text
cannot confirm.** "The Act is stale" was a caveat nobody could act on. A list of section numbers is
a worklist for the day a current Act reaches `reference/`. Today that list is **empty** — every
cited section resolves.

### The ten with no citation are correct
`Companies (Accounts) Rules`, `PAS Rules 9A/9B`, `Rule 12A`, `Governance control`. They cite
**Rules, not sections**, and a Rule is not in the Act. None of those Rules is in `reference/` —
already recorded in §2c and §2n.

### Getting a current Act — four routes, all closed
- **India Code (old domain)** — migrated; every bitstream URL returns the Angular app shell.
- **India Code (new domain)** — DSpace 9.1 REST API answers, but handle `123456789/2114` is a 404
  after the migration and the search index surfaces only circulars and notifications, not the Act.
- **MCA in the browser pane** — navigation denied.
- **MCA via fetch** — HTTP 403.

**Not guessed at.** The candidate PDFs include the original 2013 gazette, and downloading that would
replace a 2021 text with a 2013 one — making every citation *worse*. The whole value depends on the
replacement being newer, so an unverified download is not a partial win, it is a regression.

**This needs one action that is not mine:** a consolidated Companies Act with amendments
incorporated, saved into `reference/companies-act-2013/`, extracted with `pypdf` as §3f records.
The audit then covers it with no further work.

---

## 3h. EXPORT (v171) — and why billing was not built

**Administration → Settings → Export your data.**

There was one CSV of one table. Thirty companies' registers, filing evidence, applicability
decisions and rule sign-offs could go in and never come out. That is the owner's own record of
client compliance, and it mattered **before** a customer existed, not after.

### The property under test is not "a file comes out"
It is that **a table which fails to read shows up as a failure.** An export that quietly drops a
table looks exactly like a complete one, and somebody keeps it as their backup.

So: every table is **counted in the file and on the screen**, a failed table is counted as `null`
(unknown) rather than `0` (empty), its error is written **into** the file rather than skipped, and
the panel says how many could not be read. A silent drop shows as a missing row in a table of
sixteen.

### It says what it is not
Named at the top of the file and on the screen:
- **the evidence documents themselves** — they are files in Storage, not rows. Their paths are
  included so they can be found; the PDFs are not in the file.
- **the rule corpus** — it ships inside the app, not the database. This is your data, not the law.
- **anything RLS hides from you** — an export can only hold what your own account can read.

### There is no import, deliberately
This is a record and a hand-off format, not a restore button. Writing rows back into a live
compliance database from a file, with nobody reading it first, is not something this should offer.

### A slip fixed on the way past
`cuExport` named its file with `toISOString()` — **§2b**, which in IST names it for *yesterday*. A
small lie, and a bad one to find on a backup. `expStamp()` builds from local parts and the suite
asserts it.

### Billing was NOT built, and that is not me narrowing the ask
A working billing integration needs three things only the owner has: **the pricing model**
(per company? per user? flat?), **the provider** (Razorpay, for an Indian merchant), and
**merchant credentials**. Without them what ships is a billing screen that takes no money — the
"dummy item" the standing constraints ban outright.

It is also the wrong order. Billing before a customer is speculative work; export is useful the day
thirty companies go in. Say the model and the provider and it is a short job.

Suite **299 → 312**, mutations **49 → 52 caught, 0 missed**.

---

## 3i. BACK-TEST (v172) — the first run against real entities

**Administration → Back-test.** `lgBackTest()`.

The owner put two real companies in — one listed, one unlisted — and asked for deep back-testing.
Row-level security means nothing outside their session can see that data, so the audit runs inside
the app, as `lgAccessCheck` does (§3c).

### It reports disagreements, not figures
Not another dashboard. **Each check computes something two different ways, or tests a claim against
its stated basis, and says nothing unless they differ.** A clean run prints what it checked and
that is all.

| kind | what it looks for |
|---|---|
| **RECONCILE** | the same number two ways — dashboard vs register, state legend vs total, duplicate keys |
| **BASIS** | no date without a traceable source; nothing claims compliance without evidence; no undated row in a date-driven state |
| **CLASS** | the right law for the entity — LLP, OPC, listed-only SEBI, and **the CIN against the type** |
| **CONTRADICT** | a row with a date *and* an explanation for having none; a companion with no date |
| **DATA** | what the entity record is missing, and **which statutory limbs cannot be evaluated because of it** |

### One assertion turns every existing mutation into a back-test
`compliance.test.js` asserts the back-test reports **zero defects on clean entities**. So any
mutation in `mutation.js` that introduces a defect is caught by the back-test as well as by whatever
assertion targets it directly — **a second, independent net over the same engines.** Verified by
reintroducing the §2z LLP bug: with no assertion aimed at it, the back-test reports
*"An LLP is being given Companies Act obligations — e.g. Sec 173(1)"* on its own.

### The first run found two things
**1. Mine.** The traceability check accepted `exact` and `companion` but not **`stated`**, which is
what the LLP rows carry. Three correctly-sourced rows were reported as unsourced. **A check that
cries wolf gets ignored** — the same lesson as the smoke test reporting the login button missing
(§2x).

**2. Real.** The **FLA return is dated 15 July on every entity in the book and nothing on the row
said why.** The date is right; the row could not prove it. That is exactly the standard §2k held
everything else to when it removed 63 dates — and this one survived because it is **hardcoded rather
than generated**, so no audit had ever looked at it. It now carries its source, and states that the
RBI Master Direction is **not in `reference/`**, so the date rests on the owner's knowledge rather
than a held text.

### The DATA findings are the ones real entities make possible
On an invented company every field is filled and this class of finding cannot occur. On a real
record it is the whole point:
- **s.135 CSR net worth and net profit limbs cannot be evaluated** — and a blank is **skipped, not
  passed** (§2c). The net-profit limb is the one most likely to catch a real client.
- **Every register is empty** — obligations that run from a charge, an allotment or a meeting cannot
  be dated, and an empty register is not the same as nothing having happened (§2w).
- **No results board meeting recorded** — so the PIT trading window rests on the quarter end alone
  and Reg 47(1) has no date.

Those are not defects and are not reported as such. Calling a missing optional column a defect would
cry wolf on every real record.

### What it says it cannot check
Whether a rule states the law correctly — only reading the provision does that, and Rule Governance
is where it gets recorded. Whether a filing was actually made — nothing here reaches MCA21. And
anything depending on data not yet entered, which is what the gaps are for.

Suite **312 → 322**, mutations 52, 0 missed.

---

## 3j. WHAT THE FIRST REAL BACK-TEST FOUND (v173)

The owner ran §3i against their two real companies. **0 defects, 7 gaps** — and one of those "gaps"
was the most important finding this project has had since §2k.

### Both companies have NO financial year end, and the engine assumed one
`getComplianceChart` defaults to 31 March when `fyend` is absent. Verified: with `fyend` null it
produces **AGM 30 September and AOC-4 30 October — byte for byte the dates a 31 March company
gets**, with nothing on screen saying an assumption was made. **79 dated obligations across the two
entities (14 + 65) rested on a year end nobody entered.**

**A missing net worth and a missing year end are not the same kind of thing**, and only real data
made the difference visible:

| | what the engine does |
|---|---|
| missing **net worth** | the s.135 limb is **SKIPPED**. It abstains, and §2c says so out loud |
| missing **year end** | it **ASSUMES 31 March and carries on**, producing dates that look computed |

One abstains. The other guesses. That is the §2k defect class exactly — a date that looks like a
date with nothing behind it — and the back-test had filed it beside the harmless one.

**For an Indian company 31 March is usually right, which is precisely what makes it dangerous.** It
is right often enough that the one client with a December year end gets a silently wrong calendar
and no warning at all.

Now: every row derived from an assumed year end carries `fyAssumed`, the Why panel says so in
amber, and the back-test reports it as a **defect**.

### A second finding, from reading the December case
Chasing that turned up a disagreement the back-test could not see:

```
Section 96  (AGM)     due 2026-06-30   period end 2025-12-31   <- overdue
Section 137 (AOC-4)   due 2027-07-30   period end 2027-06-30
Section 92  (MGT-7)   due 2027-08-29   period end 2027-06-30
```

AOC-4 is *"within thirty days of the AGM"* and MGT-7 *"within sixty"*. **Both are computed from a
LATER AGM than the AGM row on the same chart.** So the register says the annual general meeting is
overdue and, in the next row, that the filing which follows it is not due for another thirteen
months. A CS reading that has a year in hand on a filing already late.

**It does not arise for a 31 March company**, whose AGM is still ahead — which is why it survived:
every test entity in this project has had a March year end. Real data with a different one is the
only thing that would ever have shown it.

### Reported, not silently repaired
The arithmetic that rolls an annual obligation to its next occurrence is shared by every annual
rule, and the 31 March path is correct today. **Changing it from here would be guessing at a fix
that could break the common case to mend the uncommon one.** So the back-test now sees it, names
both rows and the gap between them, and the owner decides — the same treatment §2v gives a period
mismatch.

The check is deliberately generous: a quarter's window. Anything beyond that is not an offset, it is
a different AGM. Verified to fire on 31 December and **not** on 31 March or 30 June.

### The lesson
**Every synthetic entity in this project had a March year end and every field filled.** Two real
companies, entered by hand and incomplete in the ordinary way, surfaced two defects in one run —
one of which had been shipping since the register was built.

Suite **322 → 330**, mutations **52 → 56 caught, 0 missed**.

---

## 3k. WHICH FINANCIAL YEAR AM I LOOKING AT (v174)

The owner, working with two real companies: *"there should be an option to set financial year as
this taking data for past years also which is not relevant."*

Measured before building anything. For a 31 March company on 7 September 2026:

| period end | rows | |
|---|---|---|
| 31 Mar 2026 | 18 | the year that **CLOSED** — AGM, AOC-4, MGT-7, ADT-1 |
| 30 Sep 2026 | 2 | inside the year in progress |
| *(none)* | 33 | continuous — belong to no year |

Correct as far as it went — in September a CS **is** working on last year's annual filings — but
there was no way to ask for one year, and the closed year and the open one were one undifferentiated
list. On a listed entity it is 237 rows across two years and four quarters.

### Filtered by the period it RELATES TO, never by the due date
AOC-4 for the year ended 31 March 2026 is **due 30 October 2026** and belongs to **2025-26**.
Filtering on the deadline would file it under the year it lands in, beside quarterlies it has
nothing to do with.

### A continuous obligation belongs to no year and always shows
Thirty-three of fifty-three rows have no period end — *"maintain the registered office"*, *"prior to
the transaction"*. Hiding those behind a year would mean **choosing a year silently switched off
duties that never stop applying.** They stay, and a mutation checks they cannot be filtered out.

### The selector is in the header, and lists the UNION
A filtered register that looks like the whole one is the same defect as a date with nothing behind
it, so the control that filtered it is visible from every screen. `allYears` bypasses the filter
because `lgFyList` needs the whole register — **a filter that hid years from its own selector could
never be turned off again**, and there is a mutation for that too.

First cut built the list from `CLIENTS[0]` alone, which offered 2025-26 only while the listed
company also spanned 2026-27 — a year that existed and could not be selected. Now the union.

### And a self-inflicted one, caught immediately
Inserting the selector's build step into the login chain added a **second `loadCloudClients()`**,
fetching every company twice on login. Caught by reading the chain back rather than by anything
failing — it worked perfectly, just twice.

---

## 3l. AN AGM-ANCHORED FILING REPORTS ON THE YEAR, NOT THE MEETING (v174)

Adding the year filter exposed a bug that had been shipping since the register was built.

`agm_offset` set `periodEnd` to **the AGM date itself**. So AOC-4 and MGT-7 carried period end
**30 September 2026** — the date of the meeting — when what they report on is the year ended
**31 March 2026**.

**Their own companions had it right.** XBRL and MGT-8 take the financial year end, because §3d
resolves a companion from the parent's *date* and not its *period*. Parents wrong, children right,
in adjacent rows.

```
Section 96   (AGM)      periodEnd 2026-03-31   ✓
Section 137  (AOC-4)    periodEnd 2026-09-30   ✗   <- the AGM date
Section 137  (XBRL)     periodEnd 2026-03-31   ✓   <- its own companion
Section 92   (MGT-7)    periodEnd 2026-09-30   ✗
Section 92(2)(MGT-8)    periodEnd 2026-03-31   ✓   <- its own companion
```

**It was harmless until `periodEnd` started deciding which year a row belongs to.** Nothing read it
for these rows, so being wrong cost nothing. The moment a year filter existed, **choosing 2025-26
hid the annual return and the financial statements for 2025-26** — the two filings that year is
mostly about.

The due date is untouched: still the AGM plus the offset, which is what the Act says. Only the year
the row is **filed under** changed.

### Three assertions had to be rewritten, and all three were asserting the bug
"Choosing a year removes rows" — after the fix a private company's whole annual cycle sits in **one**
year, so selecting it keeps everything. "The year list has at least two years" — likewise. Both were
really asserting that the annual filings were scattered across two years, which was the defect.
**An assertion written against broken behaviour passes for the wrong reason and fails when it is
fixed.**

Suite **330 → 350**, mutations **56 → 61 caught, 0 missed**.

---

## 3m. THE FEE WAS NOT THE LIABILITY (v175)

Three criticisms of the late-filing calculator, from the owner, and all three
are the same defect: **it computed one liability out of two.**

> "why there is only two forms and in any other form there is nothing in this due
> date should be automatically be there and in penalty part understand the law
> act rules carefully somewhere it has also written subject to max amount"

The card was headed **"Additional fee"**, the working was `days x 100`, and the
tab was called "Late filing fee". A CS would have read that figure to a director
and been believed.

| | provision | the words | maximum |
|---|---|---|---|
| **FEE** | s.403(1), first proviso | "not less than one hundred rupees per day" &mdash; **s.92 and s.137 only** | **none stated** |
| **PENALTY** | s.92(5), s.137(3), s.117(2)&hellip; | "ten thousand rupees and&hellip; a further penalty of one hundred rupees" | **stated, and it is what the owner spotted** |

**s.403(2) settles it in terms.** The company and its officers are liable for the
penalty *"without prejudice to the liability for the payment of fee and additional
fee"*. The Act itself insists they are two liabilities; the screen had folded them
into one. On MGT-7 filed 78 days late that is Rs 7,800 shown against Rs 7,800 of
fee **plus Rs 17,700 on the company plus Rs 17,700 on every officer in default**.

### The other two criticisms fall out of the same fix
- **"only two forms"** &mdash; because only two forms have a *fee* the Act states.
  Twelve now have a *penalty* it states, so twelve answer. The fee still refuses
  to guess: the slabs are in the Companies (Registration Offices and Fees) Rules,
  which are not in `reference/`.
- **"the due date should automatically be there"** &mdash; the register already
  computed it. `calc403DueOptions` reads it back, matched on the **section**,
  which is what the register displays and therefore what the reader can check.

### The one-day trap, inside one sub-section
**s.137(3) uses both counts.** The company pays a further penalty *"for each day
**during which** such failure continues"*; the MD and CFO pay *"for each day
**after the first**"*. A uniform implementation is wrong by a day's penalty on
one of the two legs, every time. Each leg carries the count its own provision
states, and 108 days late reads Rs 20,800 against Rs 20,700 on screen.

### Three shapes, because the Act uses three
Flattening them into one "amount" column would report a court's discretion and an
arithmetic result as if they were the same claim.
- **continuing penalty** &mdash; base + daily rate, capped. The common case.
- **flat** &mdash; s.86(1), charges: Rs 5 lakh on the company and Rs 50,000 on
  every officer, **the same on day one as on day three hundred**, and no maximum
  because it does not accrue. It is also the largest figure on the screen.
- **fine** &mdash; s.147(1), ADT-1: *punishable with fine* of Rs 25,000 to Rs 5
  lakh, imposed by a court. **No amount inside that range is calculable from a
  number of days**, so the range is shown and a figure is not.

`s.450` is offered for anything else and **says it is a residual** &mdash; it
applies only where the Act fixes no penalty elsewhere, and read as the answer it
would price a form whose own section says something different.

### What the mutation check found that the assertions could not
**"MGT-7 also matches s.92(2)"** was MISSED. s.92(2) is the *MGT-8 certification*,
not the annual return &mdash; and it falls due **on the same day**, so the option
list deduplicated the wrongly-matched row away and the broken build produced
output identical to the correct one. The guard worked; nothing could see it work.

Two changes, and both are the general lesson:
1. **Test the guard's contract, not the data** (the §3e rule again) &mdash; the
   matcher is now asserted directly against the section strings the register
   emits, including the ones it must reject.
2. **A dedupe must count what it swallows.** Rows sharing a due date still
   collapse to one option, but the option says `+1 more on this date`. A silent
   dedupe is how a wrong row hides inside a right one.

### Coverage
Suite **350 -> 406**, mutations **52 -> 73 caught, 0 missed, 0 skipped**. One
older mutation retired: *"s.403 prices a form whose fee rules are not held"*
tested `f[3]` on the old array shape and is superseded by a mutation that gives
the residual form a fee outright.

Four existing assertions were repointed (`F.fee` is an object now, beside `F.pen`);
one changed its **meaning** and that is the deliverable &mdash; *"any other form is
refused rather than guessed at"* used to assert nothing came back at all.
Refusing the **fee** is still right; refusing the **penalty** was the bug. It
asserts both halves now, because asserting only the first is what let it stand.

### Stated on screen, not assumed
Every penalty quotes its own provision verbatim (the suite refuses one that does
not), the due date says whether it came from the register or from the keyboard,
a date resting on an assumed year end carries the §3j warning through to this
screen, and the Act in `reference/` is **amended only to 01.04.2021** &mdash; said
on the card, not only in this file.

---

## 3n. THE QUALITY AUDIT, AND THE TWO TABLES IT FOUND (v176)

A full audit before pitching the product as a prototype. **Every gate green, all
40 screens driven with zero console errors, only the anon key in the file, 2 dead
functions out of 545.** And then the actual finding, which no gate could have
caught because it was not in the engines at all.

### The same figures lived in three places, and two were quoting repealed law

| | source | audited? |
|---|---|---|
| `CALC_FEE_FORMS` (§3m) | quoted verbatim from the Act in `reference/` | yes &mdash; cited on screen, 56 assertions |
| `rules/forms_master.json` &rarr; **Penalties screen** | a free-text string per form | **no source, no date** |
| the chat&rsquo;s offline **QA bank** | 29 answers, 75 rupee figures | **no source, no caveat** |

**Of the nine forms the first two both described, all nine disagreed, and the
screen was wrong every time.**

```
AOC-4, the screen   "Rs.1,000/day (max Rs.10 Lakh per document)"
s.137(3), the Act    Rs.10,000 + Rs.100/day, max Rs.2 lakh
```

That string is **word for word the old s.137(3)** &mdash; the wording the
Companies (Amendment) Act 2020 replaced with effect from **21 December 2020**.
Ten times the daily rate and five times the maximum, on the commonest filing
there is. CHG-1 was the same story (Rs.5,000 + Rs.500/day where s.86(1) now says
**Rs.5,00,000 flat**).

**And the chat contradicted the register outright.** The register carries
*&ldquo;MGT-8 certification applicability&rdquo;* as a live obligation dated
29 November 2026; the chat said *&ldquo;MGT-8 &mdash; ABOLISHED from July 14,
2025&rdquo;*. Same product, opposite answers, on a question a CS acts on.

### The fix is architectural, because arithmetic would only reset the clock
Correcting the numbers in two more places leaves three copies to drift again, and
drift is exactly what happened over five years. §2r&rsquo;s rule applies: **one
feature, one authoritative implementation.**

- `lgPenaltyFor` / `lgPenaltyLegText` &mdash; the Penalties screen **reads
  `CALC_FEE_FORMS`**. Every row shows both legs and cites its sub-section.
  Verified rows went 0 &rarr; **17**; the 9 the Act does not settle here say
  **&ldquo;not verified &mdash; from the forms spreadsheet, not from a text held
  here&rdquo;** rather than being hidden or dressed up as law.
- The **chat bank states no penalty figure at all** now. It has no way to cite
  anything, so it must not be a second source; it points at the screen that can.
- **MGT-8 is reported, not decided.** The abolition would post-date the Act text
  held here, so nothing in this project can settle it &mdash; §3j&rsquo;s rule.

### Three shapes, and the screen has to keep them apart
`lgPenaltyLegText` renders a continuing penalty with its maximum, s.86(1)&rsquo;s
**flat** amount as *&ldquo;fixed, it does not grow by the day&rdquo;*, and
s.147(1)&rsquo;s **fine** as a range *&ldquo;fixed by a court&rdquo;*. Flattening
a court&rsquo;s discretion and an arithmetic result into one cell is the same
error §3m avoided in the calculator.

### The AI call could hang for ever, and never read the status
Nine call sites, **no timeout on any of them**, and `res.json()` ran whether the
response was 200 or 502 &mdash; so a gateway error surfaced as
`Unexpected token '<'` and an expired session read the same way. The one error
the code did handle was the only one unreachable when the call actually failed.

`LG_AI_TIMEOUT_MS` (45s) + `AbortController`, `res.ok` checked **before**
parsing, 401 and 404 named, and every failure says what still works without it
&mdash; the register, the calculators and the checklists need no AI at all.

### Three bugs in the new work, all found by driving it
- **A mutation went MISSED**: blanking `lgPenaltyFor` inside `renderPenalties`
  changed nothing, because every assertion called the engine **directly**. The
  §2j shape exactly &mdash; a value computed correctly that reaches no screen.
  And a presence check still passed, because `lgPenaltyFor` also appears in the
  row filter. **Counted, not tested for presence.**
- **An assertion matched my own comment.** `res.ok is tested BEFORE res.json` read
  the raw slice, and the comment explaining the bug names `res.json()` several
  lines above the call. Comments are stripped before the ordering check now:
  *an assertion that prose can satisfy is not testing code.*
- **The new column was clipped and unreachable.** Six columns pushed the table to
  1394px inside a 988px wrapper whose `overflow-x` is **hidden** above 900px.
  The citation column simply was not there, and the page looked fine. §2j again.
  Merged to five columns; `.pen-tablewrap` scrolls on its own rather than
  changing shared behaviour for one screen &mdash; and the first attempt at that
  rule **landed inside `@media(min-width:641px) and (max-width:900px)`**, so it
  was inert at exactly the width that needed it.

### Measured, and worth keeping
- **30 companies = 2,122 obligation rows, ~40,000 DOM nodes, a page 221,000px
  tall, 1.36s through layout on a desktop.** Every test in this project uses one
  or two entities. Not fixed here; the Universe says *&ldquo;Showing 2122 of
  2122&rdquo;*, so it is honest, but it is the next performance job.
- Load 571ms local, 3 external requests, no horizontal overflow at 375px.
- **No `<main>`/`<nav>` landmarks and ~45 unlabelled form fields** &mdash;
  screen-reader navigation is the weakest dimension in the product.

### Coverage
Suite **406 &rarr; 435**, mutations **73 &rarr; 85 caught, 0 missed, 0 skipped**.
The chat-bank assertion reads the shipped file and refuses to let a penalty
figure back in: three copies is what let two of them go stale for five years, and
correcting the numbers without closing the door would just restart the clock.

---

## 3o. THE REGISTER IS PAGED (v177)

§3n measured the owner&rsquo;s real book &mdash; thirty companies &mdash; and found
one screen an order of magnitude worse than every other:

| panel | rows | DOM nodes | height | through layout |
|---|---|---|---|---|
| **universe** | **2,122** | **39,890** | **221,033 px** | **1,360 ms** |
| cal | &mdash; | 3,487 | 23,127 px | 68 ms |
| mywork | &mdash; | 1,693 | 9,268 px | 115 ms |
| home | &mdash; | 338 | 1,755 px | 174 ms |

A page 221 metres long, and 1.36 seconds through layout **on a desktop**.

### It was never the computation
`cuBuildRows()` takes **25 ms** for all thirty companies and `getComplianceChart`
is **1 ms** each. The cost was building 2,122 rows of HTML and asking the browser
to lay out forty thousand nodes &mdash; so the fix is to render fewer rows.
**No cache was introduced**, and it would have bought nothing here anyway: a
stale compliance register is a worse defect than a slow one.

### Filtered, not truncated
A hundred rows a page. The register is not a document to scroll; it is a thing to
filter, and with any filter applied most results are one page.

**The footer states the page and the true total in one sentence** &mdash;
*&ldquo;Rows 1&ndash;100 of 2122 matching &middot; 2122 obligations on the
register&rdquo;*. A page that reads as the whole register is the §3k defect
exactly: a filter that does not say it filtered. **&ldquo;All rows&rdquo; stays
on the menu**, because someone may genuinely want to search the page or print
it &mdash; choosing it is the reader&rsquo;s decision; doing it by default was
one the product made for them, thirty times over.

| | before | after |
|---|---|---|
| through layout, warm | 1,360 ms | **26&ndash;30 ms** |
| DOM nodes | 39,890 | **1,990** |
| page height | 221,033 px | **17,297 px** |
| all 2,122 rows, by choice | &mdash; | 406 ms |

**~48x**, and the honest comparison is like-for-like warm renders at 1280px.

### The clamp is the part with the risk, so it is pure
`cuPageSlice(rows, page, size)` is a pure function, because the slice is trivial
and the **clamping** is not: a filter can shrink the result while the reader sits
on page 22, and landing on an empty table would say *&ldquo;nothing
matches&rdquo;* about a register that matched forty things. §2y&rsquo;s rule
&mdash; a calculation reachable only through a form is one nobody can test.

Everything that changes **which** rows match returns to page 1. Sorting counts:
page 5 of one order has nothing to do with page 5 of another.

### A rebuild nobody used
```js
function cuSetFilter(k,v){ CU_FILTERS[k]=v; if(k==='q'){
    var all=cuBuildRows(); renderUniverse();     // assigned, never read
```
`all` was discarded and `renderUniverse` built the same 2,122 rows again, so
**every keystroke in the search box built the register twice**. Three keystrokes
now cost 78 ms in total.

### Three things the mutation check found, all in the new work
- **The clamp assertion was too weak.** Every case sat *far* past the end, where
  `>=` and `>` both fire. The off-by-one only shows at exactly one page past the
  end &mdash; page 3 of 3 &mdash; which is where a reader actually lands.
- **`fnOf` ran past a one-liner.** `cuClear` is a single line, so slicing to
  `\n}` swept up `cuSort`, which has a `cuPageReset()` of its own &mdash; so
  removing `cuClear`&rsquo;s changed nothing the assertion could see.
- **An assertion matched a comment again.** Second time in two sessions; `fnOf`
  strips comments now. *Prose must not be able to satisfy an assertion about
  code.*

### Measured and deliberately left
- **The dashboard builds every chart five times** &mdash; 150 calls to
  `getComplianceChart` for thirty companies where 30 would do, worth ~150 ms.
  There are **35 call sites** across the app, so threading the charts through as
  parameters is a large refactor, and the cheap alternative is a cache that could
  serve a stale register. 174 ms on a panel switch is not worth that trade.
- **Board reported 2.4&ndash;2.9 s in the browser pane and 18&ndash;31 ms in
  isolation, for 183 nodes.** 183 nodes cannot take two seconds; the large
  readings are pane artifacts. **Recorded rather than chased** &mdash; and worth
  remembering that this pane&rsquo;s timings are unreliable when it is hidden
  (`window.innerWidth` reads 0, which also puts measurements in the &lt;640px
  branch).

### Coverage
Suite **435 &rarr; 472**, mutations **85 &rarr; 98 caught, 0 missed, 0 skipped**.

---

## 3p. ONE RENDER, ONE CHART PER COMPANY (v178)

§3o measured this and left it. Instrumented in the browser &mdash; thirty
companies, one `sw('home')`:

| caller | builds |
|---|---|
| `ccComputeStats < renderCommandCenter` | 30 |
| `renderCommandCenter` &rarr; the summary card | 30 |
| `ccComputeStats < notifItems < notifRefresh` | 30 &nbsp;&larr; the bell recomputes **all** the stats |
| `aprQueue < aprRefreshBadge` | 30 &nbsp;&larr; a nav badge |
| `excBuild < excBadge` | 30 &nbsp;&larr; a nav badge |
| | **150** |

Five independent readers of the same thing inside one synchronous render, and
three of them are the little counts beside the nav items.

**150 &rarr; 30.**

### Why a pass and not a cache
§3o declined a cache in terms: *&ldquo;a stale compliance register is a worse
defect than a slow one&rdquo;*. That still holds. A **pass** is a different
thing &mdash; it is opened and closed around one synchronous call and cannot
outlive it.

Every function on that path was checked **before** this was written, not
assumed: none is async, none writes, and none mutates a row it is handed. So the
answer cannot change between the first reader and the fifth.

`lgChartPass(fn)` is re-entrant (badges run inside the dashboard **and** on
their own, so an inner pass joins the outer rather than emptying it) and closes
in a `finally`, so a throw closes it too.

### The two traps that would have made it wrong
- **Options are part of the key.** `includeNA` and `allYears` produce different
  registers, and handing a caller the wrong one changes what it sees without
  changing anything it could check. The key is built from sorted option keys, so
  `{allYears,includeNA}` and `{includeNA,allYears}` are one entry.
- **The array is copied on the way out.** A reader that sorts or splices must
  not reorder another's. The row *objects* are shared, which is safe only
  because nothing mutates them.

### Getting from 60 to 30
Keying on options alone left it at **60**, because the dashboard asks for two
registers &mdash; the plain one and the `includeNA` one. But `includeNA`'s only
effect is a single filter at the end of the row build, so **the plain chart is
the includeNA chart minus the rows a user marked not applicable**. Building the
superset once serves both. `allYears` still keys separately: it is a genuinely
different register and cannot be derived.

The suite asserts the derivation against a real uncached build, so the day
`includeNA` gains a second effect this **fails** instead of drifting.

### The proof that matters
The dashboard renders **byte-identical** with the pass and with it stubbed out
&mdash; 3,365 characters, character for character &mdash; and every option set
returns exactly what an uncached build returns.

### Three things the mutation check found, again all in the new work
- **A comment quoting code broke a mutation.** The explanation reproduced
  `if(r.userNA && !(opts && opts.includeNA)) return false;` verbatim, so a §2j
  mutation anchored on that line matched **twice** and was silently skipped.
  Third time in three sessions that prose has interfered with a check &mdash;
  §3n and §3o were assertions matching their own comments, this one is a
  comment matching the code. **Do not reproduce a line of code in a comment
  beside it.**
- **The copy test only covered one branch.** `includeNA` leaves by `slice` and
  the plain register by `filter`; testing only the plain one let an uncopied
  `includeNA` result through.
- **The NA fixture set the wrong field.** `userNA` is what the chart puts on a
  row; `notApplicable` is what the record stores. Setting the former made both
  registers identical, which would have let the derivation pass untested.

### Coverage
Suite **472 &rarr; 494**, mutations **98 &rarr; 108 caught, 0 missed, 0
skipped**. Ten of the new mutations are about the pass failing to close, because
that is the one failure that would put a stale row in front of a CS.

---

## 3q. LANDMARKS AND CONTROL NAMES (v179)

§3n named this the weakest dimension in the product: **zero landmarks in the
whole app, and controls a screen reader could only announce as &ldquo;edit
text&rdquo; or &ldquo;combo box&rdquo;.**

### Landmarks by ROLE, not by retagging
`role="banner"`, `role="navigation"` and `role="main"` produce **exactly the
same landmarks for assistive technology** as `<header>`, `<nav>` and `<main>`.
In a 2.6 MB single file where the closing tags are thousands of lines away and
the structure is nested divs, retagging is closing-tag surgery for no gain a
screen reader can detect. One attribute each, and no CSS moved because nothing
selects these by element &mdash; checked first.

### A skip link, which is the part a keyboard user actually feels
**Thirty nav items sit between the top of the page and the content.** Without a
skip link, reaching the main region by keyboard is thirty tab stops, on every
screen. It is the highest-value thing here and it is nine lines.

Verified by driving it: Shift+Tab from the search box lands on `.skip-link`,
`left: 0` and `:focus` matching &mdash; **off-screen until focused, on screen
when it is**. `tabindex="-1"` on the target matters: without it the target takes
the scroll but not the focus, so the next Tab returns to the top of the nav and
the link achieves nothing.

### Three counts, none of them right on its own

| how | found | why it was wrong |
|---|---|---|
| driving the browser | 43 | only sees what has been rendered &mdash; misses every modal and flow nobody opened |
| scanning the markup | 79 | cannot resolve an id built in JavaScript, nor match a `<label for>` built the same way |
| **both, filtered** | **62 named** | |

The static scan reported the register field builder as unnamed **when it emits a
proper `<label for>`** &mdash; 27 healthy controls among the 79. A check that
cries wolf on those is a check nobody runs (§2x), so it now skips interpolated
ids and matches `<label[^>]*for=` rather than the bare tag.

And the browser sweep missed the entity modal entirely, where `entField`
rendered its caption as a **`<div>`**: the words were on screen and tied to
nothing. That is now a real `<label for>`, which beats an aria-label because the
visible text becomes the accessible name and cannot drift away from it.

### Named at the source, not in sixty-two places
Eight filter selects in `renderUniverse` keyed by their own filter name, one
entity picker in `regRender` serving **all nine register panels**, three filters
in the forms master, and the settings toggle &mdash; which also became a real
**`role="switch"` with `aria-checked`**, having previously been an empty
`<button>` containing a `<span>`: no name, no state, no role.

**Result: 0 unnamed controls and 0 unnamed buttons**, across all 40 panels and
the register, entity and event modals, at 375px and 1280px, with no console
errors.

### The mutation runner was only ever exercising half the suite
This is the finding worth carrying. `mutation.js` ran **`compliance.test.js`
only**, so a mutation that deleted the main landmark, or stripped a control's
name, **passed** &mdash; nothing that ran could see the markup.

It runs **both suites** now, and stops at the first that notices. That did not
just cover the new work: **every structural check written since §2x** &mdash;
nav/panel pairing, live inline handlers, defined classes, the build marker
&mdash; was unproven until this change.

### Two bugs in the new checks, both the same shape
- **The generator window was one guessed distance for all entries.**
  `entField`'s label carries a style attribute and an optional hint span, so it
  sits further back than an aria-label written straight onto the tag &mdash; and
  a real label read as missing. The window is per entry now.
- **The scan's own false positives**, above: 27 of 79.

Both are §2x again: *a check that cries wolf is worse than no check.*

### Coverage
Smoke **12 &rarr; 30 checks**, mutations **108 &rarr; 121 caught, 0 missed, 0
skipped**. Thirteen of the new mutations are accessibility, and none of them
could have been caught before the runner started exercising the smoke test.

### Not done
`lang="en"` is present and every control is named, but this is not a WCAG audit:
focus order, contrast ratios, live-region announcements and keyboard traps in
the modals are unmeasured. What was fixed is what §3n measured.

---

## 3r. THE IMPORTER READ &ldquo;250 LAKH&rdquo; AS 250 CRORE (v180)

**First, a correction to §3n.** That audit said the product had no import and
that a new customer would hand-key thirty companies. **Wrong.**
`bulkOpen` / `bulkParse` / `bulkCommit` have been here all along, reached from
Entities &rarr; *Import from spreadsheet*. The grep was for `csvImport` and
`lgImport`; the feature is called `bulk*`. **A search that finds nothing is not
a finding.**

And it is good: quoted CSV, Excel TSV paste, header aliases, CIN validation that
fills in the entity type, a preview that classifies each row **new** or
**update**, and a commit that will not null a stored column just because the
sheet omitted it.

What it had was **zero test coverage** &mdash; 494 assertions, 121 mutations,
none touching the path by which *every figure in the product arrives* &mdash;
and three defects that only a test would have found.

### The one that matters

| typed | stored as | |
|---|---|---|
| `250 lakh` | **250 crore** | a hundredfold error, **silent** |
| `250 million` | **250 crore** | ~400x, **silent** |
| `2,50,00,000` unquoted | **2 crore** | truncated to the first comma group, **silent** |

The first two are one bug: **`parseFloat("250lakh")` returns `250`.** It reads
the leading digits and discards the rest, so a figure naming any unit but crore
was stored as though it said crore. This is §2c&rsquo;s units trap &mdash; *two
conventions in one app* &mdash; arriving somewhere new, and here it decides law:
**Rs 250 lakh is Rs 2.5 crore; read as 250 crore it crosses the s.204 MR-3
turnover limb and tells a client it owes a secretarial audit it does not.**

The third is the splitter: an unquoted Indian-grouped number makes more cells
than there are headers, and the surplus was dropped without a word.

### The fix is a strict test, not a longer list of suffixes
`bulkMoney` matches the **whole** string or refuses it, so the failure mode
becomes *&ldquo;that is not a number&rdquo;* rather than a plausible wrong
figure. Units with one unambiguous meaning are **converted** &mdash; lakh, crore,
million, billion, thousand; anything else is refused. `Rs.`, `INR` and `₹` are
accepted, and `(12.5)` is read as a loss.

### A wrong unit can still be a valid number, so size is asked about separately
Pasting rupees into a crore column produces a figure the parser cannot fault. Past
**Rs 1 lakh crore** &mdash; larger than all but a handful of companies in India
and no SME on a practice&rsquo;s book &mdash; the preview **asks**:
*&ldquo;is that figure in rupees rather than crore?&rdquo;* Flagged, never
refused. The reader decides; the product does not guess.

### Two more, from §2e&rsquo;s rule
A row with more cells than headers now says so, and **two rows naming one
company** are flagged by CIN and by normalised name. §2e makes duplicate
detection the strongest free control on filing evidence; the same mistake here
silently creates two records for one entity.

### Verified end to end, not just the parser
One paste, four rows, against a book that already held the first:

```
update  Acme Industries Pvt Ltd   250 lakh  ->  Rs 2.5 cr        (was 250 cr)
new     Beta Textiles Limited     L-prefix CIN -> Listed (BSE/NSE)
new     Gamma Foods Pvt Ltd       bad CIN + "250 furlongs" both refused, row kept
new     Delta Traders             2500000000 -> "rupees rather than crore?"
```

Modal fits 375px, no console errors, no horizontal overflow.

### Coverage
Suite **494 &rarr; 548**, mutations **121 &rarr; 135 caught, 0 missed, 0
skipped**. The importer went from **zero** assertions to 54.

### Two of my own mistakes worth recording
- **A mutation that changed nothing.** *&ldquo;the unit is read after the spaces
  are stripped&rdquo;* only appended a comment, so it was correctly reported
  MISSED. It now actually moves the strip above the unit loop, where `\blakh\b`
  stops matching because there is no word boundary between `0` and `l`.
- **A comment about a trap fell into it.** The patch script is a Python
  triple-quoted string, and a comment explaining *&ldquo;never write three
  quotes in a row&rdquo;* wrote three quotes in a row and closed the string.
  Fourth time in four sessions that prose has broken a mechanism &mdash; §3n and
  §3o were assertions matching their own comments, §3p a comment matching code,
  this one a comment matching its own delimiter.

### What is still not covered
`bulkCommit` writes to Supabase and needs a signed-in session, so the insert and
update paths are **exercised by hand, not by the suite** &mdash; the same
boundary as §3b. What is asserted is everything up to the write.

---

## 3s. TERMS AND A PRIVACY POLICY (v181)

`terms.html` and `privacy.html`, linked from the login card and from
Administration &rarr; Settings.

**I am not a lawyer and these are drafts.** Both carry an amber banner saying
so, and neither should go live until somebody qualified has read the liability,
indemnity and grievance clauses. What they are is a draft grounded in **what the
software actually does**, because that is the half I could establish and the
half boilerplate always gets wrong.

### Every factual claim was checked against the code first
| claim | how it was established |
|---|---|
| no analytics, no trackers, no pixels | grep across the file &mdash; **zero** matches for GA, GTM, Mixpanel, Segment, PostHog, Hotjar, Facebook |
| the database is in India | Supabase project, Mumbai region (&sect;4) |
| documents are private | private bucket, 300-second signed URLs (&sect;2e), asserted by `backend.test.js` |
| **board minutes never leave the browser** | `impRunMinutes` calls only `impSplitMinutes`, `impAssess`, `mgt14Assess` &mdash; all local |
| what leaves India | the complete list of external hosts, and what reaches each |
| browser storage holds no client data | the live `localStorage` keys are view preferences only |

The third-party table names **five** recipients and what each one gets. Google
Fonts and jsDelivr see an IP address on every page load; rss2json and AllOrigins
see one only on the Regulatory Radar, plus the public feed URL. And OpenRouter
receives whatever is typed into an AI feature.

### The distinction the whole document turns on
**Two kinds of personal data, two different roles.** For the user's own account
details LawGovern is the **Data Fiduciary**. For everything about the user's
*clients* &mdash; directors and their DINs, designated persons, trading
declarations &mdash; **the practice is the Fiduciary and LawGovern is a
Processor**. Boilerplate collapses these into one, and collapsing them here
would misstate who answers to a director whose DIN sits in somebody's register.

### The AI disclosure is the one that matters
Text typed into an AI feature **leaves India**. So the policy says which five
screens use AI, that **nothing fires automatically**, and &mdash; the useful
half &mdash; **which screens never use it**: the register, the calculators, the
checklists, every entity register, Event Impact, the applicability engine, the
exceptions list, the board report and the back-test.

### And it states what is NOT in place
No SLA. No point-in-time recovery. Free tier. *"Do not make it the only copy of
your compliance record."* The terms say the same about availability, and section
2 repeats on the page what the app already says on screen: **nothing is verified
against MCA21 or the exchanges**, and the Companies Act text held is amended
only to 01.04.2021.

### The check that would have punished the right action
A smoke check asserting *"the draft banner is present"* would fail the moment
the owner correctly removes it after review. §2x's rule: a check that punishes
the right action is worse than no check. So the invariant asserted is
**placeholders OR no banner, never both** &mdash; a policy with blanks in it
must always say it is a draft.

### Two of my own, both the same shape as before
- **The window was 9,000 characters and the links sit 19,120 past the overlay**,
  so the check failed against a page that was correct &mdash; and the "same card
  as sign-up" test matched the `lgSignUp` **function definition**, which is
  *earlier* in the file than the overlay. Both are §3q's guessed-distance bug.
- **I wrote "four placeholders" and there are six.** §2z's "all 99 divisions"
  exactly: the list was right, the sentence counting it was not.

Smoke **30 &rarr; 45 checks**.

### What is still needed from the owner
Six placeholders in each document, a named grievance officer (the DPDP Act
requires a means of contact), and a lawyer. The terms also assume the service is
**free** &mdash; the moment it is charged for, section 6 needs fees, renewal,
refunds and taxes.

---

## 3t. THE 327-RULE WORKLIST GETS AN ORDER (v182)

The owner, comparing this to **TeamLease RegTech**: *"i am not satisfied with
this what we have built, is this ready to sell"*.

Measured rather than argued. TeamLease publish **1,536 Acts and 69,233
compliances**, maintained by **35+ legal experts in Pune** who watch **2,000
government websites** across 28 states and 9 union territories and capture
~2,500 changes a year. This holds **327 rules across 3 laws, maintained by
nobody, with no effective date on any of them** &mdash; and 53 flagged doubtful
by the owner's own spreadsheet.

**212x the content, kept current by 35 lawyers.** No amount of engineering
closes that, and their corpus is overwhelmingly *state labour and establishment*
law sold to a multi-state employer's CHRO &mdash; not a Company Secretary's
secretarial practice. So the answer to "is it ready to sell" is no, and the
blocker is not features: **not one rule has been checked by a person, and
Rule Governance has said so since v157 without anything changing.**

### The insight this release rests on
**The evidence is extractable. The determination is not.**

`tools/amendments.py` reads the compilations in `reference/` and pulls out, per
provision, every dated amendment footnote &mdash; instrument, date, verb and the
footnote verbatim. **220 of 299 citing rules now arrive with their amendment
history attached**, so verifying a rule is *review* rather than *research*. What
it never does is decide: the reviewer gets the reading, and the judgement stays
where it belongs.

### The date belongs to the PROVISION, never to the instrument
The finding that set the data model. The **LODR Third Amendment 2024** commenced
**58 provisions on 13.12.2024 and 11 more on 31.12.2024**.

A first census found 138 occurrences of 13.12.2024 and none of 31.12.2024, and
I nearly "corrected" CLAUDE.md §3e's Reg 13(3) date as a digit transposition.
Two reasons that was wrong: the extraction writes `31 .12.2024` with a space
inside the date, so `[0-9.]+` could not see it (the `se ven days` defect of
§2v), and the date genuinely differs per provision. **Keying an in-force date on
the instrument name would have dated eleven provisions eleven days early.**

### Four extraction bugs, each found by checking rather than trusting
| symptom | cause |
|---|---|
| Reg 17 and Reg 18 reported as *inserted in 2023* | they were **paragraphs 17 and 18 of Schedule III**. Numbering restarts in a schedule. Acting on it would have hidden board composition and the audit committee from every earlier year |
| PIT yielded **2** dated footnotes from 135 | PIT writes `(w.e.f. April 01, 2019)` &mdash; **month names**. A numeric-only pattern read the corpus as unamended |
| **s.470 with 267 amendments** | the Act opens with an `ARRANGEMENT OF SECTIONS` table of contents, so every first-occurrence landed in the TOC and the last entry's span ran to the end of the file |
| Reg 27 and Reg 91C with **no evidence at all** | see below |

The Schedule III one is the §3f trap exactly: **the text contains numbers that
are real, current, and about something else.**

### Marker beats position, and it was the document's own linkage
Footnotes were first attributed to whichever provision's span contained them.
But a footnote *definition* prints at the foot of a page, and which page is
decided by typesetting &mdash; so Reg 27 and Reg 91C, both plainly amended, came
back empty because their footnotes print under a neighbour.

The document already carries the answer: a marker `72[` in the body and a
footnote numbered 72. In these SEBI compilations **those numbers are unique
document-wide (659 footnotes, 659 distinct numbers)**, so following them is
exact. The tool **checks that uniqueness rather than assuming it** and falls
back to position if a future compilation restarts numbering.

**197 -> 220 rules covered, 104 unreachable footnotes -> 0.** The Act keeps
positional attribution because its footnotes restart at 1 on every page, and
**the screen says which basis it used**: claiming the marker was followed when
it was not would invite trust in a note that may belong to the previous page.

### The Companies Act commencement footnote: found, and deliberately not used
Footnote 1 to s.1(3) lists commencement **section by section, in 22 dated blocks
each naming its notification** &mdash; exactly the in-force floor this needed.
It is captured as evidence and **not parsed into dates**, because the last block
reads:

> "21st December, 2020 - S. 1, 3, 6 to 10 (both inclusive), s. 12 to 17 ..."

Sections 3 and 6 to 10 are incorporation provisions that commenced **1 April
2014**. Those are sections of the **Companies (Amendment) Act 2020**: the
footnote mixes commencement of the principal Act with commencement of later
amending Acts and never says which is which. Reading all 22 blocks would have
recorded that incorporation came into force in December 2020 and hidden it from
every earlier year. **Reported, not silently repaired (§3j)** &mdash; the
hazard travels with the data and onto the screen.

LODR and PIT commencement *are* established, and **computed, not remembered**:
gazette 2 Sep 2015 + the ninetieth day the regulation states = **1 Dec 2015**;
gazette 15 Jan 2015 + the hundred-and-twentieth = **15 May 2015**. Both quoted.
The proviso to Reg 1(2) puts Reg 23(4) and Reg 31A on the notification date
instead &mdash; per-provision again, in the commencement clause itself.

### `lgRuleInForce` &mdash; the invariant is that it never hides anything
An unknown commencement date **abstains**. A missing net worth skips a s.135
limb (§2c); a missing year end once **assumed 31 March and produced 79 dates
that looked computed** (§3j). This is that fork, and **hiding an obligation is
the worse branch** &mdash; it is the one failure in this product a CS cannot
notice. The boundary is asserted from both sides: a period ending the day before
commencement is out, a period ending *on* it is in.

### The ordering is the feature
`govAmendedQueue` is pure and separate from the screen, because reversed it
would look just as busy and be exactly backwards. A flat alphabetical list of
327 unchecked rules gives nobody a reason to start anywhere, which is why it sat
untouched for twenty-five releases. **Most recently amended first**: the top of
the queue is Reg 40(1), amended **14 July 2026**. A rule whose provision moved
last month is a different prospect from one untouched since 2015, and that is
knowable from the held texts without reading a single rule.

### Three claims the exercise independently confirmed
- **s.137(3)** in the held text reads *"ten thousand rupees ... one hundred
  rupees for each day during which such failure continues, subject to a maximum
  of two lakh rupees"* &mdash; §3m/§3n's AOC-4 figures are right, and the
  one-day trap (company *"during which"*, officers *"after the first"*) is
  visible in the same sentence.
- **s.92** substituted by **Act 29 of 2020**, the basis for §3m's s.92(5) penalty.
- **Reg 91C** substituted **8 September 2025**, exactly as §3e read it.

### Two pre-existing CSS bugs, and a check that now catches them
Section 4 of the smoke test has caught invented *class* names four times and
could not see a *variable*. v182 shipped `var(--ice)` and `var(--border)`,
neither defined, so the evidence panel had no background and no borders and
looked like unstyled text. The new check found **two more that were already
there**: `.mw-dot{color:var(--ink-4)}` and `.cd-ev-del{color:var(--ink-4)}`
&mdash; an invalid custom property with no fallback voids the whole
declaration, so both inherited instead. It also cried wolf twice and was
taught: a variable named inside a CSS *comment* (there is a note in the
stylesheet saying `var(--card)` does not exist), and `var(--x, fallback)`,
which renders correctly by design.

### The mutation runner was passing for the wrong reason since v181
The worst finding here, and it is §3q one layer down. v181's legal-page checks
resolved `terms.html` from `path.dirname(INDEX)`. `mutation.js` writes each
mutant to a **temp directory**, so those files were never there &mdash; smoke
failed for every mutant regardless of the mutation, and my new check made it
*crash* outright. Any bug only smoke could catch was being "caught" by a
spurious failure. Repo files now resolve from `REPO`, and verifying it took one
command: **run smoke against an unmutated copy outside the repo.** Three
mutations that reported *"the mutant crashed"* now report a named assertion.

### Four of my own, all the same shape
- **I asserted values I had not read.** Reg 13's latest amendment is 2025-05-01,
  not the 2024-12-31 I assumed; Reg 27 and 91C were absent for a reason I had
  not yet found; PIT has 7 provisions and I wrote >= 8. §2z's "all 99
  divisions" &mdash; four times in one sitting.
- **A mutation anchor with four backslashes** where a JS string literal needs
  two, so it silently SKIPPED. The anchor is now proved against `index.html`
  before being trusted.
- **A shell heredoc ate a backslash again** &mdash; fifth time in this project.
  Written with the Write tool, per §6.
- **The caveat named the wrong basis.** It said "attributed by position" for
  every law after SEBI attribution had become marker-based. Understating is
  safer than overstating and is still a screen stating something untrue.

### Coverage
Smoke **45 -> 57**, suite **548 -> 592**, mutations **135 -> 147 caught, 0
missed, 0 skipped**. `python tools/amendments.py` regenerates the evidence
**and re-embeds it into `index.html`** &mdash; a generated file that has to be
pasted by hand goes stale the first time somebody forgets.

### What this does NOT do
It does not make one rule current. Only reading the provision does that, and
Rule Governance is still where it gets recorded. What changed is that the
reading now starts from prepared evidence in a sensible order, instead of from
a 700 KB PDF and a list of 327 items with no reason to begin anywhere.

---

## 3u. THE DEFECTS A DEMO FOUND, AND WHY IT IS GONE (v183, removed v184-v185)

A demo tenant shipped in v183 &mdash; three sample companies driving the real
engines, reachable at `?demo=1`, with a landing page beside the login card.

**The owner removed it the same week:** *"i only one that is it no demo shit"*.
Their product, their call, and the standing constraint already pointed that way:
*"if anything is not working it should not be there, i dont want any dummy
items"*. Sample companies inside a working compliance app are a dummy item by
that standard, whatever the engines behind them are doing.

**Removed completely in v184, not hidden behind a flag** &mdash; a flag leaves
the same 13 KB in the file plus a switch nobody will ever turn on. 16,356
characters gone; `?demo=1` is an ordinary URL that shows the login screen, and
a smoke check asserts no demo entry point can come back.

### The lesson worth more than the feature
**I built a demo tenant without asking whether the owner wanted one.** "Close
the presentation gap" was chosen from a list where I had described that option
as including "a demo tenant with realistic data", so it was not out of scope
&mdash; but a product whose owner has banned dummy items in writing is one where
*sample data* is close enough to the line to be worth a single question first.
A day's work, correct in every detail, thrown away for want of one sentence.

### What the demo found, and all of it stayed

**The coverage gauge could never leave zero.** The find that matters most, and
nothing to do with the demo except that realistic data exposed it.

```js
stats.health = Math.round(100 * stats.verified / t)
```

`stats.verified` counts `FILED`, `FILED_LATE` and `PUBLISHED`. **&sect;7 records
those as structurally unreachable** &mdash; nothing here verifies against MCA21
or the exchanges, so every recorded filing resolves to `FILED_PENDING`. **The
first number on the dashboard read 0% for every user, on every book, however
many filings they recorded**, and the gauge label sat permanently on "No
Evidence Recorded". Three sample companies with 37 filings on record produced a
gauge reading zero.

&sect;2d defines the metric in terms: *"share of applicable obligations with
evidence on record"*. `stats.evidenceOnRecord` was computed **three lines above**
and never used. It survived because **nothing had ever asserted it**. A metric
nobody has watched move is one nobody should trust, and this one could not move
at all. The assertion now records a filing against every past-due row and
requires the number to change &mdash; while asserting `verified` stays 0, so it
cannot regress to a dead counter.

**The back-test called a correctly-anchored date the 31 March defect.**
&sect;2k: a rule with no offset must not carry a date. &sect;2l then added the
one legitimate way it does &mdash; from a meeting the practice recorded. Reg
47(1) is *"within 48 hours of conclusion of the board meeting at which the
financial results were approved"*, and the row names that meeting in
`anchoredTo`. The check never allowed for it, so the first entity with a results
board meeting had its correct date reported as the defect the check exists to
prevent. **No test entity in this project had ever had one** &mdash; every
fixture was built to exercise the rule corpus, not the registers. &sect;3j again.
The exemption is narrow: not *"derived rules may have dates"* but *"a row that
names the recorded event its deadline ran from may have one"*.

**The FLA row exists twice.** &sect;3i fixed it to carry its source &mdash; on
the **company** path. LLPs emit their own copy, which still had none, so the
first LLP with a real shape was correctly reported as carrying a date with
nothing behind it. Two copies of one row is &sect;3n's defect; the second is
stamped now.

**Two pre-existing CSS bugs**, found by the new variable check: `.mw-dot` and
`.cd-ev-del` both pointed at `var(--ink-4)`, which is defined nowhere. An
invalid custom property with no fallback voids the whole declaration, so both
inherited their parent's colour.

### Three of my own, all worth keeping
- **The demo's director rows used field names the engine does not read.**
  `resigned_on` where the schema says `cessation_on`, `kyc_done_on` for
  `din_kyc_on`, and no `is_woman` at all &mdash; so a listed company with two
  women on its board **failed the woman-director proviso to s.149(1)**. Silent,
  plausible and wrong: &sect;3r's "250 lakh" exactly. Sample data that does not
  match the schema does not look broken, **it looks non-compliant**.
- **A patch aborted mid-way and I hand-applied its tail.** The script validated
  every anchor, failed on one, and exited before writing &mdash; correct
  behaviour. I then applied two follow-ups by hand, one of which added the
  `</div>` the unwritten wrapper needed, leaving the overlay unbalanced. Both
  the landing patch and the removal patch now **count `<div>` against `</div>`
  before writing**: an unclosed div does not throw, it silently swallows what
  follows.
- **A mutation went MISSED** because the check asserted a banner's wording
  existed in the source rather than that it reached the screen &mdash;
  &sect;2j/&sect;3n's shape.

### The landing page went too (v185)
I kept it in v184 on the reasoning that it is the pitch rather than the demo,
and that it costs nothing because it only renders when nobody is signed in.
The owner: *"remove the landing page too"*. The sign-in screen is the login
card again, byte-for-byte its pre-v183 form.

**That is twice in two releases that I kept something the owner had not asked
for, on my own judgement about its value.** The first was building it; the
second was arguing to keep half of it. When an owner removes a thing, the
default is that the thing goes &mdash; not that a smaller version survives
because I still like it.

### Two guards, and mutations that prove they fire
Neither the demo nor the landing was removed because it was **broken**, so
neither would look wrong if it crept back. `smoke.test.js` &sect;9 now asserts
the sign-in screen carries a login form, **no `demo=1` or `lgDemoStart`
anywhere**, and **no `lgland` markup**. Two mutations put each back and are
caught &mdash; a check nobody has watched fail is a check nobody should trust.

### Coverage
Smoke **57 &rarr; 60**, suite **592 &rarr; 603**, mutations **147 &rarr; 151
caught, 0 missed, 0 skipped**. Every gate green after both removals, and
neither the app nor the suites carry a demo or landing symbol.

---

## 3v. THE AUDIT HAD NEVER READ THE LAW (v186)

*"now do the rule verification"*. Measured before building: of 327 rules, the
release gate compared a stated period against the held text for **six**.
`period mismatch: 0` was nought out of six, and had read as a clean bill of
health for the whole corpus since v159.

Four reasons it never arrived, and **not one was a disagreement about the law**:

| | what the audit was actually reading |
|---|---|
| **Companies Act** | the **ARRANGEMENT OF SECTIONS contents page**. "96." matched *"96. Annual general meeting. 97. Power of Tribunal..."* Every Act period check read the contents. &sect;3t fixed this in `amendments.py`; nobody fixed it here |
| **Reg 52** | item 52 of a list of **2002-03 circulars** printed after the schedules |
| **Reg 33, 24A, 46** | a fixed **2,600-character window** that stopped before the cited sub-regulation |
| **Reg 39(2), 6(1B)** | the pattern required the literal word `within` plus at most two words, so *"within a period of thirty days"* &mdash; printed verbatim in the audit's own output &mdash; was invisible |

**Six compared &rarr; 23.** Headings are located once per text and each
provision runs to the next heading; the Act skips its contents; SEBI stops at
the schedules; the lead-in accepts *not later than*, *at least*, and
*a period of*.

### "forty -five", and "w ithin"
&sect;2v recorded *"within se ven days"* &mdash; the extraction dropping a space
inside a word. It is not one bad line. **Reg 32(6) states "within forty -five
days from the end of each quarter"** and parsed as no period at all; **Reg 47(1)
states "w ithin forty eight hours"**. Across the three texts the word *within*
is split **23 times**. Numbers are now keyed with spaces and hyphens stripped,
and every gap inside *within* is optional.

### A delegating provision is not a contradiction
The one mismatch that appeared was **s.90; SBO Rules**, rule says 30 days.
s.90(4) says the return is filed *"within such time ... as may be prescribed"*
&mdash; no period at all. The thirty days is in the SBO Rules 2018, **not held**
&mdash; which &sect;2o recorded two years ago. Blocking a release on that would
fail the gate over a documented gap, so delegation is its own category and never
blocks.

**And note what nearly happened instead.** s.90 *does* contain "thirty days"
&mdash; in **sub-section (6)**, about a person's reply to a notice under s.90(5).
Had the parser matched it, the rule would have been reported **confirmed by a
sub-section it has nothing to do with**. &sect;3f's trap exactly: the text
contains a period that is real, current, and about something else.

### The false-agreement check, and why it was withdrawn
That risk was measured: **4 of 23 agreements were not inside the sub-provision
the rule cites.** Reading all four, **two were my detector's fault** &mdash; Reg
47(1) is confirmed in its own text once "w ithin" is readable, and Reg 7(5)'s
segment was cut at the cross-reference *"sub-regulation (4)"*, which reads as
the next sub-provision. Reg 33(3)(d)'s sixty days needs a wider read and Reg
46(2)(s)'s twenty-one days is genuinely not in Reg 46.

A narrowing that is wrong half the time is worse than none (&sect;2x), so it was
**withdrawn and the limitation stated instead**: an agreement means the number
appears **in the provision**, not in the clause the rule cites. That sentence is
now printed by the audit itself.

### The screen was claiming more than the audit did
Rule Governance said 231 LODR rules were *"cross-checked ... and no stated
period contradicts the words around it"*. The citations were checked; the
periods reached six rules. It now states both numbers, and a smoke check refuses
the old wording.

### The gate reports its own reach
`period compared` and **`periods actually compared: 23 of 327 rules (7%)`** print
beside `period mismatch`. **A count of failures means nothing without the count
of checks behind it** &mdash; that is the whole lesson, and it is the same shape
as &sect;3u's coverage gauge, which divided by a counter that was structurally
always zero.

### What this does NOT do
It does not verify 327 rules. **304 still state no period the held text can be
compared against** &mdash; 181 say "Ongoing" or "As specified by SEBI", 94 take
their period from a Schedule, 28 cite no numbered provision. Those need a person
reading them, which is &sect;3t's queue. What changed is that the audit now says
so instead of implying otherwise.

Smoke **60 &rarr; 65**.

---

## 3w. THE 304 THAT COULD NOT BE CHECKED (v187)

*"now do the remaining 304"*. They were three groups, and lumping them together
is what made the number look hopeless.

**122 of 327 rules now have their stated period confirmed against the held
text, up from 6.** No rule contradicts its provision.

### The biggest group was skipped on a premise that was wrong
96 rules were excluded by this comment in the audit:

> *"A Schedule entry cites the regulation that ENABLES it, while its own period
> lives in the Schedule &mdash; Schedule III Part E items all cite Reg 87B(1)
> and take their 24 hours from the Schedule, not from 87B."*

**That is not where it lives.** Schedule III Part A is a list of *events*
&mdash; *"1. Acquisition(s)...", "2. Issuance or forfeiture of securities..."*
&mdash; with no timing in it at all. The timing is in **Reg 30(6)**, the
provision those rules already cite:

> *"...as soon as reasonably possible and in any case not later than the
> following: (i) thirty minutes from the closure of the meeting of the board of
> directors ... (ii) twelve hours ... (iii) twenty four hours..."*

So the skip sent the reader to the wrong document **and** excluded 96 rules from
the one check that could confirm them. Removed: **122 of 127 confirm against the
citing regulation.**

Twenty-one needed one more thing &mdash; a roman-numeral list item counts as its
own lead-in, because the governing words sit *before* the list and each item has
none of its own.

### Four parser defects, every one hiding a period printed on the page
| what the text says | why it read as no period |
|---|---|
| `within 2 working days` | the spelled-number branch was greedy, capturing **"2 working"** as the number; `int()` threw and the match was dropped |
| `within 436[two working days]` | a **footnote marker between the lead-in and the number** |
| `within forty -five days` (Reg 32(6)) | the extraction splits the number |
| `w ithin forty eight hours` (Reg 47(1)) | the extraction splits *within* &mdash; **23 times** across the three texts |

The first was mine, introduced two hours earlier in the same session by the
widening that was supposed to help. **Digits-first fixed the digit case and left
every spelled one broken**, which is worse than the bug it replaced because it
looked like progress. The branch is lazy now, and &sect;2v's original *"within se
ven days"* parses too.

### What the five non-confirmations actually are
- **Four Schedule III entries** (Part A 7B, 7C, 15(b)(ii), 15(b)(iii)) whose
  period really is in the Schedule item rather than Reg 30. Named as their own
  worklist.
- **s.90**, whose thirty days is in the SBO Rules 2018, not held (&sect;2o).

They were briefly *all* reported as "the provision delegates", because Reg 30
contains the words *"as may be specified by the Board"* somewhere in its
seventeen thousand characters &mdash; for a different sub-provision.
**Whether a rule is a Schedule entry is a fact about its id; whether a provision
delegates is a phrase match in a long text.** The definite test runs first now.

### A schedule locator was built and NOT shipped
It parses `LODR-SCH3-Part A-A-15` into Schedule III, Part A, section A, item 15.
It placed **42 of 140** paragraphs and produced a **false disagreement** on Part
A item 7 by running past it into 7B. Half-working is worse than absent
(&sect;2x), and it turned out to be unnecessary: the period was in the
regulation all along.

### The honest remainder: 205
- **172 state no period at all** &mdash; *"promptly"* (19), *"ongoing"* (16),
  *"continuous"* (10), *"annually"*, *"as specified by SEBI"*. &sect;3d
  classified these correctly as continuous duties, applicability tests and
  delegated timings. **They are not deadlines and cannot be checked as ones.**
- **28 cite no numbered provision** &mdash; PIT Schedule A/B, the SDD framework,
  the SEBI circular framework.
- **5** as above.

### And what 122 confirmations do NOT mean
The number the rule states **appears in the provision it cites**. It does not
mean it appears in the *clause* the rule cites &mdash; the comparison is against
the whole provision, a limit the audit prints in its own output and which
&sect;3v measured at 4 of 23 before this run. It is not a professional's
sign-off, and Rule Governance still reads "Never checked" for all 327.

---

## 3x. THE DEPOSITORIES REGULATION ENTERS THE REGISTER (v188)

The owner, settling scope: *"first master only these laws SEBI LODR, PIT,
Depositories and Companies Act 2013 ... so best no one can think of that level
perfect"*.

One of those four contributed **nothing**. `reference/sebi-depositories` has
been here all along &mdash; 137 KB, 100 numbered provisions &mdash; and the
corpus held **zero** rules from it. The register had never once mentioned an
obligation under the Depositories Regulations.

**Eleven issuer obligations now do.**

### The measurement that found it
Every audit in this project asks whether the rules it HAS are right. Nothing had
ever asked **which obligations the law creates that are not in the corpus at
all**. So it was measured:

| law | rules | distinct provisions cited | provisions in the text |
|---|---|---|---|
| SEBI LODR 2015 | 231 | 56 | 192 |
| SEBI PIT 2015 | 42 | 8 | 38 |
| Companies Act 2013 | 54 | 49 | **497** |
| **SEBI Depositories** | **0** | **0** | **100** |

**A missing rule cannot be wrong &mdash; it is absent.** The register never
mentions it, the dashboard never counts it, nothing turns red, and *not one of
603 assertions, 151 mutations or the release gate can see it.* Against the
owner's own aim, *"no compliance should be missed"*, that was the gap.

### Who the regulation actually binds
It binds four different parties, and only one of them is the customer:

| | provisions |
|---|---|
| depositories | 41&ndash;57, 73, 82 |
| participants | 58&ndash;69, 81 |
| beneficial owners | 74(1), 79(1) |
| **issuers** | **70, 71, 72, 74(5), 74(7), 75, 76, 77, 78** |

Checked one by one against the words: Reg 81 binds *"a depository and a
participant"*, Reg 82 *"a depository"*, Reg 65 *"every participant"*. Loading
all 100 provisions would have handed a listed company **NSDL's obligations**
&mdash; &sect;2z's defect exactly, wrong law against the wrong entity class.

### The one a practising CS is paid for
**Reg 76(1) is the Reconciliation of Share Capital Audit** &mdash; the quarterly
report *"audited by a qualified Chartered Accountant or a practicing Company
Secretary or a practicing Cost Accountant"*. It was entirely absent from a
product built by and for Company Secretaries.

And it states **no deadline**. Reg 76(1) fixes the cadence &mdash; *"on a
quarterly basis"* &mdash; and says nothing about when in the quarter. The period
lives in SEBI circulars and exchange requirements not held here. The LODR Master
Circular of 30 January 2026 confirms the report travels through the **single
filing system** alongside Reg 13(3), 27(2) and 44(3), and states no period for
it either. So it emits **four quarterly rows and no date** &mdash; &sect;2k's
rule, on a filing a CS signs.

### Three different reasons for having no date, and they are not the same
&sect;3e's rule applied to a new law. *"Deadline not established"* would read
identically for all three:

1. **The regulation states no period** &mdash; Reg 76(1).
2. **The regulation delegates it** &mdash; Reg 78, *"at the time and in the
   manner as may be specified by the depository in its bye-laws or agreement"*.
   NSDL and CDSL bye-laws are not held.
3. **The period is certain and the ANCHOR is not held** &mdash; Reg 72 is
   thirty days from receipt of a complaint, Reg 74(5) fifteen days from receipt
   of a certificate, Reg 76(2) twenty-one days from receipt of a demat request.

The third is the dangerous one. **A CS reading "deadline not established"
against Reg 72 could conclude there is no thirty-day rule.** There is. Eight of
the eleven rows now say which reason applies, in the regulation's own words.

Worth noting: Reg 74(5) and Reg 76(2) run on **two different anchors in one
transaction** &mdash; fifteen days from the certificate reaching the issuer,
twenty-one days from the request reaching the issuer. Both are in the register,
both say so.

### This corpus is hand-authored, and says so
`ca_master.json`, `lodr_*.json` and `pit_master.json` are generated by
`build_master.py` / `build_lodr.py` from the owner's spreadsheet and **must not
be hand-edited** (&sect;2k). `depositories_master.json` is the first corpus read
**out of a held text, provision by provision** &mdash; so every rule carries a
`quote` field with the words it came from, and its `meta` block says plainly
that it is not spreadsheet-generated.

### The mutation that was MISSED, and why the fix matters
*"A hand-authored rule loses the words it came from"* passed. The assertion
tested the quote's **length**, and truncating Reg 76(1)'s quote past its opening
words left it long.

What has to survive is not length but **the part that makes it an obligation**:
the duty-holder and the verb that binds them. The quote must contain *"issuer"*
and *"shall"*. Cutting *"Every issuer shall submit"* off the front removes both
&mdash; and a quote that cannot show who is bound is not evidence of anything.

### And a backspace, for the seventh time
Writing that assertion through a shell heredoc turned `\b` into a literal
**0x08** inside the regex, so it matched nothing and **every** rule failed the
check on a clean build. &sect;6, &sect;2x, &sect;3c, &sect;3t and &sect;3w have
all recorded this. Fixed with the Write tool, and the word boundaries were
**dropped rather than re-escaped** &mdash; plain substrings work as well here
and leave nothing to mangle.

### Coverage
Suite **603 &rarr; 615**, mutations **151 &rarr; 155**. Verified live: a listed
entity gains **14 rows** (11 rules, Reg 76(1) expanding to four quarters); an
unlisted private company gains **0**.

### Marked listed-only, deliberately
Reg 76 files *"to the concerned stock exchanges"*, which only a listed issuer
has. The rest bind any issuer whose securities are dematerialised &mdash; and
for unlisted companies that trigger is **Rule 9A / 9B of the PAS Rules 2014,
not in `reference/`**. Named rather than assumed, the same treatment PAS-3 gets
under Rule 12 (&sect;2n) and BEN-2 under the SBO Rules (&sect;2o).

### What is still missing, now that completeness has been measured once
The Companies Act cites **49 sections of 497**. Most of the rest are Tribunal
powers, winding up and machinery rather than calendar obligations &mdash; but
nobody has ever gone through it asking *"what did we leave out?"*, and until
somebody does, the answer is unknown rather than zero.

---

## 3y. THE COMPANIES ACT COMPLETENESS PASS (v189)

&sect;3x measured it and left it: **49 sections cited of 497.** This is the
pass. **Eleven obligations the generated corpus did not carry**, read from the
held Act, and the register now carries 349 rules rather than 327.

### The Act's own chapters did the triage
Dumping 448 uncited section numbers on a Company Secretary is not a worklist,
it is noise. Chapters **II to XIII** run from incorporation to managerial
remuneration and are where a company's registrable duties live; Chapter XIV
onward is inspection, compromises, oppression, winding up, Tribunal and
offences &mdash; event-driven, or about somebody other than the company.

| | |
|---|---|
| sections in chapters II&ndash;XIII imposing a duty | **193** |
| already cited by a rule | 51 |
| **not cited** | **142** |
| of those, stating a period or naming a return | **96** |
| read, and found to be obligations on the COMPANY with a stated period | **11** |

### What was missing
**INC-20A. SH-7. MGT-15. The Unpaid Dividend Account. DIR-3C.** None of them
was among the 49.

| | |
|---|---|
| **s.10A(1)(a)** | declaration of commencement of business, **180 days** from incorporation |
| **s.14(2)** | altered articles filed with the Registrar, **15 days** |
| **s.17(1)** | copies of memorandum and articles to a member, **7 days** of the request |
| **s.64(1)** | notice of alteration of share capital, **30 days** |
| **s.100(2), (4)** | EGM on requisition &mdash; Board proceeds in **21 days**, meeting within **45** |
| **s.119(2)** | minutes of a general meeting to a member, **7 working days** |
| **s.121** | report on the AGM &mdash; **30 days**, listed public companies |
| **s.124(1)** | unpaid dividend to the Unpaid Dividend Account, **7 days after 30** |
| **s.129A** | periodical financial results, **30 days** |
| **s.157(1)** | directors' DINs to the Registrar, **15 days** |
| **s.193(2)** | OPC contracts with the sole member, **15 days** |

**s.121 is the only one that gets a computed date** &mdash; it is AGM-anchored,
so `agm_offset: 30` dates it exactly as AOC-4 and MGT-7 are dated. Verified: AGM
30 September 2026 &rarr; **30 October 2026**. It falls on the same day as AOC-4
and is routinely missed because AOC-4 draws the attention.

The rest are event-driven and correctly undated: this app holds no register of
member requests, requisitions, DIN intimations or dividend declarations, so
there is nothing for those periods to run from. The period is stated on every
row regardless &mdash; **a period this app cannot compute is not a period that
does not exist** (&sect;3x).

### Three excluded for reasons worth keeping
- **s.84** states thirty days and the duty is on **the person who obtains the
  receiver's appointment**, not on the company &mdash; the company is the
  *recipient* of the notice. Reading the period without reading the subject
  would have put a filing on the register that the company does not owe.
- **s.13** &mdash; the held text shows a footnote, *"Subs. by Act 1 of 2018,
  s. 6, for 'within fifteen days'"*. The period was substituted away and the
  current one is not plain in this text, so nothing is asserted.
- **s.58, 59, 62, 66, 68, 74** run through the Tribunal or through multi-stage
  offers rather than a filing deadline; the punishment sections are
  consequences, not obligations.

### The compound period, which is the trap
**s.124(1) is thirty days from declaration and THEN seven days to transfer.**
Thirty-seven days in all &mdash; not thirty, and not seven. A rule stating
either leg alone is wrong by a month or by a week, on money that belongs to
shareholders. The mutation that flattens it is in the suite.

### The invariant that holds a hand-authored corpus to its text
Both new corpora are read from `reference/` rather than generated from the
owner's spreadsheet, so nothing upstream constrains them. The assertion that
does:

> **Where a rule states a period, that period must appear in the words it
> quotes.**

Eleven rules, every stated period found in its own quote. A rule claiming ninety
days where its quote says one hundred and eighty fails immediately.

### The two new corpora were outside the release gate
v188 added 11 rules and v189 added 11 more, and `rule_audit.py`'s `CORPORA` list
named neither &mdash; so the gate kept reporting **327** and checked the
citations of none of the 22. **A corpus outside the audit is a corpus with no
citation check at all**, which is the state the Companies Act itself was in
until &sect;3g.

Both are in it now, and the gate read them against the held texts:

```
checked                    349      (was 327)
citation found             321      citation not found  0
periods actually compared  134 of 349 rules (38%)
period mismatch              0
```

**Zero mismatches across 22 hand-authored rules** &mdash; an independent check
that the periods written here match the provisions they came from.

### Coverage
Suite **615 &rarr; 627**, mutations **155 &rarr; 159**. Verified per class: a
listed company gains 9 supplement rows, a private company 9, an OPC 9 &mdash;
overlapping but not identical, because s.121 is listed-only, s.193 OPC-only,
s.129A unlisted-only, and **s.100 is correctly absent for an OPC, which holds no
general meeting.**

### What is still not measured
The 96 candidates were read; **46 of the 142 uncited duty-bearing sections in
chapters II&ndash;XIII were not** &mdash; they state no period and name no
return, so they are unlikely to be calendar obligations, but "unlikely" is not
"checked". And chapters XIV onward were excluded wholesale on the reasoning that
they are event-driven; that reasoning is sound and it is still a reasoning, not
a reading.

---

## 3z. THE LODR COMPLETENESS PASS (v190)

&sect;3x measured it and left it: **LODR cites 56 provisions of 192.** This is
the pass. Counted properly against the regulation body the denominator is
**151** &mdash; &sect;3x's 192 counted headings the schedules also produce
&mdash; and **18 obligations of an equity-listed entity were absent
altogether**. The register now carries 367 rules.

### The regulation's own chapters did the triage, and they divide by WHO is bound
Unlike the Act, LODR chapters are not subject matter. They are
*what the entity has listed*:

| ch | binds | cited | not |
|---|---|---|---|
| III | every listed entity &mdash; common obligations | 10 | **0** |
| **IV** | **listed SPECIFIED SECURITIES &mdash; the customer** | **26** | **15** |
| V | listed non-convertible securities (debt only) | 14 | 19 |
| VI | both, and the delisting of debt | 0 | 11 |
| VII&ndash;IX | issuers of IDRs, securitised debt, mutual fund units | 5 | 33 |
| X | **the recognised stock exchanges** | 0 | 7 |
| XI&ndash;XII | default procedure, machinery | 0 | 7 |

Chapter III is **complete**. The gap is Chapter IV, which is exactly the
chapter an Indian company with listed equity lives on. Chapters VII to X bind
somebody else entirely, and loading them would hand a listed company an
exchange's obligations &mdash; &sect;2z's defect.

### What was missing
**Prior intimation of a board meeting. The record date notice. The KMP vacancy
clock. The promoter reclassification sequence.** None of them was among the 56.

| | |
|---|---|
| **Reg 15(1A)** | high value debt trigger &mdash; comply within **six months** |
| **Reg 15(2B)** | post-resolution-plan compliance with Reg 17, and 18&ndash;21, in **three months** |
| **Reg 26A(1)** | CEO / MD / WTD / Manager vacancy &mdash; **three months**, six with regulatory approval |
| **Reg 26A(2)** | CFO vacancy &mdash; **three months** |
| **Reg 26A(3)** | post-resolution-plan KMP vacancy &mdash; **three months** |
| **Reg 28(1)** | in-principle approval **before** issuing securities |
| **Reg 29(1)** | prior intimation of a board meeting &mdash; **two working days** |
| **Reg 30A** | shareholder and promoter agreements &mdash; timing specified by the Board |
| **Reg 31A(3)(a)** | promoter reclassification &mdash; **two months / five days / sixty days / five days** |
| **Reg 31A(9)** | reclassification under a resolution plan &mdash; **one day** |
| **Reg 31B(1)** | special rights &mdash; special resolution **once every five years** |
| **Reg 35** | Annual Information Memorandum |
| **Reg 37** | draft scheme to the exchange; the NOC is valid **six months** |
| **Reg 37A** | disposal of an undertaking &mdash; prior special resolution |
| **Reg 41** | lien, calls in advance, no differential rights |
| **Reg 42** | record date &mdash; **three working days**, seven for a scheme, five between two |
| **Reg 43(1)** | dividend on a per share basis only |
| **Reg 45** | change of name &mdash; **six months** where the activities changed |

**Every one is undated on purpose.** Each runs from an event no register here
holds, or counts working days with no exchange holiday calendar. Sixteen of the
eighteen carry a `LG_NO_DEADLINE_WHY` explanation saying which &mdash; &sect;3x's
rule, because *"deadline not established"* reads identically for a period that
is certain but unanchored, one the Board specifies, and a rule that fixes an
order rather than a period.

### A period that runs BACKWARD inverts the safe direction
&sect;2w counts Reg 7(2)'s *"two trading days"* as calendar days and says so,
because that **errs early** &mdash; the safe direction for a deadline.

Reg 29(1) and Reg 42 run the other way: *at least* two working days **before**
the meeting, *at least* three **before** the record date. Treating working days
as calendar days there produces a **later** deadline than the regulation allows.
Same approximation, opposite consequence. So neither is computed, and both say
why on the row.

### My own parser read a repealed regulation
The finding that would have done the most damage, and it was in my tooling.

**Reg 31A appears twice in the document.** The first occurrence is a footnote
reproducing the pre-2021 text; the operative regulation is the second. The span
parser took first-occurrence-wins, so **everything I read for Reg 31A was the
repealed version** &mdash; and it scanned as *"states no period"*, which would
have excluded it from this pass entirely.

Read properly, Reg 31A(3)(a) is a **four-deadline sequence** and the held text
prints **three successive versions of it**, each with different numbers:

| | board's views | board &rarr; shareholders | application |
|---|---|---|---|
| pre-2021 | &mdash; | 3 to 6 months | 30 days from approval |
| 2021&ndash;2024 | next meeting or 3 months | 1 to 3 months | &mdash; |
| **current, 13.12.2024** | **next meeting or two months** | **sixty days from the NOC** | **five days** |

Two of those three are printed in footnotes and read exactly like law.

**The check that found it cried wolf first.** Counting curly quotes from the top
of the file drifts over 500K characters of PDF extraction and never recovers: it
reported **135 of 151 provisions as repealed**, including Reg 17 and Reg 18.
&sect;2x &mdash; a check that cries wolf is worse than no check. The signal that
works is *local*: only a number appearing more than once can have the problem at
all, and the introducing words sit a few hundred characters back. Rerun that
way: **3 duplicates, 1 genuinely wrong**, which is a finding rather than noise.

### Three periods that look current and are not
&sect;3e's trap, three more times. All omitted or superseded, all still printed:

- **Reg 41(9) and 41(10)** &mdash; the annual **practising company secretary
  certificate** that share certificates issued within thirty days of lodgement,
  and its filing with the exchanges. **OMITTED w.e.f. 13.12.2024.** A CS still
  reaches for it. The corpus was checked and correctly does not carry it.
- **Reg 43(3) and 43(5)** &mdash; five working days before a dividend
  recommendation, and the thirty-day gap between transfer-book closures.
  **OMITTED the same day.**
- **The twenty-one days printed under Reg 28** is the old **Reg 27(2)(a)**
  corporate governance report &mdash; &sect;3e again, a period real, current
  once, and about something else.

### Reg 42's two periods were SWAPPED, on the same day
The Third Amendment 2024, 13 December 2024:

```
Reg 42(2)  general record-date notice     seven working days  ->  THREE
Reg 42     proviso, scheme of arrangement  three working days  ->  SEVEN
Reg 42(4)  gap between two record dates     thirty days        ->  five working
```

Both figures are entirely plausible in either position, so having them the
wrong way round does not look wrong &mdash; it looks like a rule. A Company
Secretary working from memory will have them inverted. The mutation swaps them
back, and the assertion had to be made order-sensitive to catch it: `/three
working days/` passes happily on a swapped pair.

### Reading the period without reading the subject, again
**Reg 30A(1)'s two working days is not the company's.** It binds the
shareholders, promoters, related parties, directors, key managerial personnel
and employees who are parties to the agreement, and it runs **to** the listed
entity. The entity's own disclosure is *"within the timelines as specified by
the Board"*. &sect;3y's s.84 exactly &mdash; claiming the two days would have put
a deadline on the register that the company does not owe.

Same discipline excluded **Reg 31A(3)(a)(iv)**: the thirty days to decide an
application binds the **recognised stock exchange**.

### THE REGISTER WAS SHOWING 1 JANUARY 1970 ON TWO THIRDS OF ITS ROWS
Found by driving the real screen, which is the only thing that could have found
it. `ccFmtDate` had no null guard, and `new Date(null)` is the epoch:

```
DUE DATE ▲          STATUS
1 Jan 1970          Scheduled        <- 212 of 278 rows on a listed entity
```

**And the register sorts by due date ascending**, so every undated row climbed
**above every real deadline**. 66 call sites pass optional values &mdash;
`r.due`, `filed`, `held`, `signed`, `certOn` &mdash; so this was never one
screen.

&sect;2k removed 63 invented dates on the principle that a wrong date does not
look wrong, it looks like a date. This one *does* look wrong and shipped anyway,
on two thirds of the register, because **nothing had ever asserted it**: the
suite passed at 657 assertions with the bug in place. Guarded at the source,
with the assertion and the mutation that puts it back.

### Reported, not repaired: the Universe flattens two states into a third word
`cuStatusPill` maps the register's own vocabulary, which predates &sect;2k, and
it labels **141 STANDING and 71 NO_DEADLINE rows alike as "Scheduled"** &mdash;
the two states &sect;2k created precisely because they are different facts, and
a word that means neither. Fixing it changes the status filter's vocabulary and
the `ccGo` deep links that pass a status value, so it is its own job with its
own blast radius. &sect;3j's treatment: named, not silently changed.

### The corpus is held to its text
Both invariants, and the second is what makes the first worth having:

> **Where a rule states a period, that period must appear in the words it
> quotes** &mdash; and **the quote is present in the held regulation**.

The second is checked by normalising to **letters only**. That is what defeats
this extraction in one move: it writes `w ithin`, `forty -five` and
`atleast 423[three ] working days`, and dropping digits removes the footnote
markers while dropping spaces removes the split words. Sixteen quotes verify
end-to-end; two stitch limbs across sub-clauses and every limb verifies on its
own. It caught two quotes where my own paraphrase had crept into a field that
must be verbatim.

### The gate read the new corpus against the held text
```
checked                    367      (was 349)
citation found             339      citation not found  0
periods actually compared  144 of 367 rules (39%)
period mismatch              0
```

### Coverage
Smoke **65**, suite **627 &rarr; 664**, mutations **159 &rarr; 166 caught, 0
missed, 0 skipped**. One mutation was MISSED first time &mdash; widening
`appliesTo` to reach a private company changed nothing, because the register
call sits behind `if(isListed)` and never runs for one. That is &sect;2x's
defence in depth. Rather than retire it, the assertion that makes the field
load-bearing was added: **an unlisted company must be told all eighteen do not
apply, and given a reason for each** (`lgExcludedFor`, &sect;3i's *"not on the
list, but because"*).

### What is still not measured
- ~~**Chapter V (19 uncited) and Chapter VI (21)**~~ &mdash; **read in
  &sect;4b**, and the count was wrong: Chapter VI is **11** uncited, not 21.
  &sect;2z's lesson again. The app *modelled* `ncs` and `hvdle`, but nothing
  ever set either flag, so those chapters could not have been scoped at all
  until db/026.
- **Chapters VII to IX (33 uncited)** bind the issuers of Indian depository
  receipts, securitised debt instruments and mutual fund units. Excluded on the
  reasoning that none is this product's user; that reasoning is sound and it is
  still a reasoning, not a reading.
- **PIT cites 8 provisions of 38** and has had no completeness pass at all.

---

## 4a. THE PIT COMPLETENESS PASS (v191) &mdash; the fourth law

&sect;3x measured it and left it: **PIT cites 8 provisions of 38.** This is the
pass, and it completes the four laws the owner named. Counted against the
regulation body the denominator is **33**, and **11 obligations of a listed
company were absent**. The register now carries 378 rules.

### Counting provisions understates the gap in a regulation this small
The other three passes asked *which provisions are not cited*. That question is
nearly useless here, because PIT holds only 33 numbered provisions and
concentrates its duties inside a few of them. Both questions had to be asked:

| | |
|---|---|
| provisions **not cited at all**, that bind the company | **Reg 6, 7I, 7J** |
| **sub-provisions** of provisions the corpus already cites | **Reg 3(3), 3(4), 3(5), 3(6), 9A(3), 9A(4), 9A(5), 9A(6)** |

**Reg 3 has six sub-regulations and the corpus cited two. Reg 9A has seven and
the corpus cited three limbs of one.** A completeness check that stops at the
provision number would have reported PIT as almost done.

### What was missing
| | |
|---|---|
| **Reg 3(3)** | UPSI for a transaction &mdash; generally available **two trading days** ahead where no open offer follows |
| **Reg 3(4)** | the board **shall require** the parties to execute confidentiality and non-disclosure agreements |
| **Reg 3(5)** | the structured digital database &mdash; PAN, **not outsourced**, time stamping, audit trails, **2 calendar days** for outside information |
| **Reg 3(6)** | the database preserved **not less than eight years** |
| **Reg 6(4)** | the Chapter III disclosures kept by the company **five years** |
| **Reg 7I** | the Code of Conduct must protect an informant from retaliation |
| **Reg 7J** | no term of any agreement or Code may preclude reporting to SEBI |
| **Reg 9A(3)** | the **board** must ensure the CEO or MD ensures compliance |
| **Reg 9A(4)** | the **Audit Committee** must review compliance **at least once in a financial year** |
| **Reg 9A(5)** | board-approved leak-inquiry procedures; **inform SEBI promptly** |
| **Reg 9A(6)** | a whistle-blower policy, and employees made aware of it |

### The mutual fund chapter is the trap, and it is laid out to be one
**Reg 5A to 5H is the units-of-mutual-funds regime.** Every provision in it
opens with *"asset management company"*, *"trustees"* or *"units of a mutual
fund"*. **Reg 5D alone states five periods** &mdash; two working days, two
trading days, sixty days, six months, two months &mdash; and **not one of them
is a listed company's**.

What makes it dangerous is the parallel numbering: **Reg 5C is the mirror of
Reg 3 and Reg 5H the mirror of Reg 9A**, same subject matter, same shape,
different duty-holder. A period lifted from there lands on a listed issuer's
register looking entirely plausible. &sect;2z's defect, pre-assembled.

Same reading excluded **Reg 7A to 7H and 7K to 7M** (the Board and the
informant) and kept **Reg 7I and 7J**, which bind the **employer** &mdash;
Reg 7I because a listed company is required to have a Code of Conduct by
Reg 9(1), and Reg 7I(3) makes an employer who violates the Chapter liable to
penalty, debarment, suspension or criminal prosecution.

### Two retention periods in one regulation, and they are three years apart
**Reg 3(6) preserves the structured digital database for eight years. Reg 6(4)
keeps the Chapter III disclosures for five.** Both are on the company, both are
in the same regulation, and they are not interchangeable.

This is a different kind of obligation from everything the earlier passes
carried, and the explanation had to say so: **a retention period is not a
deadline.** Nothing falls due; nothing may be destroyed. A Company Secretary
reading a blank against Reg 3(6) could delete the record that proves who held
UPSI &mdash; and unlike a missed filing, a destroyed record cannot be put back.
There is a mutation for each direction of the swap.

### The obligation most likely to be missed outright
**Reg 9A(4) &mdash; the Audit Committee must review compliance at least once in
a financial year and verify that the internal controls are adequate and
operating effectively.**

It files nothing. No form, no exchange, no Registrar &mdash; the only evidence
it happened is the minute. An Audit Committee that met four times has still not
met it unless one of those meetings did **both** things the sub-regulation
names, and the minutes show both. The regulation fixes the cadence and not the
date, so no date is computed.

### What the existing uncited SDD row could not tell anyone
The generated corpus already carries *"Structured Digital Database &mdash;
maintain an auditable digital database showing UPSI sharing/access information
and preserve integrity of the information trail"*. It cites **no provision** and
states **no period**.

Read against Reg 3(5) and 3(6) it is missing the **Permanent Account Number** of
every person, the **bar on outsourcing** &mdash; the database may not sit with a
vendor &mdash; the **two calendar days** for information received from outside,
and the **eight years**. `pit_master.json` is generated from the owner's
spreadsheet and must not be hand-edited (&sect;2k), so the supplement carries the
cited, quoted version and its `meta.overlaps` block names the row it overlaps
and says which one carries the authority. &sect;3n's treatment of the Penalties
screen, applied to a corpus that cannot be edited in place.

### A check of mine was wrong about a real provision
The quote check asserts that every quote shows who is bound &mdash; &sect;3x's
rule, because a quote that cannot show that is not evidence of anything. It read
only for **"shall"**, and reported **Reg 3(3) as unbound**.

Reg 3(3) is not a duty. It is a **permissive gateway**: UPSI *"may be
communicated ... where the board of directors ... is of informed opinion"*. Its
binding force is the **condition attached to the permission**, not a "shall".
PIT uses three forms and the check now knows all three &mdash; a duty
(*shall*), a nullity (*is void*, Reg 7J) and a gateway (*is of informed
opinion*). Narrowing a check until it is wrong about a real provision is
&sect;2x from the other direction.

### The corpus is held to its text
Both text invariants were clean on the first run &mdash; the binding-form check
above was the only thing that fired, and it was the check that was wrong, not
the rule. **11 of 11 quotes verify verbatim** against the held compilation under
letters-only normalisation, and every period a rule states appears in the words
it quotes. No provision number appears twice in this compilation, so
&sect;3z's repealed-span trap was checked for and does not arise.

### The gate
```
checked                    378      (was 367)
citation found             350      citation not found  0
periods actually compared  146 of 378 rules (39%)
period mismatch              0
```

### A mutation that changed nothing, for the second time
One of the six went **MISSED**, and it was mine. *"PIT obligations reach an
unlisted company"* mutated **`appliesToText`**, which is only a label. The field
`cmApplies` actually reads is **`appliesTo.entityType`**. So the mutation
changed a description and nothing else, and the suite was right to pass it.
&sect;3r recorded this exact shape &mdash; a mutation whose text changes while
its behaviour does not.

Repointed at `appliesTo`, it is caught. Note what still holds from &sect;3z:
widening `entityType` does **not** put PIT rows on a private company's
register, because the `cmRows` call sits behind `if(isListed)` &mdash;
&sect;2x's defence in depth. What it does change is **`lgExcludedFor`**, which
sweeps every corpus for every entity and asks `cmApplies` &mdash; so the rule
stops being reported to an unlisted company as one that does not apply, and the
reason goes with it. That is the assertion that catches it, and it is the same
one that rescued the equivalent LODR mutation in &sect;3z.

### Coverage
Smoke **65**, suite **664 &rarr; 686**, mutations **166 &rarr; 172 caught, 0
missed, 0 skipped**. Verified
live: a listed company gains 11 rows, and a public, private, OPC or LLP entity
gains **0** &mdash; with all eleven reported to an unlisted company through
`lgExcludedFor` with a reason for each.

### The four laws are now done, and here is what that does and does not mean
| law | rules | pass |
|---|---|---|
| Companies Act 2013 | 65 | &sect;3y |
| SEBI LODR 2015 | 249 | &sect;3z |
| SEBI PIT 2015 | 53 | &sect;4a |
| SEBI Depositories 2018 | 11 | &sect;3x |

Each was read against the held text and each says what it left out. **It does
not mean one rule has been verified by a person** &mdash; Rule Governance still
reads "Never checked" for all 378, and only the owner can change that.

### What is still not read
- ~~LODR Chapter V and Chapter VI~~ &mdash; **done in &sect;4b**, together
  with the db/026 flag that made them reachable and revived 20 shipped rules.
- **LODR Chapters VII&ndash;IX (33)** and **PIT Chapter IIA (8)** bind issuers
  of IDRs, securitised debt, mutual fund units, and asset management companies.
  Excluded on the reasoning that none is this product's user.
- **46 of the 142 uncited duty-bearing sections** in Companies Act chapters
  II&ndash;XIII, and **chapters XIV onward**, from &sect;3y.
- ~~PIT Schedules A, B and C~~ &mdash; **read in &sect;4d.** A and B carry 14
  clauses nothing held; C binds intermediaries and fiduciaries, not the
  company.

---

## 4b. THE DEBT CHAPTERS, AND TWENTY RULES THAT COULD NEVER FIRE (v192) &mdash; db/026 &mdash; APPLIED (confirmed by `node tests/backend.test.js`)

The ask was LODR Chapters V and VI. **The corpus was never the blocker.**

`lodrListingTypes(c)` reads `c.ncsListed` and `c.hvdle` to decide whether a rule
scoped to non-convertible securities applies. Both are read in **exactly one
place** in the app and were set **nowhere** &mdash; no column on `companies`, no
field on the entity form, no header the bulk importer maps. Always `undefined`.

**So every LODR rule scoped `listingType: ['ncs']` or `['hvdle']` was
unreachable. Measured against the shipped corpus: 20 rules could never apply to
any entity.**

| | |
|---|---|
| Reg 52(1), 52(4), 52(7)/(7A), 52(8) | financial results for debt |
| Reg 53 | annual report contents |
| Reg 54(1), 54(2)/(3) | **asset cover** |
| Reg 61A(1), 61A(3) | &mdash; |
| Reg 62(3)/(4), 62A | website and dissemination |
| Reg 21(3A)/(3C), 62L, 62Q(2)(a) | HVDLE governance |

That is &sect;2k's defect class &mdash; a control that cannot fire &mdash; and it
is **invisible**, because a rule that never applies looks exactly like a rule
that correctly does not apply. Nothing in 686 assertions, 172 mutations or the
release gate could see it.

It is also &sect;2c repeating. `networth`, `netprofit` and `borrowings` were read
and defaulted to 0 until db/001 added the columns, so the s.135 net-profit limb
was silently unevaluable. Same shape, five years later.

**Authoring 27 more debt rules on top of that would have added 27 more that
could never fire** &mdash; the "dummy item" the standing constraints ban. So the
flag came first.

### db/026_debt_listing.sql &mdash; two booleans, because the regulation draws two lines
- **`ncs_listed`** &mdash; Chapter V binds an entity that has listed its
  non-convertible securities. **An UNLISTED company can be one:** a private
  company with listed NCDs owes Chapter V and owes **nothing** under Chapter IV.
  That is why it cannot be inferred from `type`, and why the register call for
  this corpus sits **outside** the `if(isListed)` guard.
- **`hvdle`** &mdash; Chapter V-A binds a **high value** debt listed entity.
  Reg 62C sets it at Rs 5,000 crore of outstanding listed NCDs and gives six
  months from the trigger.

Both default **false**, which is the opposite of &sect;3j's year-end default and
deliberately so: assuming an entity has listed debt would put Chapter V on every
company in the book (&sect;2z). Assuming it does not leaves the register where it
is &mdash; and the entity form now asks.

### Reg 62C was narrowed in 2025 and it changes the model
> *"...a listed entity which **only** has non-convertible debt securities
> listed, with an outstanding value of Rupees Five Thousand Crore and above
> **and does not have any listed specified securities**."*

**An entity cannot be both equity-listed and HVDLE.** Chapter V-A exists to
reach the governance of debt-only issuers that Chapter IV never touches. Read
without that clause, every large equity-listed company with listed debt would
receive the Chapter V-A regime on top of Chapter IV.

### `listingTypeAll` &mdash; because Reg 63 and Reg 64 are an AND
Reg 63 binds an entity that has listed specified securities **and**
non-convertible securities, and maps which provisions of each chapter apply.
`some()` cannot express that: scoping it to `ncs` alone puts the Chapter IV
mapping rule on a debt-only issuer, which is governed by Chapter V and V-A
instead. So `cmApplies` grew two clauses &mdash; `listingType` (any) and
`listingTypeAll` (all) &mdash; and both are asserted against their contract
directly, not only through the data (&sect;3e's rule).

Verified per listing combination:

| entity | debt rows |
|---|---|
| private, no debt listing | **0** |
| private **with listed NCDs** | **14** |
| private, **HVDLE** | **25** |
| equity-listed only | **0** |
| equity-listed **+ listed NCDs** | **16** (Chapter V + Reg 63 and 64) |

And the revival: an equity-listed entity goes **289 &rarr; 356 rows** once both
flags are set, with **all 14 of the sampled dead rules reachable where 0 were
before**.

### Twenty-seven obligations, and the delisting chapter is a sequence
**Chapter V** &mdash; Reg 50 (prior intimation, **two working days**), Reg 57
(**one working day** to certify interest, dividend or redemption status),
Reg 59 (prior approval for a material modification), Reg 59A (scheme of
arrangement), Reg 60 (record date, **three working days**), Reg 61 (timely
payment).

**Chapter V-A, HVDLE governance** &mdash; Reg 62C, 62E, 62F (audit committee,
**two-thirds independent**), 62G, 62H, 62I, 62J (vigil mechanism), 62K (related
party transactions **except Reg 23(8) and 23(9)**), 62N, 62O (ten committees,
five chairmanships), 62P (KMP vacancy, **three months**).

**Chapter VI** &mdash; Reg 63, Reg 64.

**Chapter VI-A, voluntary delisting of debt** &mdash; an eight-step sequence
with a period on nearly every step: Reg 64A (**one working day** on the
resolution-plan route), 64B (**fifteen working days** from the board
resolution), 64C (**three working days** to commence, **two** to disclose),
64D (**three working days** to notice the holders), 64E (**fifteen working
days** for approval from **all** holders), 64F (**one working day** to report
failure), 64G (**five working days** for the final application), 64H.

### Reg 57 is owed whether or not the money went out
*"...a certificate to the stock exchange regarding status of payment of interest
or dividend or repayment or redemption of principal ... **within one working day
of it becoming due**"*. The trigger is the **due date**, not the payment. A
default is reported by the same certificate that reports a payment, which is
exactly why the period is one day.

### Reg 61's proviso is a bar on the EQUITY dividend, sitting in the debt chapter
An entity that has defaulted on debt interest, redemption or security creation
**may not declare or distribute any dividend** while the default subsists. It is
easy to miss because nobody looks in Chapter V for a dividend restriction.

### Reg 64H is an EXEMPTION, and I had it backwards first
My first title read *"follow the chapter where the securities are delisted from
some but not all exchanges"*. Reading Reg 64H(2) properly: keep a listing on one
exchange with nationwide trading terminals and **"the provisions of regulations
64B to 64G shall not be applicable"** &mdash; the whole in-principle approval,
notice, all-holder approval and final application machinery falls away, leaving
board approval and an application. Read as one more step in the sequence it is
exactly inverted.

### Six quotes were truncation artefacts, and the check caught every one
The quotes were lifted from scan output that had been cut at a character limit,
so Reg 3(3)-style fragments reached a field that must be verbatim: **Reg 59A and
64H below the length floor, and Reg 62C, 62P, 64B and 64C stating a period their
own quote no longer contained.** All 27 verify against the held regulation now
&mdash; and it was fixing 64H's quote that exposed the exemption above.

### Widening a window is not a substitute for aiming it
`entCheck` is a new field builder for a boolean, and the named-control check
reported its **real** `<label for>` as missing. A text field conventionally
carries its label **before** the input; a **checkbox carries it after**, and the
window looked backward only &mdash; so it would have cried wolf on every
checkbox anyone added (&sect;2x).

**The first fix made the window bidirectional, and that broke the check.** Both
entries were anchored on the bare `<input id="'+id+'" type=`, which now matches
`entCheck`'s checkbox **first** &mdash; so with a window scanning both ways,
deleting `entField`'s label passed, because `entCheck`'s satisfied it. The
mutation runner reported *"the entity form caption goes back to a div"* as
**MISSED**.

**And my verification had missed it too.** I proved the widened check still
fails when `entCheck` loses its label, and never tested `entField` losing its
own &mdash; &sect;3p's copy test covering one branch, exactly.

The real fix is per generator, not per window: each entry is anchored on markup
unique to itself (`entField` on its **type expression**) and each says **which
way to look**. `entCheck` gets its own entry and its own mutation, so neither
stands in for the other. Both are now verified to fail independently.

### The corpus ships twice, and the two can disagree
Fixing Reg 60's trigger in `rules/lodr_debt.json` changed nothing the app reads:
each hand-authored corpus is also an **inline JSON blob in `index.html`**, and
editing the file alone leaves the two out of step. The only symptom was a
mutation anchor that suddenly matched twice &mdash; Reg 60's `due` object had
been byte-identical to Reg 42's, so a &sect;3z mutation went **SKIPPED**.

&sect;3t recorded this exact shape for `amendments.py`: *"a generated file that
has to be pasted by hand goes stale the first time somebody forgets."*

Smoke now checks all five hand-authored corpora &mdash; rule count, id list and
**exact equality** &mdash; against their files, and names the fix in the failure
message. Safe as a strict check because the mutation runner tries
`compliance.test.js` **first** and stops at the first suite that notices, so a
mutation editing an embedded period is still caught by the assertion aimed at
it rather than shadowed by this one. Verified by drifting a file deliberately and
watching it fail.

### The mutation that was MISSED, and where it had to be caught instead
**"The debt listing flag stops being loaded"** passed the compliance suite.
Every assertion there builds its company object directly with
`ncsListed: true`, so it never touches the loader &mdash; &sect;2j's shape, a
value the engine handles correctly that nothing puts there. And it is the
**original bug**, so it is the one that most needed catching.

It cannot be caught in the compliance suite without a database. What has to hold
is the whole chain, and each link is a fact about the shipped file:

```
column -> loader -> company object -> lodrListingTypes -> cmApplies
          entity form -> entSave -> column
```

Five smoke checks now assert it, and all three break-a-link mutations are
caught. Break any link and 47 rules go quiet without a single test failing.

### A correction to &sect;3z's own table
That section reported Chapter VI as **1 cited, 21 not**. Re-measured: **0 cited,
11 not**, and the same error appears in its closing list as "Chapter VI (21)".
&sect;2z's lesson exactly &mdash; the list was right and the sentence counting it
was not, for the third time in this project.

### The gate
```
checked                    405      (was 378)
citation found             377      citation not found  0
periods actually compared  151 of 405 rules (37%)
period mismatch              0
```

### Coverage
Smoke **65 &rarr; 96**, suite **686 &rarr; 709**, mutations **172 &rarr; 179,
0 missed, 0 skipped**. Twenty-five of the new smoke checks are the corpus drift
guard, five the debt flag end to end, and one the checkbox caption.

### db/026 is applied, and it was outside the witness list
Run by the owner on 16 September 2026. **`companies.ncs_listed` and
`companies.hvdle` both confirmed present against the live database** &mdash; and
`backend.test.js` had to be taught to look, because db/026 was not in its
`MIGRATIONS` table. **A migration outside the witness list is a migration whose
status is only a note**, which is the exact failure &sect;3b found when eight
sections of this file claimed db/017 through db/025 were unrun and all eight
were applied.

**Two witnesses for one migration, deliberately.** db/026 runs two separate
`ALTER` statements, and a half-applied migration is a real outcome &mdash; paste
one, miss the other. A single witness would report it applied while every
Chapter V-A rule stayed unreachable.

**Running it switched nothing on.** Both columns default false, so an
equity-listed book's register is byte for byte what it was. What changed is that
the 20 rules &sect;4b found unreachable *can* now fire &mdash; the day an entity
is marked on the Entities form as having listed non-convertible securities.
Backend conformance **94 &rarr; 96 checks**.

---

## 4c. THE QUEUE WAS FOUR TIMES THE JOB, AND SAID SO NOWHERE (v193)

The owner: *"as of now my focus is on equity listed only."* The debt work of
&sect;4b stays &mdash; it shows **0 rows** unless a flag is ticked and `db/026`
is unrun, so it costs an equity-listed book nothing. Their call, asked rather
than assumed: &sect;3u is twice on record for my keeping something after the
owner moved past it.

Then the queue, which is the thing Rule Governance has said since v157 without
anything changing: **not one of 405 rules has been checked by a person.**
&sect;3t gave it an order and it still sat untouched. This is why.

### 405 rules, and 179 of them can never apply to the book
`renderGovernance` listed the whole corpus. On a book of equity-listed
companies most of it belongs to somebody else entirely &mdash; LLPs, One Person
Companies, debt-only issuers, unlisted companies.

| | rules to verify |
|---|---|
| the corpus | **405** |
| scoped to one equity-listed company | **226** |
| an LLP book | far fewer, and **no LODR at all** |

**`govOnBook(rules, clients)`** filters to what can reach an entity the practice
actually holds, and it is **on by default** &mdash; a queue that opens showing
405 when 226 apply is most of the reason nobody starts. The toggle sits beside
the search box, because a narrowed list that does not say it narrowed is
&sect;3k's defect (a filter that does not say it filtered).

**An empty book returns EVERYTHING, not nothing.** Before any company has
loaded, filtering would empty the screen and read as *"no rules to check"*,
which is the opposite of true. Same reasoning as `lgScopeToOrg` in &sect;3a, and
the suite asserts it from both ends.

### The ordered queue holds 134 of 226, and the tab said 134
`govAmendedQueue` drops a rule with no amendment evidence:

```js
var e = lgAmendFor(r.law, r.section || '');
if(!e) continue;
```

**That exclusion is correct and is asserted** &mdash; the tab says *"amended
since it was written"*, and a rule with no evidence was not shown to have been
amended. It is unchanged.

What was wrong is that nothing said so. Measured on an equity-listed book:

```
still to check            226
in the ordered queue      134
in NO ordered queue        92
```

**Work the tab top to bottom and you finish 134 believing you are done**, while
92 rules that apply to your clients were never offered. That is &sect;3o's paged
register, &sect;3k's year filter and &sect;3v's *"period mismatch: 0"* which was
nought out of six &mdash; a list that reads as complete when it is not.

`govQueueGap` counts it and the screen states it, on the amended tab only:

> **134** of **226** rules still to check carry amendment evidence and are
> ordered here, most recently amended first. The other **92** carry none &mdash;
> either the provision has not been amended, or this extraction could not
> attribute the footnote to it. **They are not in this queue.** They are under
> *To check*, and working this list to the end does not finish them.

The suite asserts `queued + missing === open`, so the sentence can never
disagree with the tabs beside it.

### Three of my own on the way through
- **I called two functions without reading them.** `lgAmendFor(law, cite)` takes
  two arguments and `govAmendedQueue(rules, stateOf)` takes two; I passed a rule
  object to both and got *"0 of 405 carry amendment evidence"* and a
  TypeError. &sect;3t's *"I asserted values I had not read"*, again. The real
  figure is 228.
- **I computed `gapNote` and never rendered it** &mdash; &sect;3n's shape
  exactly, a value computed correctly that reaches no screen. Caught by reading
  the assembly line back, and there is now a smoke check and a mutation for it.
- **The toggle's label wrapped its input.** Valid HTML and a real accessible
  name, but not the `<label for>` pattern `entCheck` uses, so the named-control
  scan reported it unnamed. Restructured to match the file rather than widen the
  check again &mdash; &sect;4b's lesson, one release old.

### What this does NOT do
It does not verify a single rule. **Only reading the provision does that**, and
`govSave` still refuses a verification with no instrument behind it. What
changed is the size and honesty of the list: 405 &rarr; 226 for an
equity-listed book, ordered most-recently-amended first, and saying out loud
that the ordering reaches 134 of them.

### Coverage
Smoke **96 &rarr; 100**, suite **709 &rarr; 721**, mutations **179 &rarr; 184**.

---

## 4d. THE PIT SCHEDULES, CLAUSE BY CLAUSE (v194)

&sect;4a left these as the last unread part of PIT: *"carried by the generated
corpus as 9 rules that cite no numbered provision. They have not been read
clause by clause."* Read, and **14 clauses nothing carried**. The register now
holds 419 rules.

### Five schedules, and only two of them are the customer's
Checked against the headings rather than assumed:

| | cites | binds | |
|---|---|---|---|
| **Schedule A** | Reg 8(1) | Principles of Fair Disclosure | **the company** |
| **Schedule B** | Reg 9(1) | Code of Conduct **"for Listed Companies"** | **the company** |
| Schedule B1 | Reg 5F | Code of Conduct for **Mutual Funds** | an AMC |
| Schedule C | Reg 9(1),(2) | the same code for **Intermediaries and Fiduciaries** | not ours |
| Schedule D, E | Reg 7B, 7D, 7E | the **informant's** own forms | not ours |

Schedule B says *"for Listed Companies"* only because the 2019 amendment
inserted those words when Schedule C was split out of it. One schedule used to
serve both.

### SCHEDULE B1 SITS INSIDE SCHEDULE B
The trap, and it is &sect;3t's Schedule III one exactly. Read Schedule B to the
next `SCHEDULE` heading and you take in **B1 as well** &mdash; 8,461 characters
of the **mutual fund** code, whose clauses **restart at 1** and read almost
identically: compliance officer reporting, trading window, pre-clearance,
against an asset management company instead of a listed issuer.

The first measurement did exactly that: Schedule B read as 22,760 characters and
clause B.15's text ran on into B1. Bounded properly it is **14,299 characters
and 15 clauses**. The validator compares every quote against **Schedule A and B
only**, so a clause lifted from B1, C, D or E fails rather than shipping.

### The corpus cites the wrong clause for pre-clearance
`PIT-SCHEDULE-B-CL-3-28` is titled **"Pre-clearance"** and cites **Schedule B
cl. 3**. Clause 3 is *designated persons and their immediate relatives being
governed by an internal code*. **Pre-clearance is clause 6.**

The substance of that rule is right and its citation is wrong, so a Company
Secretary who followed it to the regulation would read clause 3 and find nothing
about pre-clearance. And this is **not** a version difference: Schedule B's
numbering is stable across the 2018 and 2019 amendments, because clause 7 reads
**`7. [***]`** &mdash; the content omitted and the slot kept.

`pit_master.json` is generated and must not be hand-edited (&sect;2k), so
`PIT-SCH-B-6` carries the correctly cited version and quotes it, and
`meta.miscitation` names the row it corrects. &sect;4a's treatment of the SDD
overlap, applied to a citation rather than a period.

### Fourteen clauses, and three of them state a period
**Schedule A** &mdash; cl. 6 (information shared with analysts is not UPSI),
cl. 7 (transcripts of analyst meetings on the website), cl. 8 (need-to-know).

**Schedule B** &mdash; cl. 1, 2, 5, 6, 8, 9, 11, 12, 13, 14, 15.

The three periods are each a bound on the **code**, not a deadline, and they
point in three different directions:

| | |
|---|---|
| **cl. 1** | the compliance officer reports to the board **not less than once in a year** &mdash; a **floor** |
| **cl. 5** | the trading window reopens **not earlier than forty-eight hours** after the information is generally available &mdash; a **floor** |
| **cl. 9** | a pre-cleared trade is executed within **not more than seven trading days** &mdash; a **ceiling on what the code may allow** |

Cl. 9 is the one that reads backwards if skimmed: seven trading days is the
most the code may permit, so a code stating three days binds at three.

### Three clauses worth a Company Secretary's attention
- **cl. 13 was substituted in 2019 and changed the recipient.** A violation is
  now reported to the **stock exchanges**; the earlier wording said the Board. A
  code carrying the old words sends the intimation to the wrong regulator. It is
  also distinct from Reg 9A(5), which informs **SEBI** of a **leak** &mdash; a
  company can owe both at once, to two different places.
- **cl. 14 has two triggers and three cadences.** Names and PAN of immediate
  relatives, of persons sharing a material financial relationship, and phone
  numbers, **annually AND as and when the information changes** &mdash; plus
  educational institutions and past employers **one-time**. An annual collection
  alone leaves the register wrong for up to a year.
- **cl. 15 was inserted in 2025**, so a code written before March 2025 does not
  carry it: a process for how and when people are brought *inside*, and making
  them aware of the duties and the liability. The second limb is what a
  structured digital database alone does not evidence.

### A mutation caught for the wrong reason
Re-citing a clause to Schedule C was reported **MISSED** by my own ad-hoc
checker &mdash; which was looking for a `FAILED` line and the mutant had
**crashed**: `byC['Schedule B cl. 6']` became undefined and `.quote` threw. The
real runner does count a crash as caught, but &sect;3t's rule applies: a
mutation caught by a crash tells you nothing about the assertion meant to catch
it.

The clause lookups are total now, so a missing clause **fails an assertion**
rather than throwing. The same mutation reports *"no rule cites Schedule B1, C,
D or E"* and *"every rule cites Schedule A or Schedule B"* &mdash; by name.

### The gate
```
checked                    419      (was 405)
citation found             377      citation not found  0
no citation                 42      (was 28 - a schedule clause is not a numbered provision)
period mismatch              0
```

### Coverage
Smoke **100 &rarr; 105**, suite **721 &rarr; 741**, mutations **184 &rarr; 189**.
Verified live: a listed company gains 14 rows; public, private, OPC and LLP gain
**0**, with all fourteen reported to an unlisted company through
`lgExcludedFor` with a reason for each.

### What is still not read
- **Schedule B1, C, D and E** &mdash; excluded on a reading of their own
  headings, not on reasoning.
- **46 of the 142 uncited duty-bearing Companies Act sections**, and chapters
  XIV onward (&sect;3y).
- **LODR Chapters VII&ndash;IX** and **PIT Chapter IIA** &mdash; IDRs,
  securitised debt, mutual fund units.

---

## 4e. THE CALENDAR WAS CALLING THREE LAWS THE COMPANIES ACT (v195)

The owner sent one screenshot: **Compliance Calendar, PIT selected, "Nothing
dated in this view."** No words with it. Measured rather than guessed, and the
screen held four defects &mdash; only one of which was the thing that had been
clicked.

### `calLawTag` falls through to 'CA', so a law with no branch becomes the Act
```js
if(t.indexOf('pit')  >= 0) return 'PIT';
if(t.indexOf('lodr') >= 0) return 'LODR';
if(t.indexOf('iepf') >= 0) return 'IEPF';
return 'CA';                      // <- everything else
```
Measured across listed, public, private, OPC and LLP:

| what the "Companies Act" chip was showing | rows | **dated** |
|---|---|---|
| Companies Act 2013 | 241 | 51 |
| **FEMA / RBI** | 5 | **5** |
| **LLP Act 2008** | 2 | **2** |
| **SEBI Depositories & Participants 2018** | 14 | 0 |

**Seven dated rows on the calendar under the wrong statute**, coloured
Companies-Act blue, and swept up by filtering to the Companies Act.

- **The FLA return is an RBI Master Direction under FEMA**, and &sect;3i had
  already had to fix this row once &mdash; it was carrying a 15 July date with
  nothing to justify it. It carries its source now and the calendar was still
  relabelling it.
- **An LLP's Form 11 and Form 8 are the LLP Act 2008.** &sect;2z exists because
  an LLP was being told to hold board meetings under s.173. The register learned
  that; the calendar then put the LLP's own two filings back under the Companies
  Act. **The same defect running the other way, in a different module.**
- **Depositories is one of the four laws the owner named as scope** and had no
  chip at all. Nothing shows today because none of its 14 rows is dated
  (&sect;3x) &mdash; so the day SEBI specifies a period for the Reconciliation of
  Share Capital Audit, it would have appeared as the Companies Act.

### The IEPF chip could never match anything
`calLawTag` returns 'IEPF' only if the law string contains "iepf". **No rule in
any of the eight corpora carries IEPF as its law** &mdash; s.124 and s.125 are
Companies Act sections and the register files them correctly there.

So the chip filtered to guaranteed-empty, on every book, for ever. &sect;2k's
*control that cannot fire*, and a dummy item by the standing constraint: *"if
anything is not working it should not be there."*

**The chips are built from the register now.** A law with rows gets a chip with
its dated count; a law with none does not. That removes IEPF and surfaces
Depositories in the same line of code, and it cannot go stale the next time a
corpus is added.

The count is taken **before** the filter and before the date test &mdash;
otherwise choosing a law would empty its own chip bar and it could never be
cleared again. &sect;3k's year selector lists the union for exactly this reason.

### The thing that was actually clicked was not a bug
**PIT carries 70 obligations and dates none of them**, and that is correct:
every PIT duty is continuous, runs from an event no register here records, or
fixes a cadence rather than a deadline. Reg 9A(4) is *at least once in a
financial year*; Schedule B cl. 1 is *not less than once in a year*; Reg 3(6) is
a retention period, which &sect;4a records is not a deadline at all.

**But "Nothing dated in this view" does not say 70.** On the
highest-consequence law in the product a reader can take that for *"PIT has
nothing for you"*. &sect;3v's lesson &mdash; a count means nothing without the
count behind it &mdash; and &sect;3o's paged register. The empty state now
names the number and the reason:

> **70 PIT obligations** are on the register for your entities, and none of them
> carries a date. They are continuous duties, obligations that run from an event
> no register here records, or ones that fix a cadence rather than a deadline
> &mdash; so there is no day to put them on.

### 105 smoke checks and 741 assertions all passed with it in place
The same sentence &sect;3z had to write about 1 January 1970 appearing on two
thirds of the register. **Nothing had ever asserted what the calendar labels a
row**, so there was nothing to fail. The gates measure the engines; this was in
the presentation layer, which is where &sect;2j, &sect;3n and &sect;3o all found
their worst defects.

### My dead-chip assertion could not fail
And this is the one worth keeping. The first version read:

```js
ok('and NO chip for a law the book does not hold',
   chips.indexOf('>IEPF') < 0 && chips.indexOf('IEPF<') < 0, ...);
```

A chip renders as `&#9679; IEPF <span>0</span>`, so `IEPF` is preceded by a
space and followed by a space. **Neither substring can ever appear**, and the
mutation that puts the dead chip back was reported **MISSED**.

I had guessed at the markup instead of reading what the bar rendered. It now
pulls the names out of the rendered HTML and holds each one to the register, so
it catches IEPF today and any dead chip added later. &sect;3z's *control that
cannot fire*, this time in my own test &mdash; and it was the mutation check
that found it, not me.

### And a Python habit that is a JavaScript error
The mutation block wrote two adjacent string literals on separate lines. Python
concatenates those at parse time, so the anchor validation passed; **JavaScript
does not**, and `mutation.js` would not parse. A `+` between them. The anchors
themselves were all unique on the first run.

### Verified on the running app
Three entities &mdash; listed, private, LLP. Chip bar reads
`All &middot; Companies Act 27 &middot; SEBI LODR 51 &middot; PIT 0 &middot;
SEBI Depositories 0 &middot; FEMA / RBI 3 &middot; LLP Act 2`, **no IEPF**. The
FLA return renders under FEMA / RBI in amber and **no longer appears under the
Companies Act**; Form 11 and Form 8 render under the LLP Act. Zero console
errors.

### Coverage
Suite **741 &rarr; 763**, mutations **189 &rarr; 194 caught, 0 missed, 0
skipped**. Smoke unchanged at 105; the gate is unchanged at 419 rules, because
**none of this touched a rule** &mdash; every one of these was a correct
obligation wearing the wrong law's name.

---

## 4f. MAIN BOARD ONLY, AND THE SME RULE THAT WAS REACHING IT (v196)

The owner, narrowing scope again: *"first is only equity listed mainboard thats
it others as now is not required."*

Measured before touching anything. Of **303 rows** on a main-board equity-listed
company, 13 carry an `appliesToText` naming some other class &mdash; and twelve
of those are correct (*"All listed entities (except MF units)"* and
*"Equity-listed (incl. SME from 01.04.2025)"* both **include** a main-board
entity; the word SME appearing in a rule is not the same as the rule being an
SME rule).

**One was genuinely wrong, and it was dated.**

### A main-board company was being told to file the same return twice
`LODR-REG-31-1-B-PROVISO` carries
`appliesTo = {note: "SME inclusion/exclusion - check effective date"}`.

**A note is not a scope.** `lodrApplies` reads `appliesTo.listingType`, finds
none, and applies the rule to every equity-listed entity. So a main-board
company received:

| | |
|---|---|
| Reg 31(1)(b) | shareholding pattern **quarterly** &mdash; 21 Jul, 21 Oct, 21 Jan, 21 Apr |
| Reg 31(1)(b) proviso | shareholding pattern **half-yearly** &mdash; **21 Oct, 21 Apr** |

Six dated rows for a duty owed four times, with two of them landing on days that
were already occupied.

**And the proviso is a relaxation, not an extra filing.** Read against the held
text before changing a line, because &sect;4b's Reg 64H was exactly inverted on a
guess of this kind:

> *"Provided that in case of listed entities which have listed their specified
> securities on **SME Exchange**, the above statements shall be submitted on a
> **half yearly** basis within twenty one days from the end of each half year."*

It **replaces** the quarterly cadence for an SME. Handing it to a main-board
company adds a filing that entity does not owe, under a concession it does not
qualify for. &sect;2z, and &sect;3y's s.84 discipline: reading the period
without reading the subject.

### The patch had to move before the test
`rules/lodr_periodic.json` is generated and must not be hand-edited (&sect;2k),
so the scope is corrected in code &mdash; `LG_SCOPE_PATCH`, beside
`LG_DUE_PATCH`, quoting the words it was corrected against. Two tables because
they hold different facts: one is *"this rule's deadline, read from its own
wording"*, the other *"this rule binds a narrower class than the corpus says"*.

But `lgPatchRule` ran **after** `lodrApplies`, so a scope correction could never
have taken effect. &sect;2k put the date patch where the **row** is built rather
than in the date builder; one line earlier is still where the row is built, and
one line later is a patch that silently does nothing. There is a mutation for
that ordering.

`lgExcludedFor` had to patch too, or a scope-corrected rule vanishes with **no
reason at all** &mdash; the one failure &sect;3i's *"not on the list, but
because"* exists to prevent.

### The rule is excluded, not deleted
`sme` is a listing type `lodrListingTypes` never returns. SME is not modelled
and the owner says it is not required, so adding a column and a form field would
be &sect;4b's defect exactly &mdash; `ncsListed` was read in one place and set
nowhere for as long as the corpus has existed.

So the rule is reported through `lgExcludedFor` with its reason, and the reason
says what it would take:

> This is the SME Exchange relaxation &mdash; it REPLACES the quarterly
> shareholding pattern with a half-yearly one, it is not an extra filing. This
> app does not record whether a listing is on the SME Exchange, so it is treated
> as not applying and the quarterly Reg 31(1)(b) rows stand.

The day an SME client arrives, what is missing is one flag, not a reading of the
regulation.

### The reason was mixing two vocabularies, for every debt rule too
`lgWhyNotApplies` read `at.entityType || at.listingType` and compared the result
to `c.type`. Those are **different vocabularies** &mdash; `private` and `listed`
against `equity`, `ncs`, `hvdle` and `sme`. It produced:

> *"It applies to sme. This entity is a listed company."*

which reads as a contradiction to anyone whose company **is** listed, and had
been mis-wording the reason for all 27 debt rules since &sect;4b. Each is now
worded in its own terms, with `lgListingTypeLabel` giving a listing type actual
words.

### An assertion that was asserting the defect
`check('Reg 31(1)(b) proviso - 21 days after the half year', dueOf(LISTED,
'Reg 31(1)(b) proviso'), '2026-10-21')` **failed**, correctly: `LISTED` is a
main-board entity and must not receive the proviso at all. &sect;3l's rule
&mdash; an assertion written against broken behaviour passes for the wrong
reason and fails when it is fixed.

The 21-day offset is still worth testing (&sect;2v confirmed it against the
current text), so it is now tested **on the rule** rather than through an entity
that must not receive it &mdash; &sect;3e, test the guard's contract, not the
data.

### The ninth heredoc
&sect;6 has recorded this eight times. I wrote every patch this session with the
Write tool, then reached for a bash heredoc for one "quick" edit to a patch
script &mdash; and it turned `\n` inside a JavaScript string into a **real
newline**, so `mutation.js` would not parse. That is &sect;3c's failure
verbatim, which has been in this file since v167.

**The quick edit is the one that gets done with a heredoc, and that is the whole
mechanism.** There is no size below which it is safe.

### A mutation anchor that matched twice, caught before it shipped
The fifth mutation first anchored on the bare rule id, which appears in **both**
patch tables. &sect;3p: an anchor matching twice is silently SKIPPED. The
validator refused it, and it now anchors on the offset itself.

### Coverage
Suite **763 &rarr; 769**, mutations **194 &rarr; 199 caught, 0 missed, 0
skipped**. Smoke 105, gate clear at 419 rules, backend 96. Verified live: a
main-board entity carries **four** Reg 31(1)(b) rows and no proviso, register
303 &rarr; 301.

### What this does NOT do
It does not model the SME Exchange. A genuinely SME-listed client would today be
given the quarterly cadence rather than the half-yearly one &mdash; the safe
direction (&sect;2w errs early on a deadline for the same reason), stated in the
exclusion reason, and a flag away from being right.

---

## 4g. THE GATE HAD READ THE LAW AND TOLD NOBODY (v197)

*"now do the rule verification"*. Measured first, and the finding is not about
the rules.

**`rule_audit.py` has compared a stated period against the held text for 151 of
419 rules since v159, and printed the result to a terminal.** A reviewer opening
a rule in Rule Governance saw its **title** and nothing the gate established. So
they re-did by hand the reading the tooling had already finished.

&sect;2j, &sect;3n and &sect;3o all found their worst defects in the same place:
a value computed correctly that reaches no screen. This is the largest one yet
&mdash; it is the whole reason &sect;3t's aim, *"verifying a rule is review
rather than research"*, was still only half true.

### What the modal actually showed
| | |
|---|---|
| the rule's title | yes |
| what period the rule claims | **no** |
| what triggers it, and what class it binds | **no** |
| the verbatim words a hand-authored rule was read from | **no** |
| whether the gate confirmed the period, and against what | **no** |
| amendment footnotes (&sect;3t) | yes |

`lgAllRules` was the cause: it projects five fields and drops the rest, so the
screen showed what an obligation is **called** and nothing it **asserts**.

### Three blocks now, in the order a reviewer needs them
1. **What this rule claims** &mdash; period, trigger, applies-to, and for the
   **92 hand-authored rules** the verbatim quote they were read from
   (&sect;3x). That quote is the strongest thing on the screen and it was
   reaching nothing.
2. **What the release gate checked** &mdash; the verdict in words, what the rule
   states, what the provision carries, **and the provision's own text**.
3. **What the text held here says** &mdash; the amendment footnotes, unchanged.

Section 96 now reads: *the period this rule states appears in the provision it
cites &middot; the rule states 6 month, 9 month &middot; the provision carries 6
month, 9 month*, with s.96(1) printed beneath it.

### Two honesty controls, because an agreement is not a sign-off
- **&sect;3v's limit travels with every agreement.** That section measured **4
  of 23** agreements falling outside the sub-clause the rule cites and
  **withdrew** the narrowing rather than ship one wrong half the time. A reader
  who does not know that will read more into a green line than the check can
  support, so the sentence prints beside it.
- *"This is the reading, not the decision."* &sect;2v's rule, on the screen
  rather than only in this file. `govSave` still refuses a verification with no
  instrument named.

**Nothing here verifies a rule.** Rule Governance still reads "Never checked"
for all 419. What changed is that each one is now a few minutes of reading
instead of an afternoon in a 700 KB PDF.

### `LG_GATE` is regenerated on every gate run, never by hand
`rules/audit_findings.json` and the embed in `index.html` are both written by
`python tools/rule_audit.py` &mdash; **not behind a flag**, because the gate
already runs before every deploy and a generated file that must be refreshed by
hand goes stale the first time somebody forgets. &sect;3t recorded that about
`amendments.py`; &sect;4b recorded it about the corpus blobs. The suite asserts
corpus and gate cannot drift apart in either direction.

### The excerpts are left broken on purpose
This extraction writes `w ithin`, `forty -five` and inline footnote markers
(&sect;2v, &sect;3z). Repairing them for display would show the reviewer a text
that differs from the one they are checking against, which is worse than an
awkward one. Only whitespace is collapsed.

### 149 KB OF QUOTED LAW MADE A MUTATION ANCHOR AMBIGUOUS
The finding worth carrying, and it arrived by a road nobody had walked.

A &sect;3z mutation anchored on Reg 26A's *"shall be filled by the listed entity
at the earliest and in any case not later than three months"*, which was
**unique in the corpus**. The moment the gate blob landed it matched **four
times** &mdash; Reg 26A(1), (2) and (3) share one provision span, so the excerpt
repeats &mdash; and the mutation was **silently SKIPPED**.

&sect;3p's trap, three times over now: a comment quoting code, a comment
matching its own delimiter, and now **generated evidence quoting the law**.

Fixed in the runner rather than by repointing the anchor, because every future
mutation anchoring on statutory wording has the same exposure. The blob is
**derived** &mdash; mutating it proves nothing &mdash; so anchors are counted
against the source with it removed and the mutation is applied to whichever side
holds the anchor. An anchor straddling the seam **says so** instead of writing
an unmutated file, which would read as MISSED and send somebody hunting a blind
spot that is not there.

**The previously-skipped mutation now runs and is caught.**

### Three weaknesses in my own assertions, all found by the runner
- **Testing the leaf, not the assembly.** Every new assertion called
  `govGateBlock` **directly**, so deleting it from the modal changed nothing
  they could see &mdash; MISSED. &sect;3n's shape for the **third** time in this
  project. They test `govEvidenceBlock`, what the modal renders, now.
- **A threshold too loose to see a field go dark.** *"rules carry
  `timelineText` OR `trigger` OR `appliesToText`"* over a count of 250 survived
  blanking `timelineText` outright. Counted per field now.
- **A lookup that threw instead of failing by name.** `RULES.find(r =>
  r.quote)` returns undefined when the mutation empties every quote, so the
  mutant **crashed**. &sect;4d recorded exactly this one release ago. Total now.

### And the tenth heredoc, one release after the ninth
&sect;6 records this at nine. I wrote every patch in this release with the Write
tool, then reached for a bash heredoc to make one small edit **to a patch
script** &mdash; and `\u2500` in the heredoc did not match the file. Same
reflex, same release cycle, one section after writing *"the quick edit is the
one that gets done with a heredoc."*

A second one in the same sitting: a patch anchored on a **decorative box-drawing
comment**, counting 32 dashes where the file has 48. **Anchor on code, never on
a rule made of repeated characters.**

### What is now measurable, and was not
With the gate's verdict per rule embedded, a question nobody could ask before:
**how many rules state no period while the provision they cite does?** Sixteen
on a mainboard book &mdash; and reading two of them settled that this must
**not** become a screen. Reg 13(2), 13(3) and 13(4) all matched *"not later than
twenty-one calendar days"*, which belongs to **Reg 13(1)** &mdash; and the
corpus already carries Reg 13(1) with that period, correctly. Pure false
positives from the whole-provision span, which is &sect;3v's measured limit
doing exactly what it was documented to do.

**Reg 23(1) is genuine**: *"such policy shall be reviewed by the board of
directors at least once every three years"* is current operative text and the
rule states no period. That is a worklist item for the owner, not a check &mdash;
a screen that is wrong half the time is worse than none (&sect;2x).

### Coverage
Suite **769 &rarr; 788**, mutations **199 &rarr; 204 caught, 0 missed, 0
skipped**. Smoke 105, gate clear at 419 rules, backend 96. `index.html` 2.87
&rarr; 2.89 MB. Verified live: the modal renders three sections in **7 ms**,
both honesty controls print, and a hand-authored rule shows the words it was
read from. Zero console errors.

---

## 4h. A CADENCE IS NOT A DEADLINE, AND THE GATE COULD NOT READ ONE (v198)

*"yes add reg 23(1)"* &mdash; and the honest answer is that it was already
there, stated correctly, and **my &sect;4g report was wrong**.

`LODR-REG-23-1` carries `timelineText: "Review at least once every 3 years"`.
I had reported it as stating no period, on the strength of the gate's own
`noperiod` verdict. The gate was wrong, and so was I for repeating it without
opening the rule.

**Every "finding" on this audit's first three runs was its own bug (&sect;2v).
&sect;3w made it four. This is five.**

### The number sits behind "once every"
```
at least three working days        -> (3, 'working day')
at least once every three years    -> []
```
`PERIOD` expects the number just after the lead-in. A **cadence** puts it behind
*once every*, so the pattern never reaches it &mdash; and every rule stating one
was filed as *"rule states no period"* and its number **never compared against
the held text**.

Five rules state a cadence, and **three of them I wrote by hand**:

| | states | |
|---|---|---|
| **Reg 23(1)** | review the RPT policy once every three years | the one asked about |
| **Reg 31B(1)** | special rights re-approved once every five years | &sect;3z |
| **PIT Reg 9A(4)** | Audit Committee reviews once a financial year | &sect;4a |
| Schedule B cl. 1 | compliance officer reports not less than once in a year | &sect;4d |
| Reg 55 | credit rating reviewed at least once a year | debt |

So three hand-authored rules had been carrying periods that nothing had ever
checked, in a corpus whose whole claim is that its periods are held to the text.

### Two shapes, kept apart from the deadline pattern deliberately
`CADENCE_N` reads *once every N &lt;unit&gt;*; `CADENCE_1` reads *once a / once
in a &lt;unit&gt;*, where no number means one. **Loosening `FILLER` to reach
across "once every" would let it reach across anything else** &mdash; a parser
that matches more than it understands is &sect;2x's check that cries wolf,
pointed at the law.

### And they all confirm
```
period compared            151 -> 154
period mismatch                     0
```

| | rule says | provision carries | |
|---|---|---|---|
| **Reg 23(1)** | 3 year | 3 year | &ldquo;such policy shall be reviewed by the board of directors **at least once every three years**&rdquo; |
| **Reg 31B(1)** | 5 year | 5 year | clean, single match |
| **PIT Reg 9A(4)** | 1 year | 1 year | clean, single match |

Reg 23(1)'s words are **current operative text**: footnote 204 reads *"Inserted
by ... w.e.f. 1.4.2019"*, so the bracket is an insertion and not a
&sect;3e-style quotation of wording since removed. Checked before trusting it,
because that trap has cost this project three sections.

**Reg 55 comes back `noctx`** &mdash; the provision was located and no readable
span returned. Reported as itself rather than folded into "no period", which is
the whole point of having ten verdict codes.

### The parser now checks itself before it checks the law
`mutation.js` mutates `index.html`, and the only app-side artefact of this
parser is the **derived** blob the runner is deliberately blind to (&sect;4g).
So &sect;2t's rule &mdash; add the assertion that would have caught it &mdash;
had to land where the code lives.

`PARSER_CASES` pins **both** shapes of every form: digit and spelled cadences,
and the seven deadline shapes that were each a real bug here &mdash; `se ven`,
`forty -five`, `w ithin`, `twenty one`, `2 working days`, `a period of`. The
gate **exits 2 and names the failing cases** if any stops parsing.

&sect;3w is why both shapes are pinned: *"Digits-first fixed the digit case and
left every spelled one broken, which is worse than the bug it replaced because
it looked like progress."*

**Watched failing before being trusted** (&sect;3c): breaking the cadence branch
produces exit 2 and the four cases by name.

### One of my own, again
I asserted `LODR-REG-31B-1` without reading it; the id is `LODR-SUP-REG-31B`.
&sect;3t's *"I asserted values I had not read"* &mdash; and the suite caught it
in the same minute, which is what it is for.

### Coverage
Suite **788 &rarr; 796**, mutations **204 caught, 0 missed, 0 skipped**, smoke
105, backend 96. Gate **151 &rarr; 154 periods compared of 419 (37%)**, 0
mismatches.

### What this does and does not mean
Three more rules are now held to the text they cite. **It still verifies
nothing** &mdash; Rule Governance reads "Never checked" for all 419, and the
number that matters is unchanged. What moved is that the audit stopped being
quietly wrong about 5 rules, and says so about Reg 55 rather than guessing.

---

## 4i. THE SIXTEEN, READ ONE BY ONE (v199)

*"now do the remaining ones from that list of 16"*. All sixteen read against
the held texts. **Thirteen were the audit's own reading limits. Two were real.**

| | verdict |
|---|---|
| Reg 13(2), 13(3), 13(4) | the twenty-one days belongs to **Reg 13(1)**, which the corpus carries **correctly**. Whole-provision false positives |
| Reg 23(1) | a **parser** gap, not a rule gap &mdash; fixed and confirmed in &sect;4h |
| Reg 23(2), 23(3), 23(9), 31(2) | all four state their period correctly (*"Prior to the transaction"*, *"Valid 1 year; quarterly review"*, *"Every six months, ON THE DATE of publication"*, *"Continuous"*). The detector matched a neighbour's number |
| Reg 31(1)(a) | states **"1 day prior to listing"** &mdash; correct. The parser needs a lead-in word and this has none |
| Sections 173, 174, 118 | the thirty days is **s.118 minutes**, already modelled **per meeting** from the meetings register (&sect;2l) |
| Section 82 | the thirty days is **s.82(1)**, already modelled as **CHG-4** from the charges register (&sect;2m) |
| Sections 12, 15 | s.12(1)'s thirty days is the **one-time establishment** deadline at incorporation; the rule is the **continuous maintenance** duty. A different obligation |
| PIT Reg 7(3) | **discretionary** &mdash; *"at such frequency as may be determined by the company"*. No period is missing |
| **Sections 101, 102** | **REAL** &mdash; s.101(1) fixes twenty-one clear days and the rule stated none |
| **PIT Reg 7(1)(b)** | **REAL** &mdash; the provision fixes seven days and the rule said *"Within prescribed timeline"* |

**Thirteen of sixteen.** &sect;2x's rule, measured: the automated version of this
check would be wrong four times in five, and shipping it as a screen would have
been worse than not having it.

### And a third thing, which is not a missing period
**`PIT-REG-7-1-14` cites a provision that no longer exists.** Reg 7(1)(a) reads
`63[***]` in the held text &mdash; **omitted with effect from 26 April 2021**.
The footnote records what it used to say: the one-time disclosure of holdings
*"as on the date of these regulations taking effect ... within thirty days"*.

The row is titled *"Initial holding disclosure"*, which is that clause's subject
exactly. It carries `needsReview: true` and states *"Within prescribed
timeline"*, so it asserts nothing false &mdash; but it is an obligation on a
listed company's register that **was repealed five years ago**, and a spent
transitional duty besides.

`pit_master.json` is generated and must not be hand-edited (&sect;2k), so this is
**reported, not silently repaired** (&sect;3j). The supplement names it in the
detail of the rule that replaces it, and it is the owner's call.

### The seven days is the PERSON'S, and saying so is the whole point
Reg 7(1)(b) binds *"every person on appointment as a key managerial personnel or
a director of the company or upon becoming a promoter"*, and the disclosure runs
**to** the listed entity.

So the company's duty is to **collect and hold** it &mdash; Reg 6(4) keeps these
five years (&sect;4a) &mdash; and the exchange intimation is a **separate**
obligation under Reg 7(2)(b) with its own two trading days. Claiming the seven
days as the entity's own deadline would put a filing on the register the company
does not owe: &sect;3y's s.84 and &sect;3z's Reg 30A, for the third time.

### "Clear" days, and a period that runs backward
s.101(1): *"A general meeting of a company may be called by giving not less than
clear twenty-one days' notice."*

**Clear days exclude both the day of service and the day of the meeting**, so
twenty-one clear days is longer than twenty-one days. And the period runs
**backward** from a meeting the company fixes &mdash; so dropping the word
*clear* gives a **later** last date than the Act allows. &sect;3z's inversion:
the same approximation that errs early on a forward deadline errs **late** on a
backward one.

The app has computed with this period since &sect;3d &mdash; the annual report is
anchored to the AGM less twenty-one clear days, because Reg 36(1) sends the
report with the notice. **The register itself had never stated it.**

Neither rule carries a date, and both say which kind of silence that is: the
period is certain and the **anchor is not held** (&sect;3x's third kind). The app
holds no register of appointments and no planned meeting date.

### The suite caught the thing I forgot
Adding both rules failed `[pit supplement] every undated rule that states a
period explains why it has no date` &mdash; &sect;4a's own invariant, enforcing
&sect;3e's *a blank is not an explanation*. I had written the rules and not the
explanations. Four corpus counts also had to move from eleven to twelve.

**That is the machinery working**: an invariant written three sections ago
refused a rule that did not meet it.

### Coverage
Suite **796 &rarr; 812**, mutations **204 &rarr; 209 caught, 0 missed, 0
skipped**. Smoke 105, backend 96. Gate **419 &rarr; 421 rules, 379 citations, 0
unresolved, 155 periods compared, 0 mismatches**. Verified live: both rows reach
a listed company's register undated with their explanation, register 301 &rarr;
303, zero console errors.

### The count that has not moved
**Rule Governance still reads "Never checked" for all 421.** Reading sixteen
provisions to settle sixteen questions about the audit is not the same as a
Company Secretary signing off a rule, and this file must not let one pass for
the other.

---

## 4j. AN OBLIGATION THAT NO LONGER EXISTS (v200)

*"remove that repealed reg 7(1)(a) row"*.

**This is the one direction &sect;3t names as the worse branch:** *"hiding an
obligation is the one failure in this product a CS cannot notice."* Every other
defect in this file shows itself &mdash; a wrong date looks like a date, a wrong
law looks like a law. A row that is simply gone looks like nothing at all.

So it was verified twice more before a line was written.

### The fact, checked again
```
7. (1) Initial Disclosures.
(a). 63[***]
```
Footnote 63: *"Omitted by ... (Amendment) Regulations, 2021 (w.e.f. April 26,
2021). Prior to omission, clause (a) read as under: 'Every promoter, member of
the promoter group, key managerial personnel and director of every company
whose securities are listed ... shall disclose his holding of securities of the
company as on the date of these regulations taking effect, to the company
within thirty days of these regulations taking effect'"*

It was a **one-time transitional** disclosure owed when the 2015 regulations
took effect &mdash; spent years before it was omitted.

**And nothing is lost.** Reg 7(1) contains only (a) and (b). (b) is live and
carried **twice**: by the generated `PIT-REG-7-1-B-15` and by &sect;4i's cited,
quoted `PIT-SUP-REG-7-1-B`. Measured before and after: both still on the
register.

### Struck in code, because the corpus is generated
`pit_master.json` is generated from the owner's spreadsheet and must not be
hand-edited (&sect;2k) &mdash; an edit there is lost the day the sheet comes
back. `LG_REPEALED` sits beside `LG_SCOPE_PATCH` (&sect;4f), the same place and
the same shape, and is consulted by **both** applicability engines so one law
cannot drift away from the other.

### Removed from the register, REPORTED on the screen
Not deleted. `cmApplies` refuses it, so it leaves the register &mdash; and
`lgExcludedFor` reports it under *Never applied to this entity*, with the
omitting instrument, its effective date and **the words the provision used to
carry**. &sect;3i: not on the list, but **because**.

Verified on the running app: register **303 &rarr; 302**, the row absent, and
the reason on screen in full.

### AN ENTRY WITH NO EVIDENCE HIDES NOTHING
The control that makes this table safe to have at all.

The mutation that blanked the prior wording was caught by a **crash** rather
than by name &mdash; &sect;4d, one release old. Fixing only the assertion would
have left the real hole: **a table entry missing its evidence still struck a
rule off the register.**

`lgRepealed` now requires the provision, the omitting instrument, its effective
date **and** the prior wording. Missing any one, the entry is **ignored and the
obligation stays**. That is &sect;3t's safe branch made structural rather than
promised: this table cannot make an obligation disappear on somebody's say-so,
because an entry without a citation does nothing at all.

Both mutations now fail **seven** assertions each, by name, because stripping
the evidence puts the rule back on the register *and* removes the explanation
&mdash; which is exactly what should happen.

### And an assertion that would have passed vacuously
`reasons.join(' ').indexOf(e.was.slice(0, 40))` throws when `was` is undefined,
and `indexOf('')` returns **0** when it is empty &mdash; so the obvious repair
(guard the undefined) would have produced a check that passes on an entry with
no prior wording at all. It requires the slice to be a full forty characters
before it looks for it.

### Coverage
Suite **812 &rarr; 827**, mutations **209 &rarr; 214 caught, 0 missed, 0
skipped**. Smoke 105, backend 96, gate 421 rules / 379 citations / 155 compared
/ 0 mismatches. Live: register 302, the repealed row reported with its full
reason, zero console errors.

### What this does NOT license
`LG_REPEALED` holds **one** entry and the bar for a second is the same: the
instrument, the date and the words. Nothing goes in on a reading of silence, on
a provision merely renumbered, or on an obligation that looks spent. The
register is allowed to carry something the owner no longer owes; it is not
allowed to drop something they do.

---

## 4k. A RULE THAT STATED THE LAW AS IT STOOD IN 2018 (v201)

The owner, on the two-week status: *"i dont have time to do this because i have
caught up with other work also..so i have you test this"*. So the reading is
mine and the signature stays theirs -- `govSave` still refuses a verification
with no instrument named, and a CS carries professional responsibility for it.

Scoped first, because the size of the job was the whole argument. Of 421 rules
**240 reach an equity-listed company**; 65 of those are hand-authored here and
already carry the words they were read from (&sect;3x). **175 come from the
owner's spreadsheet and nobody has ever read them against a text.**

And they are not equally checkable. LODR is amended to **14 July 2026** and PIT
to **12 March 2025**; the Act text is **01.04.2021**. So 126 can be checked
properly and **49 can only be matched against a five-year-old Act**, where a
tick proves much less. Stated before starting rather than discovered at the end.

### Eight rules in, one was quoting law repealed seven years ago
`LODR-REG-24-1` read *"...on the board of each unlisted material subsidiary
**incorporated in India**"*. Reg 24(1) was substituted by the 2018 Amendment
Regulations **w.e.f. 1.4.2019** and now reads *"...of an unlisted material
subsidiary, **whether incorporated in India or not**"* -- and footnote 239
quotes the rule's own wording as the text **prior to** that substitution.
Checked before claiming it, because &sect;3e's footnote trap has cost this
project three sections; here the footnote proved the corpus wrong rather than
the reading.

The direction is the dangerous one. A listed client with a material **foreign**
subsidiary was being told the independent-director duty did not reach it.
&sect;3t: **hiding an obligation is the one failure a CS cannot notice**, because
a missing row looks like nothing at all.

`lodr_periodic.json` is generated and must not be hand-edited (&sect;2k), so
`LG_TEXT_PATCH` sits beside `LG_DUE_PATCH` and `LG_SCOPE_PATCH` -- a date, a
class and now a wording, each carrying the provision it was corrected against.

**The evidence bar is structural, not promised.** An entry missing the
corrected wording, the provision or the reason is **ignored and the rule keeps
its original text** -- &sect;4j's rule, applied to text. A table that can rewrite
a statement of law on somebody's say-so is worse than the error it mends.

**Deliberately NOT corrected:** the regulation says *"an"* unlisted material
subsidiary and the rule says *"each"*. Whether one independent director covers
every material subsidiary is a reading this app does not settle, so the
stricter *"each"* is kept -- the safe direction -- and the question is named in
the patch's own `why`. &sect;3j: reported, not silently repaired.

### The review screen builds its own list and never patched
`lgAllRules` does not go through `lgPatchRule`. So the correction reached the
register and **the reviewer would have signed off the uncorrected wording in the
very screen built to catch it** -- &sect;3n exactly. It patches now, and
`govClaimBlock` prints *"Corrected against..."* with the instrument and date,
because a rule the app silently rewrote is not one anybody should certify.

### ELEVEN PROVISIONS THE AUDIT COULD NOT READ AT ALL
Not on the owner's list, and the read would have been blind without it.

The SEBI heading pattern required a sub-regulation marker -- `10. (1)`. A
regulation written as a **single paragraph** (`11. The listed entity shall
ensure...`) matched nothing, and **Reg 43A prints as `43A (1)` with no full
stop**. Reg 5, 8, 9, 11, 12, 14, 17A, 38, 43A, 48 and 55 were all invisible.

A provision that cannot be located reads as *"nothing to check"* -- &sect;3v's
defect, where this audit compared six of 327 rules and reported *"period
mismatch: 0"*. **Reg 55 is also the cadence &sect;4h could not read**, reported
then as `noctx`; this is why.

**Two guards, both earned by a measured regression rather than reasoned about:**
- making the full stop optional let a **cross-reference** (`regulation 17 (1)`)
  claim a heading;
- the extraction prints a running header `<<<PAGE 27>>> 27`, so a **page number**
  followed by a list item `(1)` impersonated one. **Reg 27 and Reg 57 both
  pointed at the wrong text** before the guard went in. &sect;3f again -- the
  text contains numbers that are real, current, and about something else.

Verified before writing: **116 -> 142 provisions located, zero existing spans
moved, zero lost.** Gate periods compared **155 -> 158**, mismatches 0.

`LOCATOR_MUST_RESOLVE` / `LOCATOR_MUST_NOT_MOVE` give it the self-check the
period parser got in &sect;4h, for the same reason: `mutation.js` mutates
`index.html` and cannot reach `tools/rule_audit.py` at all. Both directions are
pinned, because &sect;3w is explicit that fixing one shape and breaking the other
"looked like progress". Watched failing before being trusted (&sect;3c): exit 2,
naming Reg 43A.

### The year selector disagreed with its own screen by 172 rows
```
the selector offered        2026-27 (82)
choosing it actually showed 254 rows
```
`lgApplyFyFilter` **keeps** a row with no period end, deliberately -- hiding
"maintain the registered office" behind a year filter would let choosing a year
silently switch off a duty that never stops applying (&sect;3k). `lgFyList`
**skips** those same rows when it builds the label, because `lgFyOfPeriod(null)`
is falsy. **Two functions written to two different rules**, in the section that
built the feature.

The filter is correct. The number beside it broke the standing constraint that
every number be traceable to an underlying record -- this one traced to a
different record set from the screen it opened.

Kept at 82 on the owner's call, and made to say what it counts: `2026-27 (82
dated to it)` with `+ 172 continuous, shown in every year` beside it. Raising it
to 254 would have made every year read alike and lost the signal that 2026-27
carries more dated work than 2025-26.

### Three blind spots in my own new tests, all found by the runner
- **A mutation that was a no-op.** `out.textPatchedFrom = ''` was inserted
  directly above `out.textPatchedFrom = e.from;`, which overwrote it on the next
  line. &sect;3r's shape exactly. Re-anchored onto the assignment itself.
- **An assertion that passed vacuously.** The evidence-bar test called
  `lgTextPatch` with an id that has **no entry at all**, so it returned at
  `if(!e)` and never reached the bar -- it passed whether the bar existed or
  not. &sect;4j warned about this precise repair and I made it anyway. Three real
  partial entries are now injected and removed (&sect;3e: when the data cannot
  exercise a guard, test the guard's contract).
- **The label reached no assertion.** I asserted `lgFyContinuous` and the
  arithmetic relation and never what the reader sees, so reverting the option to
  a bare `(82)` went MISSED. &sect;3n/&sect;2j, **fourth time in this project**.
  `lgFyLabel` is a pure function now, because a label the suite cannot call is
  one nothing can test (&sect;2y).

### And a reading of my own tooling that was an artifact
One mutation run reported **212 caught, 9 missed**. It was launched in the
background and I kept editing `index.html` while it read the repo. A suite run
against files being written underneath it measures nothing. Re-run clean:
**221 caught, 0 missed, 0 skipped.** Worth keeping as a rule -- *never run the
mutation suite concurrently with an edit to the files it reads.*

### Coverage
Smoke **105**, suite **827 -> 852**, mutations **214 -> 221 caught, 0 missed, 0
skipped**, backend **96**. Gate: 421 rules, 379 citations, **158 periods
compared (38%), 0 mismatches**.

### What this does NOT do
**It verifies nothing.** Rule Governance still reads "Never checked" for all
421. Eight of the 126 readable rules have been read; 118 remain. What changed is
that one of them was stating repealed law on a live register, and no longer is.

---

## 4l. READING 288 RULES BY LOOKING FOR ONE SIGNATURE (v202)

&sect;4k found `LODR-REG-24-1` by reading eight rules by hand. At that rate the
175 never-read rules were days of work, so the question became: **what did that
defect look like mechanically?**

Its wording appeared in the provision it cites **exactly once, inside footnote
239**, which reads *"Prior to the substitution, sub-regulation (1) read as
follows"*. The operative text said the opposite. That is a signature, and it
can be searched for.

`stale_wording.py` normalises to letters only (defeating `w ithin`,
`forty -five` and inline footnote markers in one move, as &sect;3z established),
pulls distinctive three-word runs out of each rule's own title, and asks whether
**every** occurrence in the cited provision sits inside a superseded quote.

**288 rules read mechanically. 13 flagged. Reg 24-1 was one of them** &mdash;
the detector independently found the defect already known, which is the only
reason to believe anything else it said.

That run used a snapshot of the audit library taken **before** the v201 locator
fix. As shipped it reads **297 and flags 12**: the corrected locator bounds Reg
17 at Reg 17A instead of running past it, so Reg 17(10) now resolves against
operative text. **The Reg 17(10) finding below is unaffected** &mdash; it was
settled by reading the provision, not by trusting the detector &mdash; but the
two counts describe the same tool and both belong here.

### Precision is poor, and that is why it is a shortlist and never a screen
Of the 13, **ten were false positives**, for two distinct reasons worth keeping:

- **`69[...]` marks an INSERTION, not a repeal.** These compilations bracket
  substituted-in text with its footnote number, so live text sits inside
  brackets that look exactly like dead text. Reg 10(1A), Reg 13(2), Reg 58(1).
- **A flat lookbehind crosses a sub-provision heading.** Reg 17(3)'s wording is
  plainly operative &mdash; `<<<PAGE 33>>> 33 (3) The board of directors shall
  periodically review compliance reports` &mdash; and was flagged because an
  unrelated footnote about an *Explanation* fell inside the 500-character
  window behind it.

Adding a "sub-provision heading intervenes" test to fix the second made the
detector report **Reg 24-1 as operative** &mdash; a false negative on the one
case known to be true, because the footnote's *quoted prior text* contains
sub-provision headings of its own. So the refinement was **withdrawn and the
context printed instead**, the same call &sect;3v made when a narrowing was
wrong half the time. &sect;2x: a screen that is wrong four times in five is
worse than no screen.

### The one it found: Reg 17(10) under-states the duty
```
rule said       "Performance evaluation of independent directors by the
                 entire board of directors."

Reg 17(10) now  "The evaluation of independent directors shall be done by the
                 entire board of directors WHICH SHALL INCLUDE - (a)
                 performance of the directors; and (b) fulfillment of the
                 independence criteria ... and their independence from the
                 management."
```
The 2018 Amendment Regulations (w.e.f. 1.4.2019) **added a limb**. A board that
evaluates performance alone has not complied &mdash; and the limb it misses is
the independence assessment, which is the whole point of evaluating an
**independent** director. Same class and same direction as Reg 24(1):
&sect;3t's branch a CS cannot notice. Corrected through `LG_TEXT_PATCH`.

### Three the shortlist raised and the reading cleared
- **Reg 52(7)/(7A)** &mdash; the rule covers both current limbs, utilisation
  *and* material deviation. The flagged phrase was "use of proceeds"; the
  current text says "use of **issue** proceeds".
- **Reg 24A(1)(a)** &mdash; **"incorporated in India" IS live here.** The same
  four words that are repealed in Reg 24(1) are current in Reg 24A. That is
  exactly why the Reg 24(1) fix was scoped to one rule id rather than to a
  phrase.
- **Reg 62M(1)** &mdash; describes annexing the report, which was replaced by a
  cross-reference to Reg 24A on 22.1.2026. The substance is unchanged and
  Reg 24A does require it, so this is wording currency, not a wrong obligation.
  Reported, not patched (&sect;3j) &mdash; and it is HVDLE, so it reaches no
  equity-listed book.

### A mutation that removed wording no assertion looked at
Reg 17(10)'s added limb has two parts joined by "and" &mdash; *fulfilment of
the independence criteria* **and** *their independence from the management*. I
asserted the first and mutated the second, so the mutation went **MISSED**
against a build that had the bug. &sect;2t: strengthen the assertion, do not
move the mutation. Both parts are the obligation, so both are asserted, and
performance with them.

### Coverage
Smoke **105**, suite **852 -> 859**, mutations **221 -> 222 caught, 0 missed, 0
skipped**, backend **96**, gate clear at 421 rules / 158 periods / 0 mismatches.

### What this does and does not establish
**Two rules in the corpus were stating repealed law, and both now state the
current text.** 288 of 327 generated rules have been checked **against one
signature only** &mdash; wording that survives solely inside a superseded quote.
A rule that is wrong in some other way, or that omits an obligation entirely,
is invisible to this and remains so. Rule Governance still reads "Never checked"
for all 421.

---

## 4m. THE COMMITTEE THE REGISTER NEVER SAID TO CONSTITUTE (v203)

The owner: *"ok do 2"* &mdash; the sub-provision completeness pass, chosen over
finishing the correctness read because **a wrong rule is visible on the register
and a CS can catch it; a missing one cannot be caught by anybody.**

**The register told an equity-listed company to hold four audit committee
meetings a year and never told it to constitute the audit committee.** Same for
the Nomination and Remuneration Committee, the Stakeholders Relationship
Committee and the Risk Management Committee. Every committee obligation in LODR
was a meeting cadence with no committee behind it.

### Why no check could see it
&sect;3z's completeness pass asked *"which PROVISIONS does the corpus not
cite?"* Reg 18 is cited &mdash; by Reg 18(2)(a), the meeting rule &mdash; so Reg
18 looked covered while **Reg 18(1) was absent**.

&sect;4a wrote the warning one release later, about PIT: *"Reg 3 has six
sub-regulations and the corpus cited two. A completeness check that stops at the
provision number would have reported PIT as almost done."* **That warning was
never applied back to LODR.**

A missing rule cannot be wrong, it is absent (&sect;3x). Nothing turns red, and
none of 859 assertions, 222 mutations or the release gate could see it.

### The count, and the two ways it was wrong first
| | |
|---|---|
| crude first pass | 144 |
| after rejecting out-of-sequence numbers | 111 |
| **after excluding provisions cited BARE** | **94** |

Two corrections, both &sect;2z's *"the list was right and the sentence counting
it was not"*:

- **Sub-regulations run in ascending order.** A `(1)` appearing after `(4)`
  inside a provision is quoted prior wording in a footnote &mdash; &sect;3z's
  repealed-span trap, one level down. 144 &rarr; 111.
- **A rule citing `Reg 41` with no sub-number summarises the whole provision.**
  Fifty provisions are cited that way, so their sub-regulations are not gaps.
  111 &rarr; 94.

### Twenty authored, and the scoping was read BEFORE the obligation
Reading the duty without reading who it binds is &sect;3y's s.84 and
&sect;3z's Reg 30A. Two facts settled first:

- **Reg 15(2)** &mdash; regulations 17 to 27 **do not apply** to a listed entity
  whose paid-up equity capital does not exceed Rs 10 crore **and** whose net
  worth does not exceed Rs 25 crore. Both limbs; it is "and". Every rule
  authored here carries it.
- **Reg 21(5)** &mdash; the whole of Reg 21 binds only the **top 1000** listed
  entities and an HVDLE. Authoring the Risk Management Committee as applying to
  every listed company would have been &sect;2z. This app holds no market
  capitalisation rank, so the row says the test **cannot be evaluated here**
  rather than asserting it applies.

Reg 17(1A), 17(1E), 17(2A), 17(4), 17(7); Reg 18(1), 18(3); Reg 19(1), 19(2),
19(2A), 19(4); Reg 20(1), 20(2), 20(2A), 20(4); Reg 21(1), 21(3), 21(3B),
21(4), 21(6). Every quote verified verbatim against the held compilation before
anything was written; **20 authored, 0 refused.**

### Three distinctions a CS is paid for, now on the register
- **Reg 18(1) needs TWO-THIRDS independent directors. s.177 of the Companies
  Act needs only a majority.** A listed entity must meet the stricter test, and
  the register carried neither.
- **Reg 19(2)** requires the NRC chairperson to be **independent**;
  **Reg 20(2)** requires the SRC chairperson only to be **non-executive**.
  Reading either across to the other is the common error.
- **Reg 19(2A)** says a quorum of two or one third "whichever is **greater**";
  **Reg 21(3B)** says "whichever is **higher**", and requires a **board member**
  in attendance rather than an independent director.

### The assertion is the invariant, not the four rule ids
> **If the register requires a committee to MEET, it must also require that
> committee to be CONSTITUTED.**

Naming Reg 18(1), 19(1), 20(1) and 21(1) would not catch the fifth committee
somebody adds later. The invariant would.

### Two assertions of mine that were wrong about correct code
- *"No corporate governance row carries an invented date"* swept every Reg 17-21
  row and caught **Reg 20(3)** &mdash; the SRC chairperson attending the AGM,
  which **is** AGM-anchored and correct. &sect;3u's mistake exactly, one release
  after &sect;2k created the rule it was enforcing.
- *"Every Reg 17-21 row names the Reg 15(2) exemption"* swept the **generated**
  rules too. **Reg 17(1) carries the note and Reg 17(2), 17(3), 17(8), 17(10)
  and 18(2)(a) do not**, though Reg 15(2) exempts a small listed entity from all
  of regulations 17 to 27. `lodr_periodic.json` is generated and must not be
  hand-edited (&sect;2k), so that is **reported, not repaired** (&sect;3j) &mdash;
  with an assertion that will fail the day it is fixed, so the note cannot go
  stale.

### And a check that was wrong about a real provision, for the second time
The quote invariant read only for **"shall"** and reported **Reg 17(7)** as
unbound. *"The minimum information **to be placed before** the board of
directors is specified in Part A of Schedule II"* binds by gerundive. &sect;4a
hit this precisely, with PIT Reg 3(3): narrowing a check until it is wrong about
a real provision is &sect;2x from the other direction. PIT needed three binding
forms; this is a fourth.

### An explanation that reached nothing
Reg 17(1E) states three months and carries no date, so &sect;3e's invariant
demands a reason &mdash; and the mechanism is the `LG_NO_DEADLINE_WHY` table,
not a field on the rule. My `noDeadlineWhy` field was read by nothing
(&sect;3n). Moved into the table and dropped from the JSON, so the reason lives
in one place. The period is certain and **the anchor is not held**: this app
keeps no register of board vacancies.

### Coverage
Register **302 &rarr; 322** on an equity-listed company; **0** on public,
private, OPC and LLP, each told the twenty do not apply with a reason
(&sect;3i). Suite **859 &rarr; 875**, mutations **222 &rarr; 226 caught, 0
missed, 0 skipped**, smoke 105, backend 96. Gate **421 &rarr; 441 rules**, 399
citations, 0 unresolved, 159 periods compared, 0 mismatches.

### What is still not done
**74 of the 94 sub-provision gaps remain** &mdash; Reg 23 to 27, Reg 30 to 33,
Reg 36, 39, 40, 43, 44, 46 and 47. Some are applicability or definitions rather
than obligations (Reg 15(1), 16(1)), some bind SEBI (Reg 13(5)) or the exchange
(Reg 31A(2)), and some bind directors personally rather than the entity (Reg
30(11A), Reg 30A(1)) &mdash; but **none of those has been read yet**, so which
is which is unknown rather than zero.

And the correctness read of the 85 generated LODR rules is **unfinished**.
Nothing here verifies a rule: Rule Governance reads "Never checked" for all 441.

---

## 4n. THE REST OF THE SUB-PROVISION PASS (v204)

&sect;4m authored twenty of the ninety-four gaps and named the remaining
seventy-four as *"none of those has been read yet, so which is which is unknown
rather than zero."* All seventy-four read. **Forty-three authored, thirty-one
excluded with a reason.** The LODR supplement goes 38 &rarr; 81 rules and the
corpus 441 &rarr; 484.

### Three obligations the corpus had no rule for under ANY citation
Checked by searching every LODR rule's title and detail before authoring, not
by trusting the gap list &mdash; three copies of one figure is how &sect;3n's
penalties screen went five years stale.

| | |
|---|---|
| **Reg 44(1)** | **remote e-voting for ALL shareholder resolutions.** The register carried Reg 44(3), submitting the voting RESULTS, and never the duty to provide the facility |
| **Reg 25(10)** | **Directors and Officers insurance** for every independent director, top 1000 |
| **Reg 33(1), 33(2)** | **preparation, approval and authentication of the financial results** &mdash; the register carried the submission deadlines under Reg 33(3) and nothing about how the results are made or approved |

And **Reg 26(1)**, the ten-committee and five-chairmanship limit, existed only
as **Reg 62O** &mdash; the HVDLE copy, which can never reach an equity issuer.
The same shape as the audit committee in &sect;4m: the obligation was in the
file, scoped to somebody else.

### Reg 30(1) was absent, and my own earlier table said it was not
The residual materiality duty &mdash; *"any events or information which, in the
opinion of the board of directors, is material"* &mdash; is what catches an
event Schedule III does not list. The register holds **25 rules citing Reg
30(2)**, the deemed-material list, and none citing Reg 30(1).

&sect;4m's first table reported Reg 30 as citing sub-provision (1). That was a
**false match on `Reg 30 r/w Sch III Part A A(1) proviso`**, where the regex
took the `(1)` of the Schedule item. &sect;2z's shape for the fourth time in
this project: the list was right and the sentence counting it was not.

### Quotes are EXTRACTED, not retyped
Each rule's quote is pulled from the held compilation by the authoring script,
so a paraphrase cannot creep into a field that must be verbatim &mdash;
&sect;3z caught two quotes where mine had. **43 authored, 0 refused.**

**One came out a stub and the length floor let it through.** Reg 6(2) reads
*"The compliance officer of the listed entity shall be responsible for -"* and
then the extraction prints **900 characters of footnotes** before the (a) to
(d) limbs resume on the next page. The quote showed who is bound and not what
the duty is, which is half of &sect;3x. Stitched across the footnote block and
verified **limb by limb**, as &sect;3z does for the two quotes that span
sub-clauses, and marked `quoteStitched` so it cannot pass as contiguous.

The other eight short quotes were checked and are **complete sub-provisions**:
Reg 21(1) genuinely is one sentence.

### Reading the period without reading the subject, twice more
- **Reg 40(5)'s sixty working days binds the TRANSFEROR**, who must serve a
  prohibitory order within them. The entity's duty &mdash; not to register the
  transfer &mdash; has no period at all. Claiming the sixty days would put a
  deadline on the company that Reg 40(5) does not impose. &sect;3y's s.84 and
  &sect;3z's Reg 30A, now a third and fourth time.
- **Reg 25(8)** binds every independent director to submit the declaration.
  The entity's duty is **Reg 25(9)**: to assess its veracity and take it on
  record. Only Reg 25(9) is authored, and it names Reg 25(8) in its detail.

### Thirty-one excluded, each with its reason recorded
Applicability and interpretation (Reg 15(1), (1B), (1C), (2), (2A), (3), Reg
16(1), 21(5), 23(5), 23(6), 24(7), 32(8), 33(5), 40(11), 43(3)); duties on
somebody else (Reg 13(5) binds SEBI, Reg 31A(2) the stock exchange, Reg 30(11A)
the promoter, director, KMP or senior management, Reg 26(2) every director);
discretionary in terms (Reg 19(3), 27(1), 30(11) &mdash; though **Reg 30(11)'s
proviso IS mandatory for the top 100 and top 250**, a rank not held here, so it
is named rather than asserted); HVDLE-only (Reg 25(12)); and **Reg 23(8), which
is spent** &mdash; it required existing material related party contracts to go
to the first general meeting after these regulations were notified, in 2015.
&sect;4j's treatment of the repealed Reg 7(1)(a): an obligation that no longer
bites is not carried.

### Chapter III binds a debt-only issuer, which may be an unlisted company
Reg 6(2), 7(2) and 10(2) are scoped `equity, ncs, hvdle`, not equity alone.
&sect;4b established that a **private company with listed NCDs** owes Chapter V
and Chapter III and nothing under Chapter IV. Scoping these to equity would
hide them from exactly the entity Chapter III exists for.

### And a &sect;2j trap in my own assertions
Two new assertions read `quote` **off the register row**. `getComplianceChart`
copies only selected fields onto a row, and `quote` is not among them &mdash;
so both read `undefined` and failed. That is the defect this project has
recorded four times, committed inside the test written to catch it. They read
the rule now.

### Coverage
Register **322 &rarr; 365** on an equity-listed company; **0** on public,
private, OPC and LLP, each told all eighty-one do not apply with a reason.
Suite **875 &rarr; 892**, mutations **226 &rarr; 231 caught, 0 missed, 0
skipped**, smoke 105, backend 96. Gate **441 &rarr; 484 rules**, 442 citations,
0 unresolved, 159 periods compared, 0 mismatches.

### What this does and does not close
**LODR Chapters III and IV are now read at sub-provision level.** That is the
first time any law in this corpus has been.

It does not touch: **Chapter V and V-A at sub-provision level** (the debt and
HVDLE chapters, authored provision-level in &sect;4b); **the Companies Act,
PIT and Depositories corpora**, which have had provision-level passes only and
will carry the same class of gap; and **the Schedules**, where Schedule II
Parts A to E are cited by these rules and carried as cross-references rather
than as items.

And the correctness read of the 85 generated LODR rules is still unfinished.
Nothing here verifies a rule: Rule Governance reads "Never checked" for all
484.

---

## 4o. THE ACT, PIT, AND SCHEDULE II (v205)

The owner set the scope: *"do only these Companies Act, PIT and the Schedules
... ignore LODR Chapters V and V-A (debt, HVDLE) and Depositories corpora as my
focus is only on equity only."* Debt and Depositories untouched.

**Ten rules authored, 78 Schedule II items carried, and one finding about the
reference text itself that is worth more than any of them.**

### THE HELD COMPANIES ACT IS MISSING AN AMENDMENT BEFORE ITS OWN STATED DATE
This file has said since &sect;2c that the Act text is *"as amended upto
01.04.2021 &mdash; over five years stale"*. It is worse than stale.

**s.92(3) in the held text still reads *"An extract of the annual return ...
shall form part of the Board's report."*** That wording was substituted
**w.e.f. 28 August 2020** &mdash; the MGT-9 extract replaced by the web link of
the annual return &mdash; which is **sixteen months before the date the text
claims**. The current wording appears nowhere in the file: zero occurrences.

Calibrated rather than assumed, against seven known pre-2021 amendments:

| | commenced | in the held text |
|---|---|---|
| s.92(3) web-link of the annual return | 28.08.2020 | **NO** |
| s.137(3) penalty of ten thousand rupees | 21.12.2020 | yes |
| s.135(6) Unspent CSR Account | 22.01.2021 | yes |
| s.135(5) three preceding financial years | 22.01.2021 | yes |
| s.149(1) woman director | 01.04.2014 | yes |
| s.403 one hundred rupees per day | 07.05.2018 | yes |
| s.184(1) first Board meeting each FY | 01.04.2014 | yes |

**One of seven.** And my first run said two of seven, because I searched for
*"first meeting of the Board of Directors"* where the Act says *"first meeting
of the Board"*. &sect;3t &mdash; asserting a value I had not read &mdash; caught
by reading it.

**Confirmed independently, from inside the app.** `CHK_DIRREP` item (a) already
reads *"The web address, if any, where the annual return under s.92(3) has been
placed"*. The owner's own checklist carries the current wording while the
reference text carries the repealed one. There is now an assertion that it
keeps doing so.

**So s.92(3) is deliberately NOT authored.** A rule from that text would put the
abolished MGT-9 extract on a live register &mdash; the Reg 24(1) defect of
&sect;4k, self-inflicted. There is an assertion refusing any rule cited to it.

### The gap counts were wrong twice more before they were right
| | CA | PIT |
|---|---|---|
| first pass | 47 | 15 |
| after excluding s.2, the definitions section | 39 | 15 |
| **after excluding sections cited BARE** | **24** | **3** |

Two parser corrections, both &sect;2z's shape:
- **A citation can name several sub-provisions.** `Section 100(2), (4)` cites
  both, and the parser took only `(2)` &mdash; so s.100(4), authored in
  &sect;3y, read as missing.
- **A section can be cited BOTH bare and with sub-numbers.** Rules cite
  `Section 92` *and* `Section 92(2)`. The parser saw the sub-citation and
  reported every other sub-section as a gap, including s.101(2) to (4) and
  s.177(2) to (10), which bare summary rules carry.

### Ten authored; what the Act pass actually found
**The IEPF transfers were absent.** The register carried s.124(1) &mdash; move
unpaid dividend to the Unpaid Dividend Account &mdash; and neither of the two
transfers that follow:

- **s.124(5)** &mdash; money unpaid or unclaimed for **seven years** goes to the
  Fund under s.125, with interest and a statement. (The Act does not use the
  words "Investor Education and Protection Fund" here; it says *"the Fund
  established under sub-section (1) of section 125"*. My first assertion
  required the full name and failed against a correct rule.)
- **s.124(6)** &mdash; **the SHARES themselves**, where dividend is unpaid or
  unclaimed for **seven consecutive years**. Not the dividend: the holding. A
  single year of payment resets the count.

Also s.100(6) (reimburse requisitionists and recover from the defaulting
directors' fee), s.124(2) (statement within ninety days, on the website),
s.124(3) (interest at twelve per cent to the MEMBERS, not the Government),
s.129(2) (lay the financial statements before every AGM) and s.129(5) (disclose
a deviation from the accounting standards, its reasons AND its financial
effects).

**PIT: Reg 6(1), 6(2), 6(3)** &mdash; the form and content of every Chapter III
disclosure. Reg 6(2) brings in **immediate relatives and anyone for whom the
discloser takes trading decisions**; Reg 6(3) brings in **derivatives at traded
value**. A company collecting only an insider's own cash trades is collecting an
incomplete disclosure.

### s.100(6) reached a One Person Company, and a year-old assertion caught it
&sect;3y recorded that *"s.100 is correctly absent for an OPC, which holds no
general meeting"*. I authored the reimbursement limb against every company
class. The assertion written then failed immediately. s.129(2) was scoped
correctly from the start for the same reason &mdash; no AGM, no duty to lay
accounts before one.

### A CITATION STRING IS NOT UNIQUE ACROSS LAWS
Two assertions in this suite filtered `lgExcludedFor` by comparing a row's
section text to a corpus's regulation strings. **PIT Reg 6(2) and LODR Reg 6(2)
are different obligations sharing one string**, so each count pulled in the
other law's rows &mdash; 81 became 84, and 15 became 17. Both now match on the
law as well, and an assertion records that the collision exists so the shortcut
cannot come back.

### Schedule II Parts A to D, carried as items
The register cited them as cross-references &mdash; *"as specified in Part C of
Schedule II"* &mdash; and **the items themselves were on no screen at all**.

**78 items: Part A 15, Part B 4, Part C 38, Part D 21.** They live in the
**Checklists** panel, not the register, because &sect;2z built that panel for
exactly this: clause-level content worked through rather than filed on a date,
where s.134(3)(a)-(q) and s.143(3)(a)-(j) already sit. Eighteen dated rows would
not have been improved by burying them under seventy-eight undated ones
(&sect;3o).

**Part E is NOT carried.** Reg 27(1) says the entity *"may, at its discretion"*
comply with it. A discretionary Part listed as a checklist of duties asserts
something the regulation does not &mdash; the same reason Reg 27(1) itself was
excluded in &sect;4n. There is a mutation that carries it and an assertion that
catches that.

Each Part is split by its own numbering &mdash; Part A and B by capital letter,
C and D by bracketed number &mdash; rather than one guessed shape (&sect;3q).
Every item is `held:true` because Schedule II **is** in the held compilation,
and `only:'listed'` because it binds a listed entity.

The extraction's split words ("a nd", "th e") are repaired **from an explicit
list**, not by a general rule that would merge real words. That is the opposite
call from &sect;4g, which leaves a rule's verbatim `quote` broken so a reviewer
sees the text they are collating against; a checklist item is read, not
collated.

### Coverage
Register **365 &rarr; 375** listed, **63 &rarr; 70** public and private,
**61 &rarr; 66** OPC, LLP unchanged at 3. Suite **892 &rarr; 921**, mutations
**231 &rarr; 236 caught, 0 missed, 0 skipped**, smoke 105, backend 96. Gate
**484 &rarr; 494 rules**, 452 citations, 0 unresolved, 159 periods compared, 0
mismatches. Checklist tabs **5 &rarr; 9**.

### What is still not read
- **34 Companies Act sections cited BARE** &mdash; one summary rule each for
  s.134, s.149, s.173/174/118, s.177/178 and thirty more. A single rule titled
  "Board's Report and statutory disclosures" does not carry s.134(3)'s
  seventeen clauses. This is the largest remaining gap in the corpus and it is
  **unmeasured**.
- **LODR Chapters V and V-A, and the Depositories corpus** &mdash; excluded by
  the owner, equity-only focus.
- **Schedule III, IV, V and VI** &mdash; Schedule III Part A is carried as 125
  event rules; the others are not read.
- The correctness read of the 85 generated LODR rules.

Nothing here verifies a rule. Rule Governance reads "Never checked" for all 494.

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
- **Write patch scripts with the Write tool — this has now failed TEN times, in
  three different ways.** &sect;4f was the ninth and &sect;4g the tenth, **one
  release apart, same reflex**: every patch written correctly with the Write
  tool, then a bash heredoc reached for to make one small edit *to a patch
  script*. **The quick edit is the one that gets done with a heredoc.** There is
  no size below which it is safe.
- **Anchor a patch on code, never on a decorative comment.** &sect;4g counted 32
  box-drawing dashes where the file has 48. A rule made of repeated characters
  is not a landmark. A shell heredoc turned `\b` into a literal 0x08 and ate
  backslashes (§2x, §3c, §3t, §3w, §3x). CRLF in a patch script would not match
  an LF target (§3c). And in §4a, prose passed through `python -c` inside a bash
  double-quoted string had **every backtick-quoted identifier removed by command
  substitution** — `appliesToText`, `cmApplies` and `lgExcludedFor` silently
  vanished from a paragraph *about* them, and the script still printed OK.
  Backticks are markdown in this file and shell everywhere else.
- **A hand-authored corpus ships TWICE.** `rules/<name>.json` in the repo and an
  inline JSON blob in `index.html`. **Editing the file changes nothing the app
  reads** — re-embed it. Smoke §6b now compares all five for exact equality and
  names the fix, because the only symptom of the drift was a mutation anchor
  that started matching twice (§4b).
- **JS validation habit:** extract the main script (`html[html.rfind('<script>')+8 : html.rfind('</script>')]`) and `node --check` it before every deploy.
- **Run the suite before every deploy:** `node tests/smoke.test.js` (105 structural checks), `node tests/compliance.test.js` (921 assertions, run against `index.html` itself), `node tests/mutation.js` (236 bugs reintroduced against **both** suites, all caught), `python tools/rule_audit.py` (the release gate — 494 rules across eight corpora; it reports how many periods it actually compared, currently 158, and self-checks its own period parser AND its provision locator before it reads a line of law), and `node tests/backend.test.js` (96 checks against the live Supabase project — read-only, safe against production). See `tests/README.md`.
- **`python tools/rule_audit.py` regenerates `rules/audit_findings.json` AND
  re-embeds it into `index.html` as `var LG_GATE`** — on every run, not behind
  a flag, so the reviewer's evidence cannot drift behind the gate that produced
  it. `tests/mutation.js` counts anchors with that blob REMOVED: it carries 149
  KB of quoted statute and made a previously-unique anchor match four times
  (&sect;4g).
- **`python tools/amendments.py` regenerates the amendment evidence AND re-embeds
  it into `index.html`.** It reads the compilations in `reference/`, which is
  gitignored — so `rules/amendments.json` and `rules/amendments_embed.json` are
  committed, because a fresh clone cannot rebuild them. Run it whenever a text in
  `reference/` is replaced. The quotes it carries are footnotes from **official**
  government publications (SEBI's own consolidated regulations, the India Code
  Act), not a commercial compilation — checked before committing, because GitHub
  Pages serves this repo publicly.
- **No AI model auto-updates to current law.** Staying current = fetch fresh sources (RSS via rss2json/allorigins for SEBI/MCA/IBBI/RBI/IncomeTax) + human curation + (optionally) paid web-search. Vetted human templates + AI drafting is the right model.
- **Drafting quality:** resolution/notice prompts (`RES_SYS`, `DOC_SYS`) were tuned to a senior-CS standard (exact sub-section citations with read-with clauses, SEBI LODR cross-refs, full RESOLVED THAT/FURTHER THAT cascade, standard severally-authorised CS clause, Certified True Copy headers, Section 102 explanatory statements, MCA form+deadline line). There's an anti-reasoning guard telling the model to output ONLY the final document (some free models leaked their chain-of-thought). Keep these standards.
- **Child/again:** all AI legal output must carry a "verify on MCA/SEBI portal before filing" caveat — the CS signs and carries professional responsibility.

---

## 7. WHERE THINGS STAND / WHAT'S NEXT

**Header is at v205.** Phase 1 of the owner's implementation spec is complete; Phase 2 is in
progress. **Every migration through `db/026` is applied** — confirmed against the live database by `node tests/backend.test.js`, which identifies each one by a column only it creates rather than by a note in this file. `db/013` is the drop script, deliberately left commented out.

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
