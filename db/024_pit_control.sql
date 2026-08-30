-- ============================================================
-- PIT CONTROL CENTRE — SEBI (Prohibition of Insider Trading) Regulations, 2015
--
-- Both assessments call this a major differentiator and note that competitors
-- already market SDD and UPSI tooling. It is also the highest-consequence area
-- in the product: an insider-trading failure is not a late-filing penalty.
--
-- Grounded in the regulation text held in reference/sebi-pit-2015 (amended upto
-- 12 March 2025). The provisions these tables serve, verbatim:
--
--   Reg 3(5) — "the board of directors or head(s) of the organisation of every
--     person required to handle unpublished price sensitive information shall
--     ensure that a structured digital database is maintained..."
--
--   Reg 7(1)(b) — initial disclosure "within seven days of such appointment or
--     becoming a promoter".
--
--   Reg 7(2)(a) — continual disclosure "within two trading days of such
--     transaction if the value of the securities traded... " exceeds the
--     prescribed threshold.
--
--   Schedule B cl. 4(2) — "Trading restriction period shall be made applicable
--     from the end of every quarter till 48 hours after the declaration of
--     financial results."
--
--   Schedule B cl. 5 — re-opening "shall not be earlier than forty-eight hours
--     after the information becomes generally available."
--
-- Safe to run more than once.
-- ============================================================

-- ── Designated persons (Reg 9 r/w Schedule B cl. 3) ──────────
create table if not exists designated_persons (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,

  name           text,
  pan            text,
  din            text,
  designation    text,
  category       text,      -- director | kmp | promoter | promoter_group | employee | connected | other
  email          text,

  designated_on  date,      -- when they entered the designated universe
  ceased_on      date,

  -- Reg 7(1)(b): initial disclosure within seven days of appointment
  initial_disclosure_on date,

  relatives      text,      -- immediate relatives, as declared
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── UPSI items, and when they stopped being unpublished ──────
create table if not exists upsi_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,

  particulars    text,      -- what the information is
  category       text,      -- financial_results | dividend | fund_raising | m_and_a
                            -- | change_kmp | rating | order | other
  arose_on       date,      -- when it came into existence as UPSI
  published_on   date,      -- when it became generally available
  publication_ref text,     -- exchange filing / press release reference

  window_closed  boolean not null default false,  -- did this close the window
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── The structured digital database itself (Reg 3(5)) ────────
-- One row per sharing of UPSI. The regulation requires the nature of the
-- information, and the names and PANs of the person sharing it and the person
-- receiving it, with time stamps.
create table if not exists upsi_access (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,
  upsi_id        uuid,      -- the UPSI item shared

  shared_by      text,
  shared_by_pan  text,
  shared_with    text,
  shared_with_pan text,
  shared_at      timestamptz,
  purpose        text,      -- the legitimate purpose relied on
  mode           text,      -- email | meeting | call | dataroom | other

  notes          text,
  created_at     timestamptz not null default now()
);

-- ── Pre-clearance (Schedule B cl. 6 onwards) ─────────────────
create table if not exists pre_clearances (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,

  person         text,
  pan            text,
  requested_on   date,
  securities     text,
  quantity       numeric,
  estimated_value numeric,

  decision       text not null default 'pending',  -- pending | approved | rejected
  decided_on     date,
  decided_by     text,
  valid_until    date,      -- the window the approval is good for
  executed_on    date,      -- when the trade actually happened
  disclosed_on   date,      -- Reg 7(2) disclosure to the company

  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists designated_persons_company_idx
  on designated_persons (company_id, designated_on desc);
create index if not exists upsi_events_company_idx
  on upsi_events (company_id, arose_on desc);
create index if not exists upsi_access_company_idx
  on upsi_access (company_id, shared_at desc);
create index if not exists pre_clearances_company_idx
  on pre_clearances (company_id, requested_on desc);

alter table designated_persons enable row level security;
drop policy if exists "designated_persons_own_full" on designated_persons;
create policy "designated_persons_own_full" on designated_persons
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table upsi_events enable row level security;
drop policy if exists "upsi_events_own_full" on upsi_events;
create policy "upsi_events_own_full" on upsi_events
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table upsi_access enable row level security;
drop policy if exists "upsi_access_own_full" on upsi_access;
create policy "upsi_access_own_full" on upsi_access
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table pre_clearances enable row level security;
drop policy if exists "pre_clearances_own_full" on pre_clearances;
create policy "pre_clearances_own_full" on pre_clearances
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table upsi_access is
  'The structured digital database required by Reg 3(5). One row per sharing of '
  'UPSI, with who shared it, with whom, when and on what legitimate purpose. '
  'Reg 3(6) requires it to be non-tamperable and preserved for eight years — '
  'this table is append-oriented and nothing in the app offers to edit a row.';
comment on column upsi_events.published_on is
  'When the information became generally available. The trading window cannot '
  'reopen earlier than forty-eight hours after this (Schedule B cl. 5).';

-- ---------- confirm ----------
select table_name, count(*) as columns
from information_schema.columns
where table_name in ('designated_persons','upsi_events','upsi_access','pre_clearances')
group by table_name order by table_name;
