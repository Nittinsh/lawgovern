-- ============================================================
-- DIRECTOR ATTRIBUTES
--
-- designation held two different things at once: the role a person occupies
-- (director / independent / managing director / CS ...) and, via the value
-- 'woman_director', an attribute of the person. Because it is a single value,
-- a director could be marked independent OR woman, never both.
--
-- LODR Reg 17(1) requires, for the top 1000 listed entities by market
-- capitalisation, "at least one INDEPENDENT WOMAN DIRECTOR" — a person who is
-- both. Under the old shape that person could not be recorded, and whichever
-- label was chosen, the other Section 149 test reported a breach that was not
-- real.
--
-- So the attribute moves to its own column and designation goes back to
-- meaning only the role.
--
-- Safe to run more than once.
-- ============================================================

alter table directors add column if not exists is_woman boolean not null default false;

-- Carry across anyone already recorded under the old value, then free them to
-- also hold a real designation.
update directors
   set is_woman = true,
       designation = 'director'
 where designation = 'woman_director';

comment on column directors.is_woman is
  'Person attribute, independent of designation. Needed for the second proviso '
  'to Sec 149(1) and for LODR Reg 17(1), which for the top 1000 entities '
  'requires a director who is both a woman and independent.';

create index if not exists directors_woman_idx on directors (company_id, is_woman);
