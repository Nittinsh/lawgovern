-- ============================================================
-- WAS IT FILED, AND BY WHOM
--
-- The record could hold a filing date and a reference, which meant the only
-- thing it could express was "filed". "Not filed" and "not known yet" are real
-- answers a compliance register has to be able to hold, and both looked
-- identical to a blank row.
--
-- filed_by is distinct from recorded_by. One is who made the filing, the other
-- is who typed it into this system, and they are frequently different people.
--
-- Safe to run more than once.
-- ============================================================

alter table compliance_status add column if not exists filed_flag text;
alter table compliance_status add column if not exists filed_by   text;

comment on column compliance_status.filed_flag is
  'yes | no | unknown. Distinct from having a filing date: "not known yet" is an '
  'answer, and a blank is not.';
comment on column compliance_status.filed_by is
  'Who made the filing. recorded_by is who entered it here; they are often '
  'different people and conflating them loses the trail.';
