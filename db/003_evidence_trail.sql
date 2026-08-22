-- ============================================================
-- Evidence trail for compliance_status.
-- A status is only allowed to claim "filed" when backed by a
-- recorded filing date or reference. Safe to run more than once.
-- ============================================================

alter table compliance_status add column if not exists filing_ref      text;
alter table compliance_status add column if not exists evidence_note   text;
alter table compliance_status add column if not exists evidence_source text;
alter table compliance_status add column if not exists verified_by     text;
alter table compliance_status add column if not exists verified_at     timestamptz;

comment on column compliance_status.filing_ref      is 'SRN / filing reference. Its presence raises confidence to high.';
comment on column compliance_status.evidence_source is 'Where the evidence came from: "Entered by you", MCA, NSE, BSE.';
comment on column compliance_status.verified_by     is 'Email of the person who recorded the evidence.';
comment on column compliance_status.verified_at     is 'When the evidence was recorded (not when the filing was made).';

-- lgPersist() upserts on this pair, so it must be unique.
create unique index if not exists compliance_status_company_key_uidx
  on compliance_status (company_id, compliance_key);

select column_name, data_type
from information_schema.columns
where table_name = 'compliance_status'
order by ordinal_position;
