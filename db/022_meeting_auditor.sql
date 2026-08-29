-- ============================================================
-- AUDITOR APPOINTED AT THIS MEETING
--
-- ADT-1 does not need a register of its own. The third proviso to section
-- 139(1) gives both the period and the anchor, verbatim:
--
--   "Provided also that the company shall inform the auditor concerned of his or
--    its appointment, and also file a notice of such appointment with the
--    Registrar WITHIN FIFTEEN DAYS OF THE MEETING IN WHICH THE AUDITOR IS
--    APPOINTED."
--
-- and the Explanation to that section:
--
--   "For the purposes of this Chapter, 'appointment' includes re-appointment."
--
-- The meetings register already records the meeting. All that was missing was
-- whether an auditor was appointed at it — the same gap approved_results closed
-- for Reg 47(1), and closed the same way.
--
-- One flag covers both routes: appointment or re-appointment by members at an
-- AGM under section 139(1), and a casual vacancy filled by the Board under
-- section 139(8). The filing and its period are identical either way; only the
-- meeting differs, and the register already knows which kind it was.
--
-- Not covered here: auditor TENURE. Section 139(1) runs a term to the conclusion
-- of the sixth AGM and section 139(2) forces rotation for prescribed classes —
-- five consecutive years for an individual, two terms of five for a firm. That
-- is a multi-year clock across appointments and needs its own register; this
-- column deliberately does not pretend to answer it.
--
-- Safe to run more than once.
-- ============================================================

alter table meetings
  add column if not exists auditor_appointed boolean not null default false;

comment on column meetings.auditor_appointed is
  'An auditor was appointed or re-appointed at this meeting — by members under '
  's.139(1), or by the Board filling a casual vacancy under s.139(8). Starts the '
  'fifteen days for ADT-1 under the third proviso to s.139(1). False means "not '
  'at this meeting", not "unknown".';

-- ---------- confirm ----------
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'meetings'
  and column_name in ('kind','held_on','approved_results','auditor_appointed')
order by column_name;
