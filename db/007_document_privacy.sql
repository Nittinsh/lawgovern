-- ============================================================
-- §8/§9 DOCUMENT PRIVACY — consent, storage provider, retention.
--
-- Only claims the app can actually enforce are recorded here.
-- Scheduled deletion needs pg_cron (see the bottom of this file);
-- without it, expiry is enforced on access and by a purge action.
-- Safe to run more than once.
-- ============================================================

alter table compliance_status add column if not exists doc_storage    text;    -- where the file lives
alter table compliance_status add column if not exists doc_retention  text;    -- 'permanent' | 'temporary'
alter table compliance_status add column if not exists doc_expires_at timestamptz;
alter table compliance_status add column if not exists doc_consent_by text;    -- who consented
alter table compliance_status add column if not exists doc_consent_at timestamptz;

comment on column compliance_status.doc_storage    is 'Storage provider: app bucket, or a client-controlled repository.';
comment on column compliance_status.doc_retention  is 'permanent = kept until deleted; temporary = deleted at doc_expires_at.';
comment on column compliance_status.doc_expires_at is 'When a temporary document becomes due for deletion.';
comment on column compliance_status.doc_consent_by is 'Who gave explicit consent to upload (§9).';

-- ---------- purge expired documents ----------
-- Deletes the stored object AND clears the reference, so nothing dangles.
-- SECURITY DEFINER so it can reach storage.objects; restricted to expired rows only.
create or replace function purge_expired_documents()
returns table(purged_company uuid, purged_key text, purged_path text)
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  return query
  with due as (
    select company_id, compliance_key, evidence_file
    from compliance_status
    where doc_retention = 'temporary'
      and doc_expires_at is not null
      and doc_expires_at <= now()
      and evidence_file is not null
  ),
  gone as (
    delete from storage.objects o
    using due d
    where o.bucket_id = 'evidence' and o.name = d.evidence_file
    returning o.name
  )
  update compliance_status cs
     set evidence_file = null,
         doc_storage   = null,
         doc_expires_at = null,
         doc_retention  = null
    from due d
   where cs.company_id = d.company_id
     and cs.compliance_key = d.compliance_key
  returning d.company_id, d.compliance_key, d.evidence_file;
end;
$$;

revoke all on function purge_expired_documents() from public;
grant execute on function purge_expired_documents() to authenticated;

-- ---------- OPTIONAL: run it hourly ----------
-- Requires the pg_cron extension (Supabase: Database -> Extensions -> enable pg_cron).
-- Until this is scheduled, expiry is enforced when a document is accessed and by
-- the "Purge expired documents" action in the app. Do NOT promise clients
-- automatic deletion until this schedule exists.
--
--   select cron.schedule('purge-expired-docs', '0 * * * *',
--                        $$select purge_expired_documents()$$);

select column_name, data_type
from information_schema.columns
where table_name = 'compliance_status' and column_name like 'doc_%'
order by ordinal_position;
