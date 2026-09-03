-- ============================================================
-- 025 VERIFY — read-only. Run after db/025_organisations.sql.
-- ============================================================
-- Nothing here writes. It answers the four questions that decide whether the
-- migration actually took, in the order they matter.
-- ============================================================

-- 1. Did anything end up unanchored? This is the one that matters most.
--    A company with no org_id is visible only to its original owner, which is
--    the state the migration exists to leave behind.
select
  'companies total'              as check, count(*)::text as value from companies
union all select
  'companies WITH an org',       count(*)::text from companies where org_id is not null
union all select
  '>> companies WITHOUT an org', count(*)::text from companies where org_id is null

-- 2. The organisations themselves.
union all select
  'organisations',               count(*)::text from organisations
union all select
  'memberships',                 count(*)::text from org_members
union all select
  'owners',                      count(*)::text from org_members where role = 'owner'

-- 3. You, specifically. If this is empty the app will show no practice.
union all select
  '>> YOUR org',                 coalesce(string_agg(o.name, ', '), 'NONE — problem')
    from org_members m join organisations o on o.id = m.org_id
   where m.user_id = auth.uid()
union all select
  '>> YOUR role',                coalesce(string_agg(role, ', '), 'NONE — problem')
    from org_members where user_id = auth.uid()

-- 4. Did the policies actually get rewritten? Anything still gating on the raw
--    user_id alone would not have been replaced.
union all select
  'org-scoped policies created', count(*)::text
    from pg_policies
   where schemaname = 'public' and policyname like '%_org_%'

-- 5. The helper functions the policies depend on.
union all select
  'helper functions present',    count(*)::text
    from pg_proc
   where proname in ('lg_is_member','lg_role_in','lg_can_write','lg_can_admin',
                     'lg_see_company','lg_write_company','lg_claim_invites','lg_default_org');
