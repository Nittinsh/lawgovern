-- ============================================================
-- Add the financial columns Sec 135 (CSR) and Sec 204 r/w Rule 9
-- (Secretarial Audit) need in order to be evaluated correctly.
--
-- Safe to run more than once. Adds columns only; changes no data.
-- Run db/000_audit_units.sql FIRST and confirm the unit convention.
--
-- UNIT CONVENTION: all money columns are stored in RUPEES.
--   Rs 5 crore    ->        50000000
--   Rs 50 crore   ->       500000000
--   Rs 250 crore  ->      2500000000
--   Rs 500 crore  ->      5000000000
--   Rs 1000 crore ->     10000000000
-- The UI accepts crore and converts on the way in/out. Rupees is
-- stored because that is how the statute states the thresholds.
-- ============================================================

alter table companies add column if not exists networth   numeric;
alter table companies add column if not exists netprofit  numeric;
alter table companies add column if not exists borrowings numeric;

comment on column companies.capital    is 'Paid-up share capital, in RUPEES. Sec 204 r/w Rule 9 threshold: 500000000 (Rs 50 cr).';
comment on column companies.turnover   is 'Annual turnover, in RUPEES. Sec 204 threshold 2500000000 (Rs 250 cr); Sec 135 threshold 10000000000 (Rs 1000 cr).';
comment on column companies.networth   is 'Net worth, in RUPEES. Sec 135 CSR threshold: 5000000000 (Rs 500 cr).';
comment on column companies.netprofit  is 'Net profit for the immediately preceding FY, in RUPEES. Sec 135 CSR threshold: 50000000 (Rs 5 cr).';
comment on column companies.borrowings is 'Outstanding loans/borrowings from banks or public financial institutions, in RUPEES. Sec 204 r/w Rule 9 threshold: 1000000000 (Rs 100 cr).';

-- Verify
select column_name, data_type
from information_schema.columns
where table_name = 'companies'
order by ordinal_position;
