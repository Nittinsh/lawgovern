-- ============================================================
-- FIELD-LEVEL AUDIT
--
-- compliance_audit recorded status transitions — previous_status to new_status —
-- and the filing details that came with them. It could not record that an owner
-- changed, a priority was raised, an obligation was marked not applicable, or a
-- due date was overridden, because there was nowhere to put "this field, from
-- this, to this".
--
-- Those are exactly the changes a reviewer asks about, so they need the same
-- append-only treatment the status changes already get.
--
-- Safe to run more than once.
-- ============================================================

alter table compliance_audit add column if not exists field      text;
alter table compliance_audit add column if not exists old_value  text;
alter table compliance_audit add column if not exists new_value  text;
alter table compliance_audit add column if not exists note       text;

comment on column compliance_audit.field is
  'The field that changed: owner, reviewer, priority, stage, applicability, '
  'filing_reference, filing_date. Null for a plain status transition.';
comment on column compliance_audit.old_value is 'Value before the change, as text.';
comment on column compliance_audit.new_value is 'Value after the change, as text.';
comment on column compliance_audit.note is
  'Why, where the change requires a reason — an applicability decision, an override.';

create index if not exists compliance_audit_field_idx
  on compliance_audit (company_id, compliance_key, field, occurred_at desc);

-- The table has no update or delete policy, so these rows cannot be rewritten
-- from the application either. That is deliberate and unchanged.
