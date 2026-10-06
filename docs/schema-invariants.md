# Schema invariants the app depends on

The app makes assumptions about `user_plan_enrollments` that live here, in
Postgres, and cannot be read from the client. Nothing in the repo enforces
these; a migration that changes one of them will silently break a feature and
the failure surfaces as a 23514 error on a button the reader is pressing, not
as a failed deploy.

Each invariant below names the app constant that depends on it, so a grep
finds every site that has to move together.

---

## 1. The 「testament is finished」 sentinel

`lib/readingProgress.ts` → `FINISHED_BOOK_INDEX = 66`
`lib/readingProgress.ts` → `FINISHED_BOOK_INDEX_LEGACY`

A testament that has been read through is recorded by pointing its start
column **past the last book**: 創 = 0 … 瑪 = 38, 太 = 39 … 啓 = 65, so **66
means "no more NT / no more OT"**. `generateReadingPlan` reads an
out-of-range start as finished and gives the whole daily quota to the other
testament.

Migration **014** widens all three start columns to allow it:

```
user_plan_enrollments_start_book_index_chk      CHECK (start_book_index      BETWEEN 0 AND 66)
user_plan_enrollments_nt_start_book_index_chk   CHECK (nt_start_book_index   BETWEEN 39 AND 66)
user_plan_enrollments_ot_start_book_index_chk   CHECK (ot_start_book_index   BETWEEN 0 AND 66)
```

**Before 014** (migrations 011/012) the NT column stopped at 65, so writing 66
violated the constraint and — because PostgREST runs one statement — aborted
the _entire_ UPDATE. The reader pressed the catch-up button and got an error
instead of a restart. That is `c27fdec`.

`lib/catchupActions.ts` still carries an in-range fallback for databases that
have not run 014: on 23514 it rewrites the sentinel as the testament's last
book at its last chapter (啟示錄 22 / 瑪拉基 4), which the generator also reads
as finished. It exists for un-migrated databases only and is **not** the
preferred spelling. Do not remove it in the same change that assumes 014 has
been applied everywhere.

### Verifying against a live database

A `SELECT ... WHERE nt_start_book_index = 66` probe does **not** work: CHECK
constraints are evaluated on write, not on read, so the query returns 200 with
an empty array either way. Confirm the constraint directly instead:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'user_plan_enrollments'::regclass
  and conname like '%start_book_index_chk';
```

All three must show an upper bound of 66.

---

## 2. `started_at` is a date, not a timestamp the app should interpret in local time

`lib/bible/planGenerator.ts` parses `started_at` as
`new Date(started_at.split('T')[0] + 'T00:00:00')` — a **local** midnight.

`lib/bible/todayRefs.ts` → `horizonForToday` does the same via
`daysBetween`.

The app's 「today」 comes from `lib/readingDate.ts`, which is HKT. If the
database ever stores `started_at` with a non-`Z` offset, both the plan and the
today lookup shift together and stay consistent — but every _date string_
printed to the reader would be off by the offset. Keep `started_at` a plain
`YYYY-MM-DDTHH:MM:SS.000Z` midnight.

---

## 3. `total_days` is derived, not authoritative

`app/(main)/settings/page.tsx` writes `total_days` when redesigning a plan, and
`app/(main)/dashboard/page.tsx` + `app/(main)/calendar/page.tsx` read
`plan.size` from the generator instead. The column is a cache.

**Never compute it from scope constants.** `getRequiredDays(scope, cpd)`
divides the scope's _full_ chapter count (260 NT / 929 OT) by the daily quota
and cannot see the start position, so it is only correct for a plan starting at
創 1. `lib/bible/todayRefs.ts` → `planLengthDays` / `chaptersInPlan` are the
generator-backed replacements. That is `27e65e0`.

Migration **004** relaxed the `total_days` CHECK for the same reason.

---

## 4. There is one plan generator

`lib/bible/planGenerator.ts` → `generateReadingPlan` is the only place that
answers 「which chapters fall on which date」.

Do not replay the plan by hand in a component. The hand-rolled replay that used
to live in `app/(main)/read/page.tsx` walked a flat book list from 創 1 and
ignored `reading_order`, `nt_start_book_index`, `ot_start_book_index` and
`start_book_index` — so every parallel plan and every mid-Bible start (i.e.
every plan the catch-up button produces) showed a 今日讀經 that disagreed with
the dashboard. That is `f6b7121`.

Prefer the extracted helpers in `lib/bible/todayRefs.ts` over calling the
generator directly, so the horizon sizing and the URL-refs-wins rule stay in
one place.
