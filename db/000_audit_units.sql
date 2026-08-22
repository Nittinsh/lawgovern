-- ============================================================
-- READ-ONLY AUDIT — run this FIRST, in the Supabase SQL editor.
-- Changes nothing. Tells us what unit capital/turnover are in,
-- which decides how the thresholds must be written.
-- ============================================================

select
  name,
  type,
  fyend,
  capital,
  turnover,
  case
    when capital is null or capital = 0 then 'empty'
    when capital < 100000     then 'looks like CRORE (e.g. 5 = Rs 5 cr)'
    when capital >= 100000    then 'looks like RUPEES (e.g. 50000000 = Rs 5 cr)'
  end as capital_unit_guess,
  case
    when turnover is null or turnover = 0 then 'empty'
    when turnover < 100000    then 'looks like CRORE'
    when turnover >= 100000   then 'looks like RUPEES'
  end as turnover_unit_guess
from companies
order by created_at
limit 40;

-- Summary: if these two counts disagree, the data is mixed and
-- must be normalised before the thresholds can be trusted.
select
  count(*) filter (where capital > 0 and capital < 100000)  as capital_in_crore,
  count(*) filter (where capital >= 100000)                 as capital_in_rupees,
  count(*) filter (where turnover > 0 and turnover < 100000) as turnover_in_crore,
  count(*) filter (where turnover >= 100000)                as turnover_in_rupees,
  count(*)                                                  as total_companies
from companies;

-- Confirm the fyend format too (feeds the date fix).
select distinct fyend, count(*) from companies group by fyend order by 2 desc;
