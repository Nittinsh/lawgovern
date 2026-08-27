-- ============================================================
-- WHAT THE MEETING ACTUALLY DID
--
-- Several LODR deadlines run from a board meeting rather than from a quarter
-- end. Reg 47(1) is "within 48 hours of conclusion of the board meeting at
-- which the financial results were approved"; Reg 52(8) is two working days
-- from the same event.
--
-- The register records that a board meeting was held, but not what it
-- transacted — so the engine could not tell the results meeting from any other
-- board meeting, and attaching the deadline to every board meeting would invent
-- deadlines for the ones that never considered results. That is the same defect
-- that put 63 obligations on 31 March 2027, arriving by a different road.
--
-- One column answers it. Where it is true, the obligation gets a real deadline
-- computed from a date the user recorded; where it is false or absent, the
-- obligation stays "deadline not established" and claims nothing.
--
-- Known limit, stated rather than papered over: held_on is a date, not a
-- timestamp, so "48 hours from conclusion" is computed as the second day after
-- the meeting. The register does not hold the hour the meeting closed.
--
-- Safe to run more than once.
-- ============================================================

alter table meetings
  add column if not exists approved_results boolean not null default false;

comment on column meetings.approved_results is
  'Financial results were approved at this meeting. Starts the Reg 47(1) clock '
  '(48 hours to publish in the newspapers). False means "not this meeting", not '
  '"unknown" — an obligation with no results meeting recorded stays undated.';

-- ---------- confirm ----------
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'meetings'
  and column_name in ('kind','held_on','approved_results')
order by column_name;
