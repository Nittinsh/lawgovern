-- ============================================================
-- GOVERNANCE REGISTERS
--   directors      — the board and KMP, per entity
--   shareholders   — the share register, per entity
--   meetings       — board, committee and general meetings
--   law_changes    — amendments the practice has decided are relevant
--
-- All four are the practice's own records: no external source, so no
-- verification gap. They feed obligations that could not previously be
-- evaluated — DIR-3 KYC per director, Sec 173 board-meeting cadence,
-- SBO identification, PAS-6 reconciliation.
--
-- Safe to run more than once.
-- ============================================================

-- ── Directors & KMP ─────────────────────────────────────────
create table if not exists directors (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,
  name           text        not null,
  din            text,                        -- 8 digits; null for a KMP without one
  designation    text        not null default 'director',
    -- director | independent | woman_director | managing_director | whole_time
    -- | nominee | additional | alternate | cs | cfo | ceo | manager
  appointed_on   date,
  cessation_on   date,                        -- null = currently in office
  cessation_type text,                        -- resignation | retirement | removal | disqualification | death
  din_kyc_on     date,                        -- last DIR-3 KYC filed
  email          text,
  nationality    text,
  is_kmp         boolean     not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists directors_company_idx on directors (company_id, cessation_on);
create index if not exists directors_din_idx     on directors (din);

alter table directors enable row level security;
drop policy if exists "directors_own_full" on directors;
create policy "directors_own_full" on directors
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());


-- ── Shareholders ────────────────────────────────────────────
create table if not exists shareholders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,
  name           text        not null,
  category       text        not null default 'promoter',
    -- promoter | promoter_group | public | institutional | foreign | employee | other
  holder_type    text        not null default 'individual',  -- individual | body_corporate | trust | huf | government
  pan            text,
  folio          text,                        -- folio or DP/client id
  shares_held    bigint      not null default 0,
  face_value     numeric,
  is_demat       boolean     not null default true,
  is_sbo         boolean     not null default false,   -- significant beneficial owner, Sec 90
  ben1_received  date,                        -- date the BEN-1 declaration came in
  ben2_filed     date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists shareholders_company_idx on shareholders (company_id, category);

alter table shareholders enable row level security;
drop policy if exists "shareholders_own_full" on shareholders;
create policy "shareholders_own_full" on shareholders
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());


-- ── Meetings ────────────────────────────────────────────────
create table if not exists meetings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,
  kind           text        not null default 'board',
    -- board | agm | egm | audit_committee | nrc | csr | stakeholders | rmc | class | creditors
  held_on        date,
  scheduled_for  date,
  mode           text        not null default 'physical',   -- physical | vc | oavm | hybrid
  venue          text,
  notice_sent_on date,
  attendees      integer,
  total_eligible integer,
  quorum_met     boolean,
  minutes_state  text        not null default 'pending',
    -- pending | drafted | circulated | signed | entered
  minutes_signed_on date,
  resolutions    integer     not null default 0,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists meetings_company_idx on meetings (company_id, held_on desc);

alter table meetings enable row level security;
drop policy if exists "meetings_own_full" on meetings;
create policy "meetings_own_full" on meetings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());


-- ── Change tracker ──────────────────────────────────────────
-- Deliberately user-curated. Deciding that a circular changes a particular
-- obligation is a judgement, and nothing in this system can make it: there is
-- no machine-readable mapping from an MCA or SEBI notification to the rows of
-- a compliance register. So a person records the change and what it affects,
-- and the entry carries their name.
create table if not exists law_changes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  title          text        not null,
  regulator      text        not null default 'MCA',   -- MCA | SEBI | RBI | IBBI | IT | Other
  reference      text,                        -- circular / notification number
  source_url     text,
  published_on   date,
  effective_from date,
  summary        text,
  impact         text        not null default 'review',  -- none | review | action | urgent
  affects_keys   text[],                      -- compliance_key values this changes
  affects_note   text,
  status         text        not null default 'open',    -- open | assessed | actioned | not_relevant
  assessed_by    text,
  assessed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists law_changes_idx on law_changes (user_id, published_on desc);

alter table law_changes enable row level security;
drop policy if exists "law_changes_own_full" on law_changes;
create policy "law_changes_own_full" on law_changes
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
