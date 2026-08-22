-- ============================================================
-- Maker–checker + evidence documents.
--
-- Splits "who recorded this" from "who confirmed it", so a filing
-- entered by one person must be confirmed by a different one before
-- the system treats it as verified. Adds a place to attach the actual
-- MCA challan / exchange acknowledgement.
--
-- Safe to run more than once.
-- ============================================================

-- ---------- 1. columns ----------
alter table compliance_status add column if not exists recorded_by   text;
alter table compliance_status add column if not exists recorded_at   timestamptz;
alter table compliance_status add column if not exists check_state   text default 'unchecked';
alter table compliance_status add column if not exists check_note    text;
alter table compliance_status add column if not exists evidence_file text;
alter table compliance_status add column if not exists confidence    text;

comment on column compliance_status.recorded_by   is 'MAKER — who entered the filing evidence.';
comment on column compliance_status.recorded_at   is 'When the evidence was entered.';
comment on column compliance_status.verified_by   is 'CHECKER — who confirmed it. Must differ from recorded_by.';
comment on column compliance_status.verified_at   is 'When it was confirmed.';
comment on column compliance_status.check_state   is 'unchecked | verified | rejected';
comment on column compliance_status.evidence_file is 'Storage path of the challan / acknowledgement, in the evidence bucket.';
comment on column compliance_status.confidence    is 'low | medium | high — derived from what was supplied.';

-- Backfill: anything already recorded was entered by whoever is on the row.
update compliance_status
   set recorded_by = coalesce(recorded_by, verified_by),
       recorded_at = coalesce(recorded_at, verified_at)
 where recorded_by is null
   and verified_by is not null;

-- A checker may not be the maker. Enforced in the database, not just the UI.
alter table compliance_status drop constraint if exists cs_checker_differs_from_maker;
alter table compliance_status add  constraint cs_checker_differs_from_maker
  check (
    check_state <> 'verified'
    or verified_by is null
    or recorded_by is null
    or verified_by <> recorded_by
  );

-- ---------- 2. storage bucket for evidence documents ----------
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

-- Files live under  evidence/<company_id>/<compliance_key>/<filename>
-- so ownership is derived from the folder, matching the companies table.
drop policy if exists "evidence_read_own"   on storage.objects;
drop policy if exists "evidence_write_own"  on storage.objects;
drop policy if exists "evidence_delete_own" on storage.objects;

create policy "evidence_read_own" on storage.objects
for select to authenticated
using (
  bucket_id = 'evidence'
  and exists (
    select 1 from companies c
    where c.id::text = (storage.foldername(name))[1]
      and c.user_id = auth.uid()
  )
);

create policy "evidence_write_own" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'evidence'
  and exists (
    select 1 from companies c
    where c.id::text = (storage.foldername(name))[1]
      and c.user_id = auth.uid()
  )
);

create policy "evidence_delete_own" on storage.objects
for delete to authenticated
using (
  bucket_id = 'evidence'
  and exists (
    select 1 from companies c
    where c.id::text = (storage.foldername(name))[1]
      and c.user_id = auth.uid()
  )
);

-- ---------- 3. confirm ----------
select column_name, data_type
from information_schema.columns
where table_name = 'compliance_status'
order by ordinal_position;

select id, name, public from storage.buckets where id = 'evidence';
