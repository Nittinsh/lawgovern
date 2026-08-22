-- ============================================================
-- §13 IMMUTABLE AUDIT TRAIL
-- Every status change writes a row here. Rows are append-only:
-- no UPDATE or DELETE policy exists, so history cannot be rewritten
-- from the application, only read.
-- Safe to run more than once.
-- ============================================================

create table if not exists compliance_audit (
  id               bigserial primary key,
  company_id       uuid        not null,
  compliance_key   text        not null,
  previous_status  text,
  new_status       text        not null,
  actor            text        not null,          -- who caused the change
  occurred_at      timestamptz not null default now(),
  verification_source  text,                      -- MCA / NSE / BSE / 'Entered by you'
  verification_method  text,
  filing_reference text,
  filing_date      date,
  source_url       text,
  source_response  text,                          -- API reference / response id
  confidence       text,
  override_reason  text,                          -- §14: required for a manual override
  user_id          uuid        not null
);

create index if not exists compliance_audit_lookup_idx
  on compliance_audit (company_id, compliance_key, occurred_at desc);

alter table compliance_audit enable row level security;

-- Read your own companies' history.
drop policy if exists "audit_read_own" on compliance_audit;
create policy "audit_read_own" on compliance_audit
for select to authenticated
using (
  exists (select 1 from companies c
          where c.id = compliance_audit.company_id and c.user_id = auth.uid())
);

-- Append only. Deliberately NO update or delete policy: with RLS enabled and no
-- policy for those commands, they are refused for every non-superuser role.
drop policy if exists "audit_insert_own" on compliance_audit;
create policy "audit_insert_own" on compliance_audit
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from companies c
              where c.id = compliance_audit.company_id and c.user_id = auth.uid())
);

-- ---------- confirm ----------
select policyname, cmd from pg_policies where tablename = 'compliance_audit';
