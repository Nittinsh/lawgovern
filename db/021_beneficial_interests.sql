-- ============================================================
-- BENEFICIAL INTEREST DECLARATIONS — sections 89 and 90
--
-- Two company filings run from the day a declaration is received, and nothing
-- recorded that one had been received.
--
-- Section 89(6), verbatim:
--   "Where any declaration under this section is made to a company, the company
--    shall make a note of such declaration in the register concerned and shall
--    file, WITHIN THIRTY DAYS FROM THE DATE OF RECEIPT OF DECLARATION BY IT, a
--    return in the prescribed form with the Registrar"
--   -> MGT-6. The period is in the Act itself.
--
-- Section 90(4) says only:
--   "Every company shall file a return of significant beneficial owners ...
--    WITHIN SUCH TIME, in such form and manner AS MAY BE PRESCRIBED"
--   -> BEN-2. The thirty days comes from the Companies (Significant Beneficial
--   Owners) Rules 2018, which is NOT among the sources in reference/. The app
--   computes the date and says on the row where the period comes from.
--
-- change_on and received_on are deliberately separate. The declarant's clock
-- under section 89(3) runs from the change; the company's clock under 89(6)
-- runs from receipt, and those are different dates. A declaration recorded as
-- changed but not yet received produces no company filing, because until it
-- arrives the company has nothing to file.
--
-- Safe to run more than once.
-- ============================================================

create table if not exists beneficial_interests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null,
  company_id     uuid        not null,

  kind           text        not null default 'bi',   -- bi (s.89) | sbo (s.90)
  form_received  text,       -- MGT-4 | MGT-5 | BEN-1

  registered_holder text,    -- in whose name the shares stand
  beneficial_owner  text,    -- who holds the beneficial interest
  shares         numeric,
  percent        numeric,    -- for a significant beneficial owner

  change_on      date,       -- date of the change / acquisition (s.89(3), s.90(1))
  received_on    date,       -- date the company received it (starts s.89(6) / s.90(4))

  filed_on       date,       -- MGT-6 / BEN-2 filed
  srn            text,

  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists beneficial_interests_company_idx
  on beneficial_interests (company_id, received_on desc);

alter table beneficial_interests enable row level security;
drop policy if exists "beneficial_interests_own_full" on beneficial_interests;
create policy "beneficial_interests_own_full" on beneficial_interests
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

comment on column beneficial_interests.received_on is
  'Date the company received the declaration. Section 89(6) runs thirty days '
  'from this date, not from the date of the underlying change — until it arrives '
  'the company has nothing to file.';
comment on column beneficial_interests.kind is
  'bi = section 89 beneficial interest (MGT-4/MGT-5 in, MGT-6 out). '
  'sbo = section 90 significant beneficial owner (BEN-1 in, BEN-2 out).';

-- ---------- confirm ----------
select column_name, data_type
from information_schema.columns
where table_name = 'beneficial_interests'
order by ordinal_position;
