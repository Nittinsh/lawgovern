-- ============================================================
-- CHARGES REGISTER
--
-- Sections 77 to 87 are the largest group of obligations in this register with
-- no deadline against them, and the reason is not that the deadline is unknown.
-- Section 77(1), verbatim:
--
--   "...to register the particulars of the charge ... with the Registrar
--    WITHIN THIRTY DAYS of its creation"
--
-- and section 82(1):
--
--   "A company shall give intimation to the Registrar ... of the payment or
--    satisfaction in full of any charge registered under this Chapter WITHIN A
--    PERIOD OF THIRTY DAYS from the date of such payment or satisfaction"
--
-- Thirty days from what, though. The clock starts when the charge is created or
-- satisfied, and nothing here recorded that those things had happened — so the
-- obligation sat undated, which is honest but not useful.
--
-- This table records the event. Once a charge is entered, the engine computes
-- CHG-1 at creation + 30 and CHG-4 at satisfaction + 30, and the filing columns
-- close those rows without anyone entering the same fact twice.
--
-- Deliberately NOT modelled: the extension routes. Section 77's proviso allows
-- sixty days on additional fees for charges created on or after 02.11.2018, and
-- section 82's allows three hundred days. Those are applications to the
-- Registrar, not deadlines — treating them as the due date would tell a
-- Company Secretary the filing is not late when it is.
--
-- Safe to run more than once.
-- ============================================================

create table if not exists charges (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,

  holder         text,                        -- bank / FI / debenture trustee
  nature         text,                        -- hypothecation | mortgage | pledge | lien | other
  amount         numeric,                     -- amount secured, in rupees
  property       text,                        -- what is charged

  created_on     date,                        -- date of creation of the charge (starts s.77)
  modified_on    date,                        -- date of modification, if any (s.79)
  satisfied_on   date,                        -- date of payment / satisfaction (starts s.82)

  charge_id      text,                        -- the ROC charge identification number
  chg1_filed_on  date,                        -- CHG-1 / CHG-9 filed
  chg1_srn       text,
  chg4_filed_on  date,                        -- CHG-4 filed
  chg4_srn       text,

  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists charges_company_idx
  on charges (company_id, created_on desc);

alter table charges enable row level security;
drop policy if exists "charges_own_full" on charges;
create policy "charges_own_full" on charges
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

comment on column charges.created_on is
  'Date the charge was created. Section 77(1) runs thirty days from this date, '
  'so an entry without it produces no deadline rather than a guessed one.';
comment on column charges.satisfied_on is
  'Date of payment or satisfaction in full. Section 82(1) runs thirty days from '
  'this date. Leave empty while the charge is still subsisting.';
comment on column charges.chg1_srn is
  'SRN of the CHG-1 / CHG-9 filing. Present alongside chg1_filed_on it closes '
  'the registration obligation from the practice''s own record.';

-- ---------- confirm ----------
select column_name, data_type
from information_schema.columns
where table_name = 'charges'
order by ordinal_position;
