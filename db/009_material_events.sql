-- ============================================================
-- SEBI LODR Schedule III material events.
--
-- Unlike periodic filings these are TRIGGERED: an event occurs, a
-- clock starts (Reg 30 — 30 minutes from close of board meeting,
-- 12 hours if the event arose inside the entity, 24 hours if
-- outside), and the disclosure must reach the exchange in time.
--
-- Safe to run more than once.
-- ============================================================

create table if not exists material_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid        not null,
  company_id       uuid        not null,
  event_key        text        not null,      -- id from the generated rule set
  event_name       text        not null,
  schedule_part    text,
  regulation       text,

  occurred_at      timestamptz not null,      -- when the event happened
  deadline_at      timestamptz,               -- computed from the Reg 30 clock
  timing_basis     text,                      -- which limb was applied, in words

  -- Materiality is the Company Secretary's call unless the item is deemed
  -- material by Schedule III itself.
  materiality      text        not null default 'pending',
    -- deemed | material | not_material | pending
  materiality_note text,
  decided_by       text,
  decided_at       timestamptz,

  -- Disclosure
  disclosed        boolean     not null default false,
  disclosed_at     timestamptz,
  exchange_ref     text,
  disclosure_note  text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists material_events_open_idx
  on material_events (user_id, disclosed, deadline_at);
create index if not exists material_events_company_idx
  on material_events (company_id, occurred_at desc);

alter table material_events enable row level security;

drop policy if exists "material_events_own" on material_events;
create policy "material_events_own" on material_events
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

select table_name from information_schema.tables where table_name = 'material_events';
