-- ============================================================
-- APPLICABILITY: DECIDED, RATHER THAN ASSUMED
--
-- not_applicable is a plain boolean defaulting to false, so it can only say
-- "this does not apply". It cannot tell "somebody looked and confirmed it
-- applies" apart from "nobody has looked" — and those are different facts.
--
-- It matters because many obligations carry a qualification the rules engine
-- cannot evaluate. A listed entity's register holds around forty rows whose own
-- applicability text reads "with subsidiaries", "with unutilised issue
-- proceeds", "with a monitoring agency", "under CIRP" — conditions about the
-- company that nothing in the system records. Today every one of them is shown
-- as applicable and pending, which overstates what is owed and pads the
-- denominator every coverage figure is measured against.
--
-- With this column the three states are distinct:
--   not_applicable = true                        -> ruled out, with a reason
--   applies_confirmed = true                     -> a person checked, it applies
--   neither                                      -> nobody has decided yet
--
-- Safe to run more than once.
-- ============================================================

alter table compliance_status
  add column if not exists applies_confirmed    boolean not null default false;
alter table compliance_status
  add column if not exists applies_confirmed_by text;
alter table compliance_status
  add column if not exists applies_confirmed_at timestamptz;

comment on column compliance_status.applies_confirmed is
  'A person checked the qualification on this obligation and confirmed it applies '
  'to this entity. Distinct from the default false, which only means nobody has '
  'decided — the absence of a decision is not a decision.';
comment on column compliance_status.applies_confirmed_by is
  'Who confirmed it. Applicability is a judgement, and a judgement needs an author.';

-- ---------- confirm ----------
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'compliance_status'
  and column_name in ('not_applicable','applies_confirmed','applies_confirmed_by',
                      'applies_confirmed_at')
order by column_name;
