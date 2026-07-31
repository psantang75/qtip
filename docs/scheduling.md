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
- **Template** — a reusable Sun→Sat week (`schedule_template` +
  `schedule_template_day` + `schedule_template_day_segment`) applied onto a range
  of users/dates. Templates carry no department or color — apply rights ride on
  `sched_calendar` EDIT.
- **Coverage threshold** — per-department green/yellow staffing minimums
  (`schedule_coverage_threshold`) that drive the day-view coverage heatmap.

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

## KPI integration

`backend/src/services/attendance/scheduleProvider.ts` is the only surface the
attendance KPI engine reads. It returns **PUBLISHED shifts only**, merged with
that day's exceptions and net paid minutes. Full-day **excused** days are meant
to be **excluded from the attendance denominator** (not counted as a compliant
shift) — the provider surfaces the flags; the KPI engine applies the exclusion.

## Routes & access

Navigation and page access are server-driven from the `app_page` /
`app_page_role_access` rows seeded by the migration (section `scheduling`, placed
after Performance Warnings):

| Page key | Route | Admin | Manager | Director | CSR/Agent |
|----------|-------|-------|---------|----------|-----------|
| `sched_calendar` | `/app/scheduling/calendar` (editor) · `/app/scheduling/my-schedule` (OWN) | EDIT | EDIT (own reports) | ALL | OWN |
| `sched_exceptions` | `/app/scheduling/exceptions` | EDIT | EDIT | ALL | — |

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
| KPI read provider | `backend/src/services/attendance/scheduleProvider.ts` |
| Controllers / routes | `backend/src/controllers/scheduling/*`, `backend/src/routes/scheduling.routes.ts` |
| Frontend service + hooks | `frontend/src/services/schedulingService.ts`, `frontend/src/hooks/useSchedule*.ts` |
| Pages | `frontend/src/pages/scheduling/*`; admin lists in `frontend/src/pages/admin/list-management/SchedulingListEditors.tsx` (surfaced by `ListManagementPage`) |
| Migration + 9 tables | `backend/prisma/migrations/20260731170000_add_scheduling/migration.sql` |

The nine tables are documented in
[`database_schema_updates.md`](database_schema_updates.md#scheduling-module-tables).
