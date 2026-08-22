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
- The CSR *spend* calculation (2% of average net profit over three preceding FYs) is not modelled
  at all — only applicability is.

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
- **No AI model auto-updates to current law.** Staying current = fetch fresh sources (RSS via rss2json/allorigins for SEBI/MCA/IBBI/RBI/IncomeTax) + human curation + (optionally) paid web-search. Vetted human templates + AI drafting is the right model.
- **Drafting quality:** resolution/notice prompts (`RES_SYS`, `DOC_SYS`) were tuned to a senior-CS standard (exact sub-section citations with read-with clauses, SEBI LODR cross-refs, full RESOLVED THAT/FURTHER THAT cascade, standard severally-authorised CS clause, Certified True Copy headers, Section 102 explanatory statements, MCA form+deadline line). There's an anti-reasoning guard telling the model to output ONLY the final document (some free models leaked their chain-of-thought). Keep these standards.
- **Child/again:** all AI legal output must carry a "verify on MCA/SEBI portal before filing" caveat — the CS signs and carries professional responsibility.

---

## 7. WHERE THINGS STAND / WHAT'S NEXT

**Done:** the three-identical-tabs bug is fixed and the diagnostic markers are removed (section 2). Header is at v8. The change is in the working tree — **not yet committed or pushed**, so the live site is still serving v7 until you deploy.

**Next up:**
1. Deploy v8 (commit + push; GitHub Pages rebuild ~1–2 min; hard-refresh). Confirm the header reads v8 and the three tabs differ on the live site with real Supabase data.
2. Clean up the dead code / duplicate function definitions found while debugging — several functions are declared twice (later silently wins) and `renderDashboard()` is inert because its target elements no longer exist. Also confirm whether there is any working "add company" UI outside the Supabase/admin path (`showAddClient`/`saveClient` are orphaned and reference markup that does not exist).
3. Then continue the spec build-out (remaining modules from the owner's brief): Regulatory Radar (real), Workflow Engine, Corporate Governance, Risk & Exceptions, Evidence & Audit, Reports, role-based views, dark mode.

**Running it locally:** `.claude/launch.json` is set up, or just `python -m http.server 8000` in the repo and open http://localhost:8000. Note that login needs real Supabase credentials; to exercise the UI without them, stub `loadCloudClients` to populate `CLIENTS` and call `enterApp()` — but be aware that stubbing around `enterApp()` is exactly what hid the v7 bug, so always test the real login path too.

---

## 8. QUICK REFERENCE

- Repo: `github.com/nittinsh/lawgovern` → `index.html` (+ `.nojekyll`)
- Live: `nittinsh.github.io/lawgovern`
- Supabase ref: `sykrgryrefwjerybyubq` | folder `C:\Users\NITTIN SHARMA\supabase`
- Deploy app: git commit + push. Deploy function: `supabase functions deploy ai-proxy`.
- Main data fn: `getComplianceChart(company)` → obligations. `CLIENTS` array from `loadCloudClients()`.
- Render fns: `renderCommandCenter`→`#cc-dash-root`, `renderUniverse`→`#cu-root`, `renderMyWork`→`#mw-root`, `openComplianceDetail`→`#cd-modal`.
- Never hardcode API keys. Keep the OpenRouter fallback model list. Keep the "verify on portal" caveats.
