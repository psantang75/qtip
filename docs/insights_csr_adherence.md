# CSR Adherence (Insights → Agent Activity - CSR)

Rolling 90-day **intraday** adherence: whether breaks and lunches are taken at the
scheduled time and for the scheduled length, and whether the phone's Genesys
presence matches the punched break/lunch window. This is the sibling of
[CSR Attendance](insights_csr_attendance.md) — Attendance scores shift *start and
end*; Adherence scores what happens *inside* the shift.

- **Page key** `csr_adherence` · **Route** `/app/insights/csr-adherence`
- **Sidebar** Insights → CSR Agent Activity → Adherence
- **Config** Admin → List Management → **Adherence**

## What it scores

Two **independent** comparisons, both evaluated per break/lunch instance:

1. **Scheduled ↔ Punch** — did the punch start on time (`START`) and run the
   scheduled length (`DURATION`)? There is no separate end check; the end is
   governed by duration. A scheduled segment with no punch is a `MISSED`.
2. **Punch ↔ Phone** — did the Genesys Break/Meal presence line up with the
   *punched* window? Scored as two independent edges (`PHONE_START`, `PHONE_STOP`)
   so the early-dodge and the slow-return are coached separately. Phone is never
   compared to the schedule.

| Kind | Measures | Deviation |
|------|----------|-----------|
| `BREAK_DURATION` / `LUNCH_DURATION` | Punch length vs scheduled length | seconds **over** (coming back early never scores) |
| `BREAK_START` / `LUNCH_START` | Punch start vs scheduled start | absolute seconds off, either direction |
| `BREAK_PHONE_START` / `LUNCH_PHONE_START` | Phone Break/Meal opened **before** the punch-in | seconds early **beyond** the admin *before* tolerance |
| `BREAK_PHONE_STOP` / `LUNCH_PHONE_STOP` | Phone Break/Meal stayed on **after** the punch-out | seconds late **beyond** the admin *after* tolerance |
| `BREAK_MISSED` / `LUNCH_MISSED` | A scheduled segment with no matching punch | flat |

Because the two comparisons are independent, one break can raise more than one
row on the same day (e.g. a late `START` *and* a `PHONE` overhang) — each shows
only the dimension that is off. Phone spans are matched to the punch they
**overlap** (each used once), not by position, so a morning punch is never
compared to an afternoon phone-Break, and a punch with no overlapping phone span
raises no phone row (nothing to compare start/stop against).

**Only scheduled segments are scored.** A shift whose published schedule carries
no break/lunch segments is not measured — there is no plan to compare against.
Extra, unscheduled breaks are ignored for the same reason. A user flagged
**Does not punch** (Admin → Users) is skipped entirely — the same flag
attendance uses — so they earn no miss/duration/phone points and no threshold
email.

### Seeded bands

| Band | Range (inclusive) | Points |
|------|-------------------|--------|
| Break too long — minor / moderate / severe | 3:00–5:59 / 6:00–10:59 / 11:00+ | 0.25 / 0.50 / 1.00 |
| Lunch too long — minor / moderate / severe | 4:00–6:59 / 7:00–11:59 / 12:00+ | 0.25 / 0.50 / 1.00 |
| Break / Lunch missed | whole segment | 1.00 |
| Break / Lunch wrong start | 5:00+ off schedule | **0.00** (occurrence-only) |
| Break / Lunch phone early on — minor / moderate / severe | 1:00–4:59 / 5:00–9:59 / 10:00+ over the *before* tolerance | 0.25 / 0.50 / 1.00 |
| Break / Lunch phone late off — minor / moderate / severe | 1:00–4:59 / 5:00–9:59 / 10:00+ over the *after* tolerance | 0.25 / 0.50 / 1.00 |

Discipline ladder (rolling 90): Coaching 5 · Verbal 10 · Written 15 · Final 20 ·
Termination Review 25.

### Grace

Like Attendance, **duration and start-time grace is the gap below the lowest
band** — there is no separate setting. Break duration grace is therefore ~2 min
(the lowest band starts at 3:00), lunch ~3 min (starts at 4:00), start-time 5 min.

**Phone tolerance is different**: it is asymmetric and admin-set, in `ie_config`
(`adherence_phone_grace_before_sec`, default 120; `adherence_phone_grace_after_sec`,
default 60). The two edges score separately: `PHONE_START = max(0, early − before)`
(how far the phone went Break/Meal *before* the punch-in) and
`PHONE_STOP = max(0, late − after)` (how far it stayed *after* the punch-out). The
`START` edge is the dodge the feature exists to catch: going Break on the phone ten
minutes early to duck calls, then taking the full break. Each break/lunch instance
is matched to the phone span it **overlaps** (each used once), so a morning punch is
never compared to an afternoon phone-Break.

## Report-only switch

Occurrences are **always** recorded, but points only count toward the ladder on or
after `ie_config.adherence_points_active_from` (default `2099-01-01` = report-only).
Both the roster and the notifier read that one gate. The roster is split into a
**Punch** family (schedule-vs-punch: Long / Start / Missed) and a **Phone** family
(phone-vs-punch), each with its own projected Rolling-90 point total. Those
projected points are shown even during the report-only phase so managers can see
what is accumulating — but the discipline **Standing** stays a `Report-only` badge
and no threshold alert can fire until the switch is on. Flip it in **Admin → List
Management → Adherence → Settings**; set the date to when points should begin.

### Adherence percentages (Punch / Phone / Total)

Three seconds-weighted numbers, so a tiny break's miss can't swing the figure the
way a plain average would:

| Metric | Formula | Reads as |
|--------|---------|----------|
| **Punch** | `adherent ÷ scheduled` | Did the break/lunch happen as scheduled (right time & length). |
| **Phone** | `punched ÷ (punched + off-queue overhang)` | Of all break/lunch off-queue time, the share inside the punched window. 15 min punched + 10 min overhang = 60%. |
| **Total** | `adherent ÷ (scheduled + off-queue overhang)` | One blend — pulled down by both a bad punch *and* phone overhang. |

*Overhang* is the raw phone Break/Meal time outside the punched window (before +
after), summed from `phone_break_extra_sec` + `phone_lunch_extra_sec`. When no
phone feed exists for a day, overhang is 0 and Phone/Total read as if the phone
matched — the absence shows up instead as zero phone points.

All three compliance cells (Punch, Phone, Total) are colored **red / yellow /
green** against admin-tunable cut-offs stored in `ie_config`
(`adherence_compliance_green_min`, default 90; `adherence_compliance_yellow_min`,
default 80): at/above green is green, at/above yellow is yellow, below is red. Edit
them in **Admin → List Management → Adherence → Settings**. The roster summary line
carries, per family, the event breakdown + a **Total** count, the projected points
bucketed **0–30 / 31–60 / 61–90** days plus a **Total**, and that compliance cell;
Standing stays a `Report-only` badge until points are switched on.

`adherence_start_date` (default `2026-06-21`) is the separate floor below which
nothing is scored at all, even though earlier punch history exists.

## Data sources

- **Plan** — `scheduleProvider` (shared with Attendance): PUBLISHED shift
  segments. Paid segments are breaks, unpaid segments are lunch.
- **Actuals** — `breakPunchProvider`: `punch_raw` blocks with `pay_type` `Break`
  (paid rest) and `Meal` (unpaid lunch), assigned to the nearest scheduled day.
- **Phone** — `phonePresenceProvider`: the Genesys primary-presence Break/Meal
  spans, read through the raw phone pool (not Prisma — it is a separate DB).
  Identity bridges on email: `users.id → users.email → tblPhoneUser.PhoneUserID`.
  **Degrades safely**: no phone DB (dev/test) or no phone identity ⇒ no phone
  occurrences for that person, never a false positive.

All times compare as **seconds from local (ET) midnight** — Genesys `*_ET`
columns and the ET-pinned punch process share the same wall clock, so no timezone
conversion is needed.

## Effective dating, recompute, notifications

Identical mechanics to Attendance (see that doc for the detail):

- `adherence_point_rule` / `adherence_warning_threshold` are effective-dated;
  recompute scores each day under the rules in force that day.
- `recomputeRange` is idempotent, transactional and single-flight; the delete
  scope is the **date range**. Automatic after a punch import
  (`runImport.rescoreAdherenceAfterPunchImport`); manual via
  `POST /api/insights/admin/adherence/recalculate` (≤ 730 days).
- Crossing a rung upward queues `notification_queue` rows with
  `template_key = 'adherence_threshold_reached'`, deduped on
  `adherence_level:<csr>:<level>`. Silent while points are report-only.

## Adherence exceptions (excused / unexcused)

Adherence exceptions work **exactly like attendance exceptions**: a
manager/admin logs an exception against one break or lunch on one day, picking a
**type** from a catalog whose `is_excused` flag alone decides scoring. It is
**adherence-only**: it forgives only that segment's adherence points. It never
edits the schedule, the punch/time clock, attendance, or the phone rules.

- **Type catalog (List Management → Adherence → Adherence Exception Types):** the
  twin of attendance's exception types (`adherence_exception_type`), minus the
  attendance-window-only fields. Each type carries a label, an optional
  category/description, and an `is_excused` flag. Seeded with *Approved Variance*
  and *System / Tool Issue* (excused) and *Coaching Only* and *Unapproved*
  (unexcused). Managed with the shared `GenericListEditor`, gated on `admin`.
- **Where it's entered:** the dedicated **Adherence Exceptions** page
  (`/app/scheduling/adherence-exceptions`), directly below **Attendance
  Exceptions** in the Scheduling nav, gated on the `sched_adherence_exceptions`
  page key (Admin/Manager EDIT). A row targets one segment via
  `(user_id, work_date, segment_kind, seq)`, plus a type and an optional reason.
- **What it forgives:** if the chosen type is **excused**, the **whole segment**
  is forgiven — **Long** (duration), **Start** (early *or* late), **Miss** (no
  punch), **and** the **Phone Start/Stop** tied to that same punch — so the
  segment scores 100% and its points drop out. If the break itself is approved,
  the phone timing that hangs off it is approved with it. An **unexcused**
  exception is recorded for coaching/audit only and changes no points.
- **Phone follows the excused break.** Phone Start/Stop are measured off the
  *actual punch*, and the overlapping phone span is still consumed (so it can't be
  matched to a sibling break), but an excused segment scores none of it.
- **Storage:** one `adherence_exception` row per `(user_id, work_date,
  segment_kind, seq)` referencing `exception_type_id`. `seq` is the sorted-by-start
  index within that kind (matching the occurrence `seq`).
- **Recompute:** every write recomputes that user's day immediately
  (`recomputeRange(date, date, [userId])`), and a range recompute re-reads the
  excused exceptions, so the report is always current. If the schedule's break
  count later changes, `seq` re-maps against the current segments on the next
  recompute.

## API

Reads (GET only) under `/api/insights/csr/adherence`:

| Endpoint | Returns |
|----------|---------|
| `GET /summary` | Roster rows, filter options, `pointsActive`, plus the bands/ladder in force on the as-of date |
| `GET /occurrences?userId=` | Per-day break/lunch detail; each row's `counted` flag says whether its point actually applied |

Writes on the Insights **admin** router `/api/insights/admin/adherence`:
`GET /config`, `PUT /rules`, `PUT /thresholds`, `PUT /settings`,
`POST /recalculate`. Every write records an `audit_logs` row. `GET /occurrences`
authorises `userId` independently of the roster.

## Scoping

Standard Insights page access via `resolveDeptFilter`, shared with the other CSR
reads through the parametrised `csrHandler` in `insightsCsr.controller.ts`. SELF
scope narrows every query to the viewer; the same known DEPARTMENT-scope gap noted
in the Attendance doc applies equally here.

## Code map

| Concern | Location |
|---------|----------|
| Pure band matching, effective dating, validation | `backend/src/services/adherence/adherence.rules.ts` |
| Config load + `ie_config` settings/gate | `backend/src/services/adherence/adherence.config.ts`, `adherence.settings.ts` |
| Actuals (break/meal punches) | `backend/src/services/adherence/breakPunchProvider.ts` |
| Phone presence + identity bridge | `backend/src/services/adherence/phonePresenceProvider.ts` |
| Scoring + idempotent recompute (excused segments forgiven) | `backend/src/services/adherence/adherence.engine.ts` |
| Exception type catalog (list/create/update/setActive/reorder) | `backend/src/services/adherence/adherence.exceptionType.service.ts` |
| Per-person exceptions (list/upsert/delete + recompute) | `backend/src/services/adherence/adherence.exception.service.ts` |
| Exception entry page + type editor (List Management) | `frontend/src/pages/scheduling/AdherenceExceptionsPage.tsx`, `pages/admin/list-management/SchedulingListEditors.tsx` |
| Exception + type routes (`/api/scheduling/adherence-exceptions`, `/adherence-exception-types`) | `backend/src/routes/scheduling.routes.ts`, `controllers/scheduling/{exception,listType}.controller.ts` |
| Rolling window, buckets, compliance | `backend/src/services/adherence/adherence.rollup.service.ts` |
| Threshold notifications | `backend/src/services/adherence/adherence.notify.ts` |
| Read controller / routes | `backend/src/controllers/insightsCsr.controller.ts`, `routes/insightsCsr.routes.ts` |
| Admin config controller / routes | `backend/src/controllers/insightsAdminAdherence.controller.ts`, `routes/insightsAdmin.routes.ts` |
| Page | `frontend/src/pages/insights/CSRAdherencePage.tsx` |
| Admin editors | `frontend/src/pages/admin/list-management/AdherenceListEditors.tsx` |
| Migration + 4 tables + seeds | `backend/prisma/migrations/20260903150000_add_adherence/migration.sql` |
| Migration — `adherence_exception` table | `backend/prisma/migrations/20260904130000_add_adherence_exception/migration.sql` |
| Migration — `adherence_exception_type` + type-based rework + page | `backend/prisma/migrations/20260906120000_adherence_exception_types/migration.sql` |

## Tests

`backend/src/services/adherence/__tests__/` — no database:

- `adherence.rules.test.ts` — band boundaries (2:59 vs 3:00, inclusive edges),
  effective dating, ladder resolution, overlap validation.
- `adherence.engine.test.ts` — `scoreDay` across duration grace, the missed path,
  start-time, and the phone before/after tolerance (the 10-min-early dodge), the
  flawless-day = 100% invariant, and excused exceptions (an excused segment forgives
  Long, early/late Start, Miss, and its phone Start/Stop; applies only to that
  instance, not its siblings).
