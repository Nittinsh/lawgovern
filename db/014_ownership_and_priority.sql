-- ============================================================
-- OWNERSHIP, REVIEW AND PRIORITY, PER OBLIGATION
--
-- The register could say what was due but not who was responsible for it. The
-- `owner` carried on a generated row is a ROLE from the source sheet — "CS/Board",
-- "Board / authorised signatory" — not a person, so nothing was ever assigned to
-- anyone and no one could be asked about it.
--
-- Priority is separate from the `risk` the rules carry. Risk is a property of the
-- provision; priority is what this firm has decided about this obligation for
-- this entity, and it can differ.
--
-- Workflow stage is recorded explicitly rather than inferred, so an obligation
-- can sit In Progress before anything is filed:
--   identified -> assigned -> in_progress -> filed -> confirmation_pending
--   -> confirmed -> closed
--
-- Safe to run more than once.
-- ============================================================

alter table compliance_status add column if not exists owner_email     text;
alter table compliance_status add column if not exists owner_name      text;
alter table compliance_status add column if not exists reviewer_email  text;
alter table compliance_status add column if not exists reviewer_name   text;
alter table compliance_status add column if not exists escalation_to   text;
alter table compliance_status add column if not exists priority        text;
alter table compliance_status add column if not exists stage           text;
alter table compliance_status add column if not exists remarks         text;

comment on column compliance_status.owner_email is
  'The person answerable for this obligation on this entity. Distinct from the '
  'role the rule carries, which says what kind of person, not which one.';
comment on column compliance_status.reviewer_email is
  'Who checks the owner''s work. Also the person who can confirm a filing, since '
  'a maker cannot confirm their own entry.';
comment on column compliance_status.priority is
  'critical | high | medium | low. The firm''s decision for this entity, which '
  'may differ from the risk the provision carries.';
comment on column compliance_status.stage is
  'identified | assigned | in_progress | filed | confirmation_pending | confirmed | closed';

create index if not exists compliance_status_owner_idx
  on compliance_status (owner_email);
create index if not exists compliance_status_stage_idx
  on compliance_status (company_id, stage);
