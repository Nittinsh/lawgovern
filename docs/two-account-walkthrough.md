# The two-account walkthrough

The one test nobody can automate here, and the one the product is now sold on.

`tests/backend.test.js` runs as an **anonymous** caller. It proves the doors are shut. It cannot
prove the right people get through, because that needs a signed-in session, and a session needs a
password — which the tooling in this repository must never hold.

So the check moved **inside the app**: **Administration → Team → Run access check**. It runs as
whoever is signed in. This document is the script for running it across two accounts, which is the
only way to test isolation between two practices.

Budget about fifteen minutes.

---

## Before you start

You need a second email address that can receive mail. A second address of your own is fine — the
constraint the database enforces is on the **account**, not on the human.

---

## Part 1 — your own account (5 min)

1. Sign in as usual, hard-refresh (**Ctrl+Shift+R**), and confirm the header top-right shows your
   practice name.
2. Go to **Administration → Team**.
3. Press **Run access check**.

**Every row must read `pass`.** The ones that matter:

| row | what a failure means |
|---|---|
| Member of a practice | db/025 did not reach your account; you are still on the legacy single-user rule |
| Every company carries an organisation | the backfill missed rows — **those companies cannot be shared with anyone** |
| Nothing visible from a practice you are not in | isolation is broken |
| Register rows belong to a company you can see | a register row is reachable without its company |
| The database agrees you may write | the policy is refusing a write your role should allow |

**Copy the company id** the screen shows you ("Your own first company id, for the other account to
paste into *their* probe"). You need it in Part 3.

> If **Every company carries an organisation** fails, stop and send me the number. Everything below
> will still pass and will be measuring the wrong thing.

---

## Part 2 — the second account (5 min)

4. Still on **Team**, invite the second address as **Member**. It appears under *Invited, not yet
   joined*.
5. In a **private window** (so both sessions can be open at once), sign up with that address.
6. Approve it from your admin screen — approval and membership are different gates. Approval decides
   whether they get in at all; the invitation decides what they see once they are.
7. Sign in as the second account. It should land in **your practice**, with the header showing your
   practice name and the role **Member**.

**If it shows no practice**, `lg_claim_invites()` did not match — check the address is identical,
including case.

---

## Part 3 — the isolation test (2 min)

8. As the **second account**, go to **Team → Run access check**.
9. Paste **your** company id from step 3 into *Cross-tenant probe* and run it again.

Because the second account is a member of the same practice, it **should** see that company — so
this row will read `fail`, and that is correct here. It is testing the wrong thing while both
accounts share a practice.

**To test isolation properly**, do one of:

- **(a)** Remove the second account from your practice (Team → Remove). It then has its own
  practice. Paste your company id into its probe. It must now read **`pass` — returned nothing**.
- **(b)** Better, if you have a third address: sign up without any invitation, so it lands in a
  practice of its own, and paste your company id into its probe.

> **Route (a) is the real test.** If the second account can still read your company after being
> removed, the isolation this product is sold on does not hold — send me the output immediately.

---

## Part 4 — maker-checker, the thing that could never complete (3 min)

This is the control that existed and was structurally unreachable before db/025: the database
enforced that a checker must differ from the maker, but only the row's creator could see the row.

10. Re-invite the second account as **Member** if you removed it.
11. As **you**: open any obligation and **record a filing** — a date and an SRN.
12. As the **second account**: open the same obligation. It should show the filing as *recorded by*
    you and awaiting confirmation, with a **Confirm** control available.
13. Confirm it. The status should move to **Filed**.

**That is maker-checker completing for the first time in this product.**

14. Now change the second account's role to **Viewer** and try again on another obligation. It must
    be **refused**, and the reason should name the role. Confirming a filing records that a check
    was carried out; somebody who cannot change a record must not be able to certify one.

---

## What to send back

Whichever of these is true:

- **All pass** — say so, and the multi-tenant claim moves from asserted to demonstrated.
- **Any `FAIL`** — the row name and its detail text, verbatim.
- **Step 13 has no Confirm control** — say which obligation, and what the row says instead.
- **Step 14 was allowed** — that one is urgent.

---

## Why this is not automated

Automating it would mean this repository creating accounts and holding passwords. It will not do
either. The check itself is automated — `lgAccessCheck()` is covered by twelve assertions and four
mutations in the suite, so the *checker* is tested even though the *walkthrough* is manual. What
remains manual is the part that needs a human with two mailboxes.
