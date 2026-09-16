-- db/026_debt_listing.sql
--
-- WHAT THIS FIXES, AND IT IS NOT ONLY THE NEW RULES
--
-- `lodrListingTypes(c)` reads `c.ncsListed` and `c.hvdle` to decide whether a
-- LODR rule scoped to non-convertible securities applies. Those two fields are
-- read in exactly one place in the app and set NOWHERE: there is no column on
-- `companies`, no field on the entity form, and no header the bulk importer
-- maps to them. They are always undefined.
--
-- So every LODR rule scoped `listingType: ['ncs']` or `['hvdle']` has been
-- unreachable since the corpus was built. Measured against the shipped corpus:
--
--     20 rules can never apply to any entity
--
-- including Reg 52 (financial results for debt), Reg 54 (asset cover),
-- Reg 61A, Reg 62A and Reg 53. That is CLAUDE.md §2k's defect class -- a
-- control that cannot fire -- and it is invisible, because a rule that never
-- applies looks exactly like a rule that correctly does not apply.
--
-- It is also §2c's situation repeating: `networth`, `netprofit` and
-- `borrowings` were read and defaulted to 0 until db/001 added the columns,
-- so the s.135 net-profit limb was silently unevaluable.
--
-- Two booleans, because the regulation draws two lines and they are different:
--
--   ncs_listed  Chapter V binds an entity that has listed its non-convertible
--               securities. An UNLISTED company can be one: a private company
--               with listed NCDs owes Chapter V and owes nothing under
--               Chapter IV. That is why this cannot be inferred from `type`.
--
--   hvdle       Chapter V-A (Reg 62B onward) binds a HIGH VALUE debt listed
--               entity -- Reg 62C sets the threshold at an outstanding value
--               of Rs 5,000 crore of listed non-convertible debt securities,
--               and gives six months from the trigger to comply. It is a
--               subset of ncs_listed and carries a corporate-governance
--               regime of its own, so it is a separate fact, not a level.
--
-- Both default FALSE. That is the safe default here and it is the opposite of
-- the §3j year-end default: assuming an entity has listed debt would put
-- Chapter V obligations on every company in the book, which is §2z's defect
-- (wrong law against the wrong entity class). Assuming it does not leaves the
-- register where it is today until somebody says otherwise -- and the entity
-- form now asks.
--
-- Idempotent. Safe to run more than once. No data is changed.

alter table public.companies
  add column if not exists ncs_listed boolean not null default false;

alter table public.companies
  add column if not exists hvdle boolean not null default false;

comment on column public.companies.ncs_listed is
  'Entity has listed non-convertible securities. Drives SEBI LODR Chapter V. '
  'An unlisted company can be true here -- a private company with listed NCDs '
  'owes Chapter V and owes nothing under Chapter IV.';

comment on column public.companies.hvdle is
  'High value debt listed entity -- Reg 62C, outstanding listed non-convertible '
  'debt securities of Rs 5,000 crore or more. Drives LODR Chapter V-A '
  '(Reg 62B onward). A subset of ncs_listed, and a separate fact from it.';

-- Verification. Both columns should be listed, both boolean, both NOT NULL
-- with a default of false.
--
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'companies'
--      and column_name in ('ncs_listed', 'hvdle');
--
-- And nothing should have been switched on by running this:
--
--   select count(*) filter (where ncs_listed) as ncs,
--          count(*) filter (where hvdle)      as hv,
--          count(*)                           as total
--     from public.companies;
