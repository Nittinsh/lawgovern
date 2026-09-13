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
- **Run the suite before every deploy:** `node tests/smoke.test.js` (65 structural checks), `node tests/compliance.test.js` (603 assertions, run against `index.html` itself), `node tests/mutation.js` (151 bugs reintroduced against **both** suites, all caught), `python tools/rule_audit.py` (the release gate — 327 rules; it reports how many periods it actually compared, currently 122), and `node tests/backend.test.js` (94 checks against the live Supabase project — read-only, safe against production). See `tests/README.md`.
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

**Header is at v187.** Phase 1 of the owner's implementation spec is complete; Phase 2 is in
progress. **Every migration through `db/025` is applied** — confirmed against the live database by `node tests/backend.test.js`, which identifies each one by a column only it creates rather than by a note in this file. `db/013` is the drop script, deliberately left commented out.

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
