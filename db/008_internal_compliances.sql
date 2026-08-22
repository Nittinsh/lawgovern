-- ============================================================
-- INTERNAL COMPLIANCE TRACKING
-- Policies, SOPs, ISO checklists, registers, licences, insurance,
-- AMCs, training, internal audits — anything the organisation owes
-- itself rather than a regulator.
--
-- Entirely your own data: no external source, no verification gap.
-- Safe to run more than once.
-- ============================================================

create table if not exists internal_compliances (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid,                       -- null = applies across the practice
  title          text        not null,
  category       text        not null default 'policy',
    -- policy | sop | iso | register | licence | insurance | contract | training | audit | other
  reference      text,                       -- internal doc no., ISO clause, licence no.
  description    text,
  owner          text,
  frequency      text        not null default 'annual',
    -- one_time | monthly | quarterly | half_yearly | annual | biennial | as_needed
  first_due      date,
  last_completed date,
  next_due       date,
  status         text        not null default 'active',   -- active | paused | retired
  criticality    text        not null default 'medium',   -- low | medium | high | critical
  evidence_file  text,                       -- optional doc in the evidence bucket
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists internal_compliances_user_idx on internal_compliances (user_id, next_due);
create index if not exists internal_compliances_company_idx on internal_compliances (company_id);

alter table internal_compliances enable row level security;

drop policy if exists "internal_own_full" on internal_compliances;
create policy "internal_own_full" on internal_compliances
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Completion history, so a recurring item keeps its record rather than
-- overwriting last_completed each cycle.
create table if not exists internal_compliance_log (
  id            bigserial primary key,
  internal_id   uuid        not null references internal_compliances(id) on delete cascade,
  user_id       uuid        not null,
  completed_on  date        not null,
  completed_by  text,
  note          text,
  evidence_file text,
  logged_at     timestamptz not null default now()
);

create index if not exists internal_log_idx on internal_compliance_log (internal_id, completed_on desc);

alter table internal_compliance_log enable row level security;

drop policy if exists "internal_log_own" on internal_compliance_log;
create policy "internal_log_own" on internal_compliance_log
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

select table_name from information_schema.tables
where table_name in ('internal_compliances','internal_compliance_log');
