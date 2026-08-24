-- ============================================================
-- NOT APPLICABLE, PER ENTITY
--
-- The rules engine decides applicability from what it can compute: company
-- class, paid-up capital, turnover, listing status. Plenty of obligations turn
-- on facts it does not hold — whether the company accepts deposits, has a
-- subsidiary, holds foreign assets, issued debentures, has an NBFC licence.
-- Those cannot be inferred, so the engine includes them and someone who knows
-- the company marks the ones that do not apply.
--
-- Recorded as a decision, not a deletion: who marked it, when, and why. The
-- obligation stays in the register and can be reinstated, because "not
-- applicable" is a judgement that can change when the company does.
--
-- Safe to run more than once.
-- ============================================================

alter table compliance_status add column if not exists not_applicable boolean not null default false;
alter table compliance_status add column if not exists na_reason      text;
alter table compliance_status add column if not exists na_by          text;
alter table compliance_status add column if not exists na_at          timestamptz;

comment on column compliance_status.not_applicable is
  'Marked by a user as not applying to this entity. Overrides the engine, which '
  'cannot know facts such as whether the company accepts deposits or holds '
  'foreign assets.';
comment on column compliance_status.na_reason is
  'Why it does not apply. Required by the UI so the decision is auditable.';

create index if not exists compliance_status_na_idx
  on compliance_status (company_id, not_applicable);
