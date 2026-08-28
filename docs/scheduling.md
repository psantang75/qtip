# Scheduling

The Scheduling module lets Operations managers and admins post explicit shift
schedules (with breaks and lunches) for their people, log attendance exceptions
(absences, late arrivals, early leaves, PTO), and publish those schedules to the
employees they cover. It is **not** a timekeeping system — Paychex owns actual
punches. Scheduling is the *plan* plus the *exceptions to the plan*; the Agent
Performance KPI engine consumes that plan through a read-only provider and owns
all points/thresholds/bands. The scheduling engine itself carries **no** scoring
logic — only the flags (`is_excused`, shift windows, exception windows) the KPI
engine needs.

## Concepts

- **Week = Sunday → Saturday.** One helper (`startOfWeek`, in
  `backend/src/services/scheduling/schedule.dates.ts`) owns that boundary; no
  call site re-derives it. Default calendar range is two weeks.
- **Shift** — one `schedule_shift` row per user per day. Either a day off
  (`is_day_off`) or a worked day with `start_at`/`end_at` and zero or more
  **segments** (breaks/lunches). Lunches are unpaid; net paid minutes =
  span − unpaid segments.
- **Segment** — a `schedule_shift_segment` typed by `schedule_activity_type`
  (Break, Lunch, …). The generic activity-type model means new segment kinds
  (e.g. training, coaching) are data, not schema changes.
- **Exception** — a `schedule_exception` typed by `schedule_exception_type`.
  Either full-day or a half-open time window. **Exceptions on one day may not
  overlap** — the engine would otherwise score the same hour twice. Single adds
  are rejected on conflict; bulk logging skips and reports conflicts.
  Most exceptions are **derived from Paychex**, not typed by hand — see
  [Time off comes from Paychex](#time-off-comes-from-paychex).
- **Template** — a reusable Sun→Sat week (`schedule_template` +
  `schedule_template_day` + `schedule_template_day_segment`) applied onto a range
  of users/dates. Templates carry no department or color — apply rights ride on
  `sched_calendar` EDIT.
- **Coverage threshold** — per-department green/yellow staffing minimums
  (`schedule_coverage_threshold`) that drive the day-view coverage heatmap.
- **Phone queue coverage** — who should be staffing which phone queue, solved on
  read from this schedule. It is a consumer of scheduling, not part of it: see
  [`phone_queues.md`](phone_queues.md).

## Draft / Publish / Lock lifecycle

- New/edited shifts are **DRAFT** and visible only to managers/admins.
- **Publish** flips shifts to **PUBLISHED**; employees only ever see published
  shifts (`/app/scheduling/my-schedule`, and the KPI provider).
- Managers/admins can schedule arbitrarily far into the future.
- A shift is **locked** once it is `PUBLISHED` **and** elapsed (strictly before
  today). Elapsed *draft* days stay editable so they can be corrected and
  published late; publishing an elapsed week is an audited action
  (`confirm_elapsed`) because it feeds retroactive KPIs.
- There is **no automatic roll-forward** of schedules by design.
- Deactivating a user cancels their future shifts (see
  `cancelFutureShiftsForUser`, called from `toggleUserStatus`).

## Time off comes from Paychex

Paychex is the system of record for time off, and exceptions are **derived from
the punch feed** rather than typed by hand. An approved absence already arrives
in the punch export as a `Start Non-Work` block carrying a **Pay Type**
(`PTO - Approved`, `Holiday`, …). Without deriving from it the attendance engine
reads that block as a short day and charges points for leave approved weeks
earlier — historically the largest source of false points.

Manual entry exists as a safeguard and for the one thing punches cannot express:
No Call / No Show, whose distinguishing fact is that nobody called. Both entry
points — the day drawer and the bulk dialog — offer the **live** type list from
`schedule_exception_type`, so what a manager can pick is exactly what the import
can write, and a retired type is never on offer for a new row.

### The nine exception types

The list was deliberately collapsed to match Paychex one-for-one: eight linked pay
types plus the one manual type. All nine are `duration_mode = EITHER` (a full-day
toggle, with a time window when partial) and forgive both edges of the day.

Pay types are spelled the way the feed spells them — Paychex's **Description**
column, not its code, so `Jury Duty` rather than `JD`.

| Type | Paychex Pay Type | Excused? |
|------|------------------|----------|
| PTO - Approved | `PTO - Approved` | yes |
| Holiday | `Holiday` | yes |
| Bereavement | `Bereavement` | yes |
| Jury Duty | `Jury Duty` | yes |
| Unpaid - Approved | `Unpaid - Approved` | yes |
| VTO | `VTO` | yes — the company offered it |
| PTO - Not Approved | `PTO - Not Approved` | **no** — 1.00 point for a full day |
| Unpaid - Not Approved | `Unpaid - Not Approved` | **no** — 1.00 point for a full day |
| No Call / No Show | — (manual only) | **no** — 2.00 points |

The two "Not Approved" types earn their flat point **only for a whole day gone**.
A partial block falls through to the ordinary Late / Leave Early bands, so an
unapproved long lunch costs what a long lunch costs rather than what skipping the
day costs. This needs no special case: the engine's point-bearing branch is gated
on the full-day flag, and an *unexcused* window forgives nothing, so a partial one
simply leaves the deviation to be banded normally.

**PTO is granted only in half days and whole days.** Anything shorter is booked
as unpaid time at its real length, so a two-hour absence arrives as a two-hour
block rather than being rounded up into a half day. That policy is what keeps the
block a trustworthy measure of how much of the shift is gone. Even so, the point
is always banded on the **punches**, never on the granted hours — a grant wider
than the real gap cannot inflate the charge.

`schedule_exception_type.paychex_pay_type` is the link, editable in **Admin →
List Management → Scheduling**. A new Paychex pay type therefore needs no code
change — add or link a type in the UI. An unmapped pay type is reported on the
review page rather than silently dropped.

### The two ownership rules

1. **Manual entry wins.** A row a manager typed has no `paychex_reference` and is
   never touched; a derived row that would overlap one is dropped and reported as
   `MANUAL_OVERRIDE`. Import-owned rows are flagged `is_imported` on the grid and
   badged "Paychex" in the drawer, because deleting one there only holds until the
   next import re-derives it — the fix belongs in Paychex.
2. **Full refresh, not upsert.** Import-owned rows (`paychex_reference` prefixed
   `PCX-`) in the range are deleted and rebuilt from the feed, so PTO cancelled in
   Paychex disappears here too. Re-running changes nothing.

### Full day vs. partial

The Paychex `Start Time` is often a default rather than the real one, so the
**duration** is trusted and the anchor is not. A block counts as a full day when
its minutes reach the shift's **net paid** minutes (within a small tolerance) —
comparing against the raw span would mis-classify every shift with an unpaid
lunch as partial. A partial block is placed in the largest gap in that day's work
punches, which is where the person was actually missing, and a window that runs
out exactly at an unpaid break absorbs the break rather than stopping short of
it (the engine measures deviation in clock time, so stopping short would re-charge
the point the leave was meant to forgive).

Derivation runs automatically inside the punch import, before attendance is
recomputed (`rescoreAfterPunchImport` in `importController.ts`), so an import is
self-correcting in one pass.

### Reviewing an import

**Scheduling → Time Off Import** (`/app/scheduling/time-off-import`, linked from
the Exceptions page) re-runs the derivation in `dryRun` mode for the date range
and shows what the feed did. Because it re-derives rather than reading a stored
log, the review is always the live answer instead of a snapshot that drifts from
what the engine actually scored.

Every block lands on one of seven outcomes. Two apply leave; the rest are no-ops
for different reasons, and the distinction is the point of the page:

| Outcome | Meaning |
|---------|---------|
| `FULL_DAY` / `PARTIAL` | Exception written; points forgiven |
| `MANUAL_OVERRIDE` | A hand-typed row already covers it — rule 1 |
| `UNMAPPED` | Pay type has no linked exception type — needs an admin |
| `NO_SHIFT` | Leave on a day with no published shift |
| `DAY_OFF` | Leave on a scheduled day off — normal on holidays |
| `OUTSIDE_SHIFT` | Block does not overlap the shift — often a stale schedule |

Employees are matched on **Alert Email**, falling back to exact `First Last` name
when Paychex leaves it blank. Rows matching neither are counted and named in the
import warnings rather than skipped silently.

## KPI integration

`backend/src/services/attendance/scheduleProvider.ts` is the only surface the
attendance KPI engine reads. It returns **PUBLISHED shifts only**, merged with
that day's exceptions and net paid minutes. Full-day **excused** days are meant
to be **excluded from the attendance denominator** (not counted as a compliant
shift) — the provider surfaces the flags; the KPI engine applies the exclusion.

The consumer is **Insights → Agent Activity - CSR → Attendance**, documented in
[`insights_csr_attendance.md`](insights_csr_attendance.md). Two consequences of
that split are worth knowing while working in Scheduling:

- **Publishing creates attendance denominators.** A DRAFT week scores nothing; a
  published one can produce absences. Publishing an elapsed week is audited for
  this reason.
- **`schedule_exception` is the *only* way to forgive an attendance point.** The
  report has no waive button by design. Full-day excused removes the day from
  compliance entirely; a windowed excused exception forgives that much deviation
  on the edge its type's `affects_arrival` / `affects_departure` flags name.
  A full-day *unexcused* type can also be bound to a point-bearing band (this is
  how No Call / No Show is expressible at all — punch data cannot detect it,
  because the distinguishing fact is that nobody called).

## Routes & access

Navigation and page access are server-driven from the `app_page` /
`app_page_role_access` rows seeded by the migration (section `scheduling`, placed
after Performance Warnings):

| Page key | Route | Admin | Manager | Director | CSR/Agent |
|----------|-------|-------|---------|----------|-----------|
| `sched_calendar` | `/app/scheduling/calendar` (editor) · `/app/scheduling/my-schedule` (OWN) | EDIT | EDIT (own reports) | ALL | OWN |
| `sched_exceptions` | `/app/scheduling/exceptions` · `/app/scheduling/time-off-import` (review, ALL only) | EDIT | EDIT | ALL | — |
| `sched_queues` | `/app/scheduling/queues` — see [`phone_queues.md`](phone_queues.md) | EDIT | EDIT | ALL | — |

Admin-managed lists (exception types, activity types, coverage thresholds) live
under **Admin → List Management → Scheduling** (ADMIN-gated route, re-checked on
the backend). They render via custom editors in
`frontend/src/pages/admin/list-management/SchedulingListEditors.tsx` because they
have richer fields than the generic list-items system.

API is mounted at `/api/scheduling` (`backend/src/routes/scheduling.routes.ts`).
All dates cross the wire as `YYYY-MM-DD` local strings and times as `HH:MM` —
never `Date` instants — per `.cursor/rules/date-handling.mdc`.

## Code map

| Concern | Location |
|---------|----------|
| Pure date/scope/overlap helpers (unit-tested) | `backend/src/services/scheduling/schedule.dates.ts` |
| Scope + write authorization | `backend/src/services/scheduling/schedule.permissions.ts` |
| Templates / shifts / apply-copy / exceptions / list types | `backend/src/services/scheduling/schedule.*.service.ts` |
| Paychex time-off derivation (pure classifier + data/ownership) | `backend/src/services/scheduling/timeOff.classify.ts`, `timeOff.derive.service.ts` |
| KPI read provider — also the sole availability source for phone queues | `backend/src/services/attendance/scheduleProvider.ts` |
| Phone queue coverage (consumer of the above) | [`phone_queues.md`](phone_queues.md), `backend/src/services/queues/*` |
| Controllers / routes | `backend/src/controllers/scheduling/*`, `backend/src/routes/scheduling.routes.ts` |
| Frontend service + hooks | `frontend/src/services/schedulingService.ts`, `frontend/src/hooks/useSchedule*.ts`, `useExceptionTypes.ts` |
| Exception entry (drawer + bulk) | `frontend/src/components/scheduling/ExceptionEditor.tsx`, `ShiftEditorSheet.tsx`, `BulkExceptionDialog.tsx` |
| Pages | `frontend/src/pages/scheduling/*`; admin lists in `frontend/src/pages/admin/list-management/SchedulingListEditors.tsx` (surfaced by `ListManagementPage`) |
| Migration + 9 tables | `backend/prisma/migrations/20260731170000_add_scheduling/migration.sql` |
| Paychex link columns + type consolidation | `backend/prisma/migrations/20260804110000_paychex_pay_type_exceptions/migration.sql`, `20260804160000_unpaid_not_approved/`, `20260804180000_jury_duty_vto/` |

The nine tables are documented in
[`database_schema_updates.md`](database_schema_updates.md#scheduling-module-tables).
