-- ============================================================
-- RUN THIS ONLY IF db/000_audit_units.sql showed CRORE values.
-- If everything already reads as RUPEES, skip this file entirely.
--
-- This is the one script here that MODIFIES data. It is written in
-- two halves: a dry run you must read, and an update that stays
-- commented out until you have read it.
-- ============================================================

-- ---------- HALF 1: DRY RUN. Changes nothing. ----------
-- Read every row of this output before going further. Anything in
-- 'after' that looks wrong means STOP and tell Claude.

select
  name,
  capital  as capital_before,
  case when capital  > 0 and capital  < 100000 then capital  * 10000000 else capital  end as capital_after,
  turnover as turnover_before,
  case when turnover > 0 and turnover < 100000 then turnover * 10000000 else turnover end as turnover_after
from companies
order by created_at;

-- ---------- HALF 2: THE UPDATE. Commented out on purpose. ----------
-- Take a backup first: Supabase Dashboard -> Database -> Backups.
-- Then remove the /* */ around the block below and run it.
--
-- The `< 100000` guard means rows already in rupees are left alone,
-- so re-running this is safe.

/*
begin;

update companies
   set capital = capital * 10000000
 where capital > 0 and capital < 100000;

update companies
   set turnover = turnover * 10000000
 where turnover > 0 and turnover < 100000;

-- Check the result before committing.
select name, capital, turnover from companies order by created_at;

-- If it looks right:   commit;
-- If it does not:      rollback;
commit;
*/
