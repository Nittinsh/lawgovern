-- ============================================================
-- ALLOTMENTS REGISTER
--
-- Three obligations run from the date securities are allotted, and none of them
-- had a date because nothing recorded that an allotment had happened.
--
-- Section 42(8), verbatim — the private placement route:
--   "A company making any allotment of securities under this section, shall file
--    with the Registrar a return of allotment WITHIN FIFTEEN DAYS from the date
--    of the allotment"
--
-- Section 39(4) — every other route — says only "shall file with the Registrar a
-- return of allotment in such manner as may be prescribed". The thirty days
-- comes from Rule 12 of the Companies (Prospectus and Allotment of Securities)
-- Rules 2014, which is NOT among the sources held in reference/. The app uses
-- thirty days and says on the row that the period rests on that rule rather than
-- on a text we hold.
--
-- Section 56(4), verbatim:
--   "(b) within a period of TWO MONTHS from the date of allotment, in the case of
--    any allotment of any of its shares;
--    (d) within a period of SIX MONTHS from the date of allotment in the case of
--    any allotment of debenture"
--
-- Safe to run more than once.
-- ============================================================

create table if not exists allotments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,

  route          text,        -- private_placement | rights | bonus | preferential
                              -- | esop | conversion | public | subscribers | other
  security       text,        -- equity | preference | debenture | other
  allotted_on    date,        -- date of allotment: starts s.42(8)/s.39(4) and s.56(4)

  number         numeric,     -- number of securities allotted
  amount         numeric,     -- consideration received, in rupees
  allottees      integer,     -- how many allottees

  pas3_filed_on  date,
  pas3_srn       text,
  certificates_on date,       -- date certificates were delivered (s.56(4))

  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists allotments_company_idx
  on allotments (company_id, allotted_on desc);

alter table allotments enable row level security;
drop policy if exists "allotments_own_full" on allotments;
create policy "allotments_own_full" on allotments
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

comment on column allotments.route is
  'How the securities were allotted. private_placement carries the fifteen-day '
  'PAS-3 period stated in section 42(8) itself; every other route uses thirty '
  'days, which comes from Rule 12 and not from the Act.';
comment on column allotments.allotted_on is
  'Date of allotment. Both the PAS-3 clock and the section 56(4) certificate '
  'clock run from it, so an entry without it produces no deadline.';
comment on column allotments.certificates_on is
  'Date share or debenture certificates were delivered. Closes the section 56(4) '
  'obligation from the practice''s own record.';

-- ---------- confirm ----------
select column_name, data_type
from information_schema.columns
where table_name = 'allotments'
order by ordinal_position;
