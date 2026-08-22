-- ============================================================
-- FIX: 403 "new row violates row-level security policy for
-- table compliance_status".
--
-- Cause: INSERT is authorised only by a policy's WITH CHECK clause.
-- A policy with USING but no WITH CHECK lets reads through and
-- blocks every write — which is what the System check hit.
--
-- This ADDS a correctly-formed policy. Postgres OR-combines
-- permissive policies, so your existing ones are left untouched.
-- ============================================================

-- ---------- STEP 1: look at what exists now (read-only) ----------
select policyname, cmd, permissive,
       qual        as using_clause,
       with_check  as with_check_clause
from pg_policies
where tablename = 'compliance_status';

select column_name, data_type
from information_schema.columns
where table_name = 'compliance_status'
order by ordinal_position;

-- ---------- STEP 2: the fix ----------
-- A row in compliance_status belongs to whoever owns its parent company.
-- Both USING and WITH CHECK are supplied, so read AND write are covered.

alter table compliance_status enable row level security;

drop policy if exists "cs_owner_full_access" on compliance_status;

create policy "cs_owner_full_access"
on compliance_status
for all
to authenticated
using (
  exists (
    select 1 from companies c
    where c.id = compliance_status.company_id
      and c.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from companies c
    where c.id = compliance_status.company_id
      and c.user_id = auth.uid()
  )
);

-- ---------- STEP 3: confirm ----------
select policyname, cmd,
       (qual is not null)       as has_using,
       (with_check is not null) as has_with_check
from pg_policies
where tablename = 'compliance_status';
