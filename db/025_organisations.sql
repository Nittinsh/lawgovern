-- ============================================================
-- 025 — ORGANISATIONS: turning a single-user tool into a firm's tool
-- ============================================================
-- Every table in this project is scoped `user_id = auth.uid()`. That has two
-- consequences the product cannot live with:
--
--   1. Two people in the same practice cannot see the same company, so it
--      cannot be sold to anyone who is not working alone.
--   2. MAKER-CHECKER CANNOT COMPLETE. db/005 enforces `checker <> maker` in
--      the database, but if only the row's own creator can see it, no second
--      person can ever confirm anything. The strongest control in the product
--      is structurally unreachable.
--
-- This migration introduces an organisation, makes membership the basis of
-- access, and leaves the old rule in place ALONGSIDE the new one.
--
-- ── THE SAFETY RULE FOR THIS FILE ───────────────────────────
-- Every policy below reads:   ( new membership test ) OR ( user_id = auth.uid() )
--
-- The legacy limb is deliberate. If the backfill misses a row, or a company
-- ends up with a null org_id, the owner still sees their own data exactly as
-- before. A migration that can lock the only user out of a live compliance
-- database is not worth any amount of tidiness. Drop the legacy limb later,
-- in its own migration, once you have confirmed every row carries an org.
--
-- Idempotent. Safe to run twice. No data is deleted.
--
-- Run in the Supabase SQL editor.
-- ============================================================

-- ---------- 1. the tables ----------

create table if not exists organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
comment on table organisations is
  'A practice or a company. Everything is owned by one of these, not by a person.';

create table if not exists org_members (
  org_id     uuid not null references organisations(id) on delete cascade,
  user_id    uuid not null references auth.users(id)    on delete cascade,
  role       text not null default 'member',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
comment on column org_members.role is
  'owner | admin | member | viewer. owner and admin manage people; member reads '
  'and writes data; viewer reads only. A viewer can never be a checker, because '
  'confirming a filing is a write.';

alter table org_members drop constraint if exists org_members_role_valid;
alter table org_members add  constraint org_members_role_valid
  check (role in ('owner','admin','member','viewer'));

-- An invitation is by email, because the person may not have signed up yet.
create table if not exists org_invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  email      text not null,
  role       text not null default 'member',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);
alter table org_invites drop constraint if exists org_invites_role_valid;
alter table org_invites add  constraint org_invites_role_valid
  check (role in ('admin','member','viewer'));
comment on table org_invites is
  'Pending membership, keyed by email. Claimed on first sign-in by lg_claim_invites().';

create index if not exists org_members_user_idx on org_members(user_id);
create index if not exists org_invites_email_idx on org_invites(lower(email));


-- ---------- 2. the anchor column ----------
-- Only `companies` and `rule_verifications` carry an org directly. Every
-- register row already carries company_id, so its access derives from the
-- company rather than being duplicated on seventeen tables and kept in step by
-- hand. One anchor, one place to get wrong.

alter table companies          add column if not exists org_id uuid references organisations(id);
alter table rule_verifications add column if not exists org_id uuid references organisations(id);

create index if not exists companies_org_idx          on companies(org_id);
create index if not exists rule_verifications_org_idx on rule_verifications(org_id);


-- ---------- 3. helper functions ----------
-- SECURITY DEFINER on purpose: a policy on org_members that queries org_members
-- recurses forever. These run outside RLS and are the only thing that may.

create or replace function lg_is_member(o uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members m
    where m.org_id = o and m.user_id = auth.uid()
  );
$$;

create or replace function lg_role_in(o uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from org_members m
  where m.org_id = o and m.user_id = auth.uid()
  limit 1;
$$;

-- A viewer reads and never writes. Everyone else in the org writes data.
create or replace function lg_can_write(o uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lg_role_in(o) in ('owner','admin','member'), false);
$$;

-- Only owner and admin manage people.
create or replace function lg_can_admin(o uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lg_role_in(o) in ('owner','admin'), false);
$$;

-- The two that every register policy uses. A company with a null org_id falls
-- through to the legacy owner test in the policy itself.
create or replace function lg_see_company(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from companies c
    where c.id = cid
      and ( (c.org_id is not null and lg_is_member(c.org_id))
            or c.user_id = auth.uid() )
  );
$$;

create or replace function lg_write_company(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from companies c
    where c.id = cid
      and ( (c.org_id is not null and lg_can_write(c.org_id))
            or c.user_id = auth.uid() )
  );
$$;


-- ---------- 4. backfill ----------
-- Every existing user gets a personal organisation and becomes its owner, so
-- nothing they already have changes hands. Named from the profile where one
-- exists, from the email otherwise.

do $$
declare
  u record;
  new_org uuid;
begin
  for u in
    select distinct au.id as uid,
           coalesce(nullif(au.email, ''), 'user') as email
      from auth.users au
     where exists (select 1 from companies c where c.user_id = au.id)
        or exists (select 1 from org_members m where m.user_id = au.id)
        or true                              -- everyone, so a new user can start
  loop
    -- Already in an organisation? Leave them alone.
    if exists (select 1 from org_members m where m.user_id = u.uid) then
      continue;
    end if;

    insert into organisations (name, created_by)
    values (split_part(u.email, '@', 1) || '''s practice', u.uid)
    returning id into new_org;

    insert into org_members (org_id, user_id, role, joined_at)
    values (new_org, u.uid, 'owner', now())
    on conflict do nothing;

    -- Their existing companies move into it. Only rows with no org yet.
    update companies
       set org_id = new_org
     where user_id = u.uid
       and org_id is null;

    update rule_verifications
       set org_id = new_org
     where user_id = u.uid
       and org_id is null;
  end loop;
end $$;


-- ---------- 5. keep new rows anchored ----------
-- The app sets org_id, but a row that arrives without one would be invisible to
-- everyone but its creator. This makes that impossible rather than unlikely.

create or replace function lg_default_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null then
    select m.org_id into new.org_id
      from org_members m
     where m.user_id = coalesce(new.user_id, auth.uid())
     order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
              m.joined_at
     limit 1;
  end if;
  return new;
end $$;

drop trigger if exists companies_default_org on companies;
create trigger companies_default_org
  before insert on companies
  for each row execute function lg_default_org();

drop trigger if exists rule_verifications_default_org on rule_verifications;
create trigger rule_verifications_default_org
  before insert on rule_verifications
  for each row execute function lg_default_org();


-- ---------- 6. RLS on the new tables ----------

alter table organisations enable row level security;
alter table org_members   enable row level security;
alter table org_invites   enable row level security;

drop policy if exists "org_read"   on organisations;
drop policy if exists "org_insert" on organisations;
drop policy if exists "org_update" on organisations;
create policy "org_read"   on organisations for select to authenticated
  using (lg_is_member(id) or created_by = auth.uid());
create policy "org_insert" on organisations for insert to authenticated
  with check (created_by = auth.uid());
create policy "org_update" on organisations for update to authenticated
  using (lg_can_admin(id)) with check (lg_can_admin(id));

drop policy if exists "orgm_read"   on org_members;
drop policy if exists "orgm_write"  on org_members;
drop policy if exists "orgm_update" on org_members;
drop policy if exists "orgm_delete" on org_members;
-- You can see everyone in an organisation you belong to. That is the point:
-- a checker has to be able to find out who the maker was.
create policy "orgm_read"   on org_members for select to authenticated
  using (lg_is_member(org_id) or user_id = auth.uid());
create policy "orgm_write"  on org_members for insert to authenticated
  with check (lg_can_admin(org_id));
create policy "orgm_update" on org_members for update to authenticated
  using (lg_can_admin(org_id)) with check (lg_can_admin(org_id));
-- Anyone may remove themselves; an admin may remove others.
create policy "orgm_delete" on org_members for delete to authenticated
  using (user_id = auth.uid() or lg_can_admin(org_id));

drop policy if exists "orginv_read"   on org_invites;
drop policy if exists "orginv_write"  on org_invites;
drop policy if exists "orginv_delete" on org_invites;
-- An invitee must be able to see their own invitation by email before they are
-- a member of anything.
create policy "orginv_read" on org_invites for select to authenticated
  using (lg_is_member(org_id)
         or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "orginv_write"  on org_invites for insert to authenticated
  with check (lg_can_admin(org_id));
create policy "orginv_delete" on org_invites for delete to authenticated
  using (lg_can_admin(org_id)
         or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));


-- ---------- 7. claiming an invitation ----------
-- Called by the app after sign-in. Matches on the signed-in email, so an
-- invitation cannot be claimed by anyone else.

create or replace function lg_claim_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare
  claimed integer := 0;
  me      uuid := auth.uid();
  my_mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me is null or my_mail = '' then return 0; end if;

  insert into org_members (org_id, user_id, role, invited_by, joined_at)
  select i.org_id, me, i.role, i.invited_by, now()
    from org_invites i
   where lower(i.email) = my_mail
     and i.accepted_at is null
  on conflict (org_id, user_id) do nothing;

  update org_invites
     set accepted_at = now()
   where lower(email) = my_mail
     and accepted_at is null;

  get diagnostics claimed = row_count;
  return claimed;
end $$;

grant execute on function lg_claim_invites() to authenticated;


-- ---------- 8. companies: membership, with the legacy limb kept ----------

alter table companies enable row level security;

drop policy if exists "companies_own"        on companies;
drop policy if exists "companies_select_own" on companies;
drop policy if exists "companies_org_read"   on companies;
drop policy if exists "companies_org_write"  on companies;
drop policy if exists "companies_org_update" on companies;
drop policy if exists "companies_org_delete" on companies;

create policy "companies_org_read" on companies for select to authenticated
  using ( (org_id is not null and lg_is_member(org_id)) or user_id = auth.uid() );

create policy "companies_org_write" on companies for insert to authenticated
  with check ( (org_id is not null and lg_can_write(org_id)) or user_id = auth.uid() );

create policy "companies_org_update" on companies for update to authenticated
  using  ( (org_id is not null and lg_can_write(org_id)) or user_id = auth.uid() )
  with check ( (org_id is not null and lg_can_write(org_id)) or user_id = auth.uid() );

-- Deleting a company takes its whole compliance history with it, so it is
-- deliberately narrower than editing: owners and admins only.
create policy "companies_org_delete" on companies for delete to authenticated
  using ( (org_id is not null and lg_can_admin(org_id)) or user_id = auth.uid() );


-- ---------- 9. every register, derived from its company ----------

do $$
declare
  t text;
  child_tables text[] := array[
    'compliance_status','directors','shareholders','meetings','charges',
    'allotments','beneficial_interests','designated_persons','upsi_events',
    'upsi_access','pre_clearances','internal_compliances','material_events',
    'compliance_audit'
  ];
begin
  foreach t in array child_tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, not present', t;
      continue;
    end if;
    -- Not every one of these has company_id (internal_compliances is a
    -- template list, for instance). Only re-scope the ones that do.
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'company_id'
    ) then
      raise notice 'skipping %, no company_id column', t;
      continue;
    end if;

    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_org_read',   t);
    execute format('drop policy if exists %I on %I', t || '_org_write',  t);
    execute format('drop policy if exists %I on %I', t || '_org_update', t);
    execute format('drop policy if exists %I on %I', t || '_org_delete', t);

    execute format(
      'create policy %I on %I for select to authenticated using (lg_see_company(company_id))',
      t || '_org_read', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (lg_write_company(company_id))',
      t || '_org_write', t);
    execute format(
      'create policy %I on %I for update to authenticated using (lg_write_company(company_id)) '
      || 'with check (lg_write_company(company_id))',
      t || '_org_update', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (lg_write_company(company_id))',
      t || '_org_delete', t);
  end loop;
end $$;


-- ---------- 10. tables with no company: scope to the org ----------

alter table rule_verifications enable row level security;
drop policy if exists "rule_verifications_own_full" on rule_verifications;
drop policy if exists "rv_org_read"  on rule_verifications;
drop policy if exists "rv_org_write" on rule_verifications;
drop policy if exists "rv_org_update" on rule_verifications;
-- Verifying a rule is a decision the whole practice relies on, so it is shared
-- across the organisation rather than kept per person.
create policy "rv_org_read" on rule_verifications for select to authenticated
  using ( (org_id is not null and lg_is_member(org_id)) or user_id = auth.uid() );
create policy "rv_org_write" on rule_verifications for insert to authenticated
  with check ( (org_id is not null and lg_can_write(org_id)) or user_id = auth.uid() );
create policy "rv_org_update" on rule_verifications for update to authenticated
  using ( (org_id is not null and lg_can_write(org_id)) or user_id = auth.uid() )
  with check ( (org_id is not null and lg_can_write(org_id)) or user_id = auth.uid() );


-- ---------- 11. evidence documents ----------
-- The bucket path is <company_id>/<key>/<file>, so the same company test works.

drop policy if exists "evidence_read_own"   on storage.objects;
drop policy if exists "evidence_write_own"  on storage.objects;
drop policy if exists "evidence_delete_own" on storage.objects;
drop policy if exists "evidence_org_read"   on storage.objects;
drop policy if exists "evidence_org_write"  on storage.objects;
drop policy if exists "evidence_org_delete" on storage.objects;

create policy "evidence_org_read" on storage.objects for select to authenticated
  using (bucket_id = 'evidence'
         and lg_see_company(((storage.foldername(name))[1])::uuid));

create policy "evidence_org_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence'
              and lg_write_company(((storage.foldername(name))[1])::uuid));

-- Deleting evidence destroys the proof a filing was made. Admins only.
create policy "evidence_org_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'evidence'
         and exists (select 1 from companies c
                      where c.id = ((storage.foldername(name))[1])::uuid
                        and ( (c.org_id is not null and lg_can_admin(c.org_id))
                              or c.user_id = auth.uid() )));


-- ---------- 12. what this fixed ----------
-- MAKER-CHECKER NOW WORKS. Two members of one organisation both see the row,
-- so a filing recorded by one can be confirmed by another, and the CHECK
-- constraint from db/005 (checker <> maker) is a real control instead of an
-- unreachable one.
--
-- A VIEWER cannot be a checker, by construction: confirming is an update, and
-- lg_can_write() excludes viewers. That is the correct answer — someone who
-- cannot change anything should not be able to certify it either.


-- ---------- 13. check what happened ----------
select 'organisations' as what, count(*)::text as n from organisations
union all select 'members',            count(*)::text from org_members
union all select 'companies with org', count(*)::text from companies where org_id is not null
union all select 'companies WITHOUT',  count(*)::text from companies where org_id is null
union all select 'your role',          coalesce(string_agg(distinct role, ', '), 'none')
                                       from org_members where user_id = auth.uid();
