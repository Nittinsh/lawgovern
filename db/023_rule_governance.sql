-- ============================================================
-- RULE VERSION GOVERNANCE
--
-- Both independent assessments (29 Aug 2026) lead with the same finding: the
-- rule corpus has no effective-date or source-verification system, and the more
-- the product automates conclusions, the more that matters.
--
-- The position today, stated plainly: every rule in this system derives from the
-- owner's spreadsheets — "master sheet.xlsx" and "LODR Compliance Calendar and
-- Material Events.xlsx" — and NOT from a published regulation, circular or
-- notification. No rule carries an effective date. No rule has ever been checked
-- against the instrument it came from. 53 of 327 are flagged needsReview in the
-- source data and have stayed that way.
--
-- That is a hidden risk. This table does not remove it — only reading the
-- current law can do that — but it converts it into a managed one: what the rule
-- rests on, when it was last checked, by whom, and whether it is still current.
--
-- The three states that matter are distinct here, deliberately:
--   no row at all        -> nobody has ever verified this rule
--   status = 'current'   -> a person checked it against a named instrument
--   status = 'superseded' or 'needs_update' -> known stale, with a reason
--
-- An absent row is not "fine". It is "unknown", and the UI says so.
--
-- Safe to run more than once.
-- ============================================================

create table if not exists rule_verifications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid        not null,

  rule_id           text        not null,   -- e.g. LODR-REG-30, CA-SECTION-137-...
  law               text,                   -- corpus the rule belongs to

  status            text        not null default 'current',
    -- current | needs_update | superseded | not_applicable_anymore

  source_instrument text,   -- "SEBI LODR (Second Amendment) Regulations, 2026"
  source_url        text,
  effective_from    date,
  effective_until   date,

  verified_on       date        not null default current_date,
  verified_by       text,
  change_note       text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One verification record per rule per practice; re-verifying updates it.
create unique index if not exists rule_verifications_unique
  on rule_verifications (user_id, rule_id);

create index if not exists rule_verifications_status_idx
  on rule_verifications (user_id, status);

alter table rule_verifications enable row level security;
drop policy if exists "rule_verifications_own_full" on rule_verifications;
create policy "rule_verifications_own_full" on rule_verifications
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

comment on table rule_verifications is
  'What each compliance rule rests on and when it was last checked against it. '
  'The absence of a row means nobody has verified that rule — which is a '
  'different fact from the rule being current, and the UI keeps them apart.';
comment on column rule_verifications.source_instrument is
  'The published regulation, circular or notification the rule was checked '
  'against. The rule corpus itself derives from spreadsheets, so this is the '
  'first point at which a rule is tied to an authority.';
comment on column rule_verifications.effective_from is
  'When this version of the rule took effect. Without it the engine cannot tell '
  'whether logic written for an earlier period still applies to the current one.';

-- ---------- confirm ----------
select column_name, data_type
from information_schema.columns
where table_name = 'rule_verifications'
order by ordinal_position;
