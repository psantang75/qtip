# CSR Attendance (Insights → Agent Activity - CSR)

Rolling 90-day attendance points and schedule compliance, derived by matching
Paychex clock punches against the published schedule. This is the scoring layer
**over** Scheduling; Scheduling owns the plan and the exceptions, this owns the
points.

- **Page key** `csr_attendance` · **Route** `/app/insights/csr-attendance`
- **Sidebar** Insights → CSR Agent Activity → Attendance
- **Config** Admin → List Management → **Attendance**

## The two metrics

**Points** are the disciplinary metric: a rolling 90-**calendar**-day sum of
occurrences, one row per infraction. **Compliance** is the operational metric:
`SUM(adherent_minutes) / SUM(scheduled_minutes)` over scheduled days. They answer
different questions and can disagree — somebody 4 minutes late every day has poor
points and near-perfect compliance.

| Band | Range (inclusive) | Points |
|------|-------------------|--------|
| Late 3+ | 0:03:01 – 0:15:59 | 0.25 |
| Late 16+ | 0:16:00 – 1:00:59 | 0.50 |
| Late 61+ | 1:01:00 – 2:00:59 | 0.75 |
| Late 121+ | 2:01:00 – 7:59:00 | 1.00 |
| Leave Early | 0:03:01 and over | 0.50 |
| Absent | full day | 1.00 |
| No Call / No Show | full day, manager-logged | 2.00 |

| Step | Rolling 90 points |
|------|-------------------|
| Coaching | 3 |
| Verbal | 5 |
| Written | 7 |
| Final | 9 |
| Separation | 10 |

### Grace

**Grace is the gap below the lowest band** — it is not a separate setting, and
moving the first band moves grace with it. With the bands above, grace is
**0:00:01 through 0:03:00 inclusive**; one second later is Late 3+ and charges the
full 0.25.

Grace earns nothing, but `late_seconds` is recorded on every day regardless, which
is what makes the **Grace** column possible. A person two minutes late every single
day is completely invisible to a point total, and that is exactly the pattern worth
catching before it becomes a discipline conversation. The column is informational
and never disciplinary.

### The 90-day window

Ninety **calendar** days, not ninety worked days — `[asOf - 89, asOf]` inclusive,
matching how the policy is written. Points roll off on the 91st calendar day after
the occurrence. The three buckets (0–30 / 31–60 / 61–90 days) partition the window
exactly, so Rolling 90 is their sum; there is deliberately no separate Total
column, since a fourth number could only ever disagree.

Buckets are days rather than calendar months on purpose: months would make the
90-day total the sum of three unequal spans, and the first of each month would
silently reshuffle everyone's numbers.

### Trend

`Rolling 90 ÷ days covered × 90` — what the 90-day total would reach if the
current rate continued for the whole window. For anyone with a full 90 days of
history it equals Rolling 90 exactly; it only rises above it when the history is
short, which is the case it exists for. Three points earned over a 30-day span
projects to nine.

**Days covered is a calendar span** — first measured day to last — not a count of
scheduled days. Counting shifts would conflate a part-time schedule with missing
data: somebody working three days a week would sit at one-third coverage forever
and their trend would be permanently inflated threefold. Span-based coverage gives
a part-timer with complete history a trend equal to their Rolling 90, which is the
truth.

The arrow beside it compares the newest 30 days against the oldest 30. Up means
getting worse.

## Rules that are easy to get wrong

- **Bounds are inclusive on both ends.** 15:59 is Late 3+, 16:00 is Late 16+.
- **Bands may not overlap** — the admin editor rejects overlaps, because the same
  deviation matching two rows would make the points depend on sort order.
- **No daily cap.** Late *and* left early on one day charges both.
- **Consecutive absences count per day.** Five days out is 5 points.
- **Lateness beyond the top LATE band becomes an absence.** A 9-hour "late
  arrival" on an 8-hour shift means they were not there; without this the day
  would score nothing at all.
- **A missing Clock Out is treated as working to end of shift.** It is a data
  problem (`missed_punch`), not evidence somebody left early. Guessing otherwise
  invents points that cannot be defended.
- **Non-Work is presence.** `Start Non-Work` / `End Non-Work` count as arrival and
  departure alongside `Clock In` / `Clock Out`. Non-Work is on-the-clock time in a
  non-productive state (training, a meeting, an outage). Recognising only
  `Clock In` produced twelve false full-day absences across six of thirteen people
  in the seeded data.
- **Break and Meal punches are ignored** for arrival/departure. They prove
  presence but not when the person arrived or left.

## Forgiveness

There is exactly one forgiveness mechanism: a **`schedule_exception`** logged in
Scheduling. There is deliberately no "waive" button on the report — two ways to
forgive a day means two sources of truth.

| Exception | Effect |
|-----------|--------|
| Full-day, excused | Day leaves **both** sides of compliance; all occurrences suppressed. This is the path protected leave takes. |
| Windowed, excused | Forgives that many seconds off the arrival or departure deviation, per `affects_arrival` / `affects_departure`. The rest is still charged. |
| Full-day, unexcused, bound to an EXCEPTION band | **Replaces** the derived absence (No Call / No Show scores 2.00, not 1.00 + 2.00). |
| Windowed, unexcused | Forgives nothing, and does **not** earn its type's flat point — the deviation is banded as ordinary lateness or an early leave. |
| Anything else | Ignored by scoring. |

A windowed exception forgives only the part of its window that actually overlaps
the deviation being scored. Summing its raw duration instead would let a two-hour
mid-shift window erase an unrelated two-hour late arrival.

Nearly all of these rows are **derived from the Paychex punch feed** rather than
typed by hand — an approved absence arrives as a `Start Non-Work` block carrying
a Pay Type, and the importer turns it into an exception before recomputing. See
[Time off comes from Paychex](scheduling.md#time-off-comes-from-paychex). Two
consequences for reading this report:

- An absence charged for approved leave means the derivation did not fire, not
  that the band is wrong. **Scheduling → Time Off Import** says why (a pay type
  with no linked exception type, a stale schedule, an employee the feed could not
  match).
- `PTO - Not Approved` and `Unpaid - Not Approved` are exceptions that *carry* a
  point (1.00) rather than forgiving one, and only for a full day — a partial
  block is banded as ordinary lateness or an early leave. Seeing one of these on
  the report is the system working.
- Six of the eight linked pay types are excused and forgive: `PTO - Approved`,
  `Holiday`, `Bereavement`, `Jury Duty`, `Unpaid - Approved` and `VTO`. VTO is
  excused because the company offered it, so accepting it cannot cost a point.

## Effective dating

`attendance_point_rule` and `attendance_warning_threshold` are effective-dated
(`effective_from` / `effective_to`, both inclusive). Recompute scores each day
under the rules in force on **that** day, so editing a band today cannot push
somebody over Written retroactively. This is what makes a warning delivered in
March still defensible in September.

Saving in the admin editor retires the current version at `effectiveFrom - 1` and
inserts a new one. Saving with a date at or before the current version's start
date is treated as a **correction** and updates in place — retiring it would
produce `effective_to < effective_from`, a window matching no date, silently
deleting the band.

To apply a change backwards on purpose: set the effective date into the past, then
**Rescore last 90 days**.

## Where absences are *not* generated

The most damaging failure mode this engine has is manufacturing absences from
missing data. Four guards, all of which the current data exercises:

1. **Only PUBLISHED, non-day-off shifts** create a denominator. A stack of DRAFT
   weeks can never mark anyone absent.
2. **A date nobody in the company punched on is skipped** — a feed gap or an
   unrecorded closure, not a company-wide absence.
3. **Days outside a person's own punch span are skipped** — a new hire's pre-hire
   scheduled days, a leaver's post-departure ones. An inactive user's span closes
   at their last punch; an active user's runs to the global watermark so a genuine
   absence last week still counts.
4. **A user with no punch history at all is not scored.** Nothing is knowable
   about them.

The recompute log reports each skip count, and `POST /recalculate` returns them.

### Holidays and closures

A `business_calendar_days` row of `HOLIDAY` or `CLOSURE` makes the day a day off
with zero scheduled minutes, so it produces **no denominator, no compliance and no
points**. This guard is load-bearing: July 6 (July 4th observed) carried 11
published shifts that would otherwise have become 11 absences.

**Holidays stay excluded even when people work them** — decided deliberately. July
6 had 14 people punch 108 hours against 11 published shifts, and none of it reaches
compliance. The reasoning is that a holiday sits outside the compliance frame
entirely, and the property that matters most is that nobody can ever be charged a
point for a company holiday. The cost is that genuinely worked holiday hours are
invisible to the metric; hours worked are a payroll question, and Paychex already
answers it.

Holiday pay itself arrives in the punch feed as `Start Non-Work` rows (all 12 of
Memorial Day's, totalling 96 hours), which is a second reason those hours never
land in the numerator.

### Non-Work days are not surfaced separately

Twelve days in the current window have presence established *only* by
`Start Non-Work` — on the clock, non-productive for the whole shift. They score
nothing, so they never appear in the drill-down, which lists point-bearing
occurrences only. Decided deliberately: they are clean days for attendance
purposes, and how productive somebody was is a different report's question. Punch
type is therefore not shown anywhere on this page.

## As-of date

Every read is anchored to an as-of date, clamped to
`min(period end, today, punch watermark)`. All three clamps matter: "Current Year"
ends December 31, and reading past the watermark shows a run of days with no
actuals. When the date is pulled back the page says so.

## Recompute

Idempotent and serialised. Recomputing a range deletes and reinserts it, so the
result depends only on the current schedule, punches and rules — never on what was
there before. The delete scope is the **date range**, not the set of users scored,
or rows for somebody who has since dropped out of the punch feed would survive
forever.

- Automatic: after a punch import (`importService.importPunchData`).
- Manual: `POST /api/insights/admin/attendance/recalculate` (admin), capped at 730
  days per call because the lock is global.

## Threshold notifications

Crossing a discipline threshold upward queues `notification_queue` rows with
`template_key = 'attendance_threshold_reached'`. `DigestScheduler` drains the
queue every five minutes.

### Who gets it

`DigestScheduler` mails whoever is named on a queue row — one row reaches one
mailbox — so an audience of several people is several rows. The audience comes
from the template's `recipient_roles`, the same admin-editable list every other
notification uses, resolved by `RoleResolver`:

| Role token | Resolves to | Default |
|------------|-------------|---------|
| `agent` | The CSR who crossed | on, and locked on |
| `designated` | The addresses on the Alert Recipients list | on |
| `admins` | Every active user with the Admin role | off |

Change the audience at **Admin > Email Templates > Attendance** rather than in
code.

`designated` exists because role tokens describe roles, and "every admin" was too
many — it included service and test accounts. The list lives at **Admin > List
Management > Notifications > Alert Recipients** as `list_items` rows under
`notification_recipient`, with the address in `label`, the same mechanism as the
import sender allowlist. Each address must belong to an **active QTIP user**: a
notification is delivered through a `notification_queue` row and that row requires
a real `user_id`, so an address matching nobody cannot be mailed. Those are logged
at `warn` rather than dropped silently, because a typo otherwise looks exactly
like a working configuration.

The list is shared by every template offering the option, since in practice the
same few people watch every operational alert. A template only sends there if
`designated` is ticked for it.

One template serves both audiences. It branches on `recipient.matchedRole`, so
the CSR reads "Your attendance points…" while everyone else gets a leading Agent
column and third-person copy. That mirrors `writeup.scheduled`.

### Firing once, and only once

`attendance_level:<csr>:<level>` is the CSR's dedupe key and doubles as the
rung's **claim**; other recipients are suffixed `:u<recipientId>`. If the claim
key exists the whole crossing is skipped, so:

- An alert fires **once per rung per person, ever**. Points rolling off and being
  re-crossed in the rolling window cannot re-send it, which is what keeps the
  alert worth reading.
- Adding somebody to the audience does **not** mail them a backlog of crossings
  announced before they were added.

### Clearing queued alerts without sending them

**Admin > Email Templates > Queue** lists everything waiting, flags rows whose
template no longer exists, and discards individually or in bulk. The equivalent
by hand:

```sql
UPDATE notification_queue SET processed_at = NOW()
WHERE processed_at IS NULL AND template_key = 'attendance_threshold_reached';
```

**Do not `DELETE` them.** The dedupe key is what stops the alert re-firing; delete
the row and the next recompute queues it again. Marking it processed suppresses
the send *and* keeps the rung permanently claimed. The trade-off is that the
person is never alerted at that rung — crossing a *higher* rung later still
fires, because that is a different key.

A row whose `template_key` matches no template in `email_templates` and no
`.hbs` file is **discarded** by the scheduler with an `error`-level log line,
rather than retried. Retrying cannot fix a missing seed, and the old behaviour
left it spinning in the log every five minutes.

## API

Reads are GET-only under `/api/insights/csr/attendance` — Insights **report**
routers never write.

| Endpoint | Returns |
|----------|---------|
| `GET /summary` | Roster rows, filter options, plus the bands and ladder in force on the as-of date (so tooltips need no second request) |
| `GET /occurrences?userId=` | Per-day detail for one person: the scheduled window, the actual punches, the difference, the reason and the points |
| `GET /compliance?months=` | Person × month compliance matrix |
| `GET /day-of-week` | Absence/lateness by weekday. Kept as a read endpoint; the page no longer renders it. |

Writes are on the Insights **admin** router, `/api/insights/admin/attendance`:
`GET /config`, `PUT /rules`, `PUT /thresholds`, `POST /recalculate`. Every write
records an `audit_logs` row — moving a discipline threshold moves where every
employee stands.

`GET /occurrences` authorises `userId` independently of the roster: a viewer who
can read the roster must not be able to read detail for somebody the roster
excluded.

## Wall-clock times

Shift and punch DATETIME columns hold the UTC instant, so MySQL `TIME(start_at)`
prints four hours off the wall clock an EDT user sees. `hmFromDateTime` in
`schedule.dates.ts` is the single formatter for the whole Scheduling module and
`combineLocal` is its inverse, so the round trip is consistent and the attendance
drill-down uses the same pair. Querying `TIME()` directly to sanity-check a shift
will look wrong; it is the storage representation, not the schedule.

Every timed occurrence is self-reconciling: displayed punch minus displayed
schedule equals the stored `deviation_seconds`. All 71 in the current data
reconcile, which is the check that would catch the two sides being formatted on
different clocks.

## Scoping

Standard Insights page access. `resolveDeptFilter` in
`backend/src/services/insightsScope.ts` is shared with the QC reports.

> **Known gap, deferred by decision, affecting every Insights page equally:**
> DEPARTMENT scope returns only the viewer's own `department_id` and does not
> cascade to child departments or consult `department_managers`. A manager whose
> `department_id` is NULL resolves to an empty filter, which emits no SQL and so
> **fails open**. Current Page Access grants Manager the ALL scope, which
> sidesteps it. `utils/departmentHierarchy.ts` has the descendant helpers a fix
> would use.

## Code map

| Concern | Location |
|---------|----------|
| Pure band matching, effective dating, validation | `backend/src/services/attendance/attendance.rules.ts` |
| Plan side (PUBLISHED shifts, net minutes, exceptions) | `backend/src/services/attendance/scheduleProvider.ts` |
| Actuals side (punch → arrival/departure, feed coverage) | `backend/src/services/attendance/punchProvider.ts` |
| Paychex time off → exceptions (runs before recompute on import) | `backend/src/services/scheduling/timeOff.classify.ts`, `timeOff.derive.service.ts` |
| Scoring + idempotent transactional recompute | `backend/src/services/attendance/attendance.engine.ts` |
| Rolling window, buckets, trend, discipline level | `backend/src/services/attendance/attendance.rollup.service.ts` |
| Compliance matrix, day-of-week | `backend/src/services/attendance/attendance.analytics.service.ts` |
| Threshold-crossing notifications | `backend/src/services/attendance/attendance.notify.ts` |
| Read controller / routes | `backend/src/controllers/insightsCsr.controller.ts`, `backend/src/routes/insightsCsr.routes.ts` |
| Admin config controller | `backend/src/controllers/insightsAdminAttendance.controller.ts` |
| Shared Insights scope primitives | `backend/src/services/insightsScope.ts` |
| Page | `frontend/src/pages/insights/CSRAttendancePage.tsx` |
| Roster + matrix components | `frontend/src/components/insights/AttendancePointsRoster.tsx`, `AttendanceMatrix.tsx` |
| Roster header tooltips (bands on Rolling 90, ladder on Level, grace on Grace — all read from `/summary`) | `frontend/src/components/insights/AttendancePolicyTooltips.tsx` |
| Admin editors | `frontend/src/pages/admin/list-management/AttendanceListEditors.tsx` |
| Migration + 4 tables | `backend/prisma/migrations/20260803200000_add_attendance_points/migration.sql` |

## Tests

`backend/src/services/attendance/__tests__/` — 70 tests, no database:

- `attendance.rules.test.ts` — band boundaries (3:00 vs 3:01, 15:59 vs 16:00),
  effective dating, ladder resolution, overlap validation.
- `attendance.engine.test.ts` — `scoreDay` across grace, every band, absence,
  each forgiveness path, point-bearing exceptions, unpaid segments, overnight
  shifts, and the compliance ≤ 100% invariant. Includes the intersection cases: a
  window that misses the deviation forgives nothing, one that partly covers it
  forgives only the overlap.
- `scheduleProvider.test.ts` — `netMinutes`, the compliance denominator, including
  segments outside the shift and overnight spans.

Derivation is covered separately by
`backend/src/services/scheduling/__tests__/timeOff.classify.test.ts` — full-day
detection against net minutes, work-punch anchoring, unpaid-break absorption at
the window boundary, and blocks falling outside the shift.

## Validation against real data

Against the 2026-05-01 → 2026-08-03 punch feed: 765 scheduled days scored, 136
occurrences (89 late, 29 absent, 17 early leave, 1 point-bearing exception). Two
runs produce an identical fingerprint over `(user, date, kind, points)`,
confirming idempotency.

The same feed carries 119 Non-Work blocks, of which 20 became exceptions (14 full
day, 6 partial). Most of the remainder are leave on unpublished days — visible on
the Time Off Import review as `NO_SHIFT`, which is a schedule-coverage gap rather
than a derivation failure. Re-running derivation over the range and deleting a
manual row confirms both ownership rules: a hand-typed exception survives the
import and suppresses the derived one, and removing it lets the derived row
return on the next run.

Reconciling `adherent_minutes` against Paychex `regular_duration` leaves a
consistent −20 to −50 hours per person per quarter, which is the unpaid lunch the
denominator also excludes. Three people (Carl Taite, Emily Santangelo, Kiara
Kelley) diverge much further because they have only 20–30 **published** shifts
against 48–64 worked days — a schedule-coverage gap, not a scoring error. Their
`Days Measured` column exposes it and the span-based trend normalises it.

One person shows a long stretch of absences with no punch rows of any kind while
colleagues punched normally. That is indistinguishable from absence by data alone;
it needs either an excused `schedule_exception` (leave of absence) or the
DRAFT/PUBLISHED status of those shifts corrected.

An earlier round of this reconciliation was distorted by Paychex leaving **Alert
Email** blank on 12.4% of punch rows, which the importer silently skipped —
several people simply had no actuals. The importer now falls back to exact
`First Last` matching and reports anything it still cannot resolve, so a gap like
that surfaces in the import warnings instead of as absences.
