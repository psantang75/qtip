# Phone Queues

Queue coverage planning: **who should be staffing which phone queue, and when**.

QTIP is the **plan of record only**. Nothing here is pushed to Genesys — QTIP
reads that database and never writes to it (see
[`phone_system.md`](phone_system.md)). The output of this module is a plan a
supervisor acts on, not a configuration change.

Availability comes entirely from the work schedule, so PTO, a shift change or a
holiday closure changes the plan with nothing to re-enter. Improve time off in
[Scheduling](scheduling.md) and queue coverage improves with it.

## Concepts

- **Queue** (`phone_queue`) — the global library, one row per queue that exists
  company-wide. `queue_code` records the matching Genesys queue name so a
  supervisor knows what to change; nothing joins on it. Retired by `is_active`,
  never deleted, because membership and day overrides reference it.
- **Department assignment** (`phone_queue_department`) — a queue a department
  staffs, plus that department's numbers for it: `fill_priority`, `min_agents`,
  `target_agents`, `max_agents`. The same queue can matter more to one
  department than another, which is why the numbers live here and not on the
  queue.
- **Queue window** (`phone_queue_window`) — a time-of-day override of those
  numbers. It does **not** define time frames; see below.
- **Member** (`phone_queue_member`) — who may staff a queue. `person_priority`
  ascends (1 is pulled in first, the same direction as `fill_priority`).
  `is_home` is where somebody sits by default; `is_pinned` means never move them.
- **Policy** (`phone_queue_policy`) — one row per department for the rules that
  are not per-queue: whether planning is on at all, how many queues one person
  can cover, the floor rule, whether pins are respected, and `fill_strategy`
  (who covers when several people could).
- **Override** (`phone_queue_assignment_override`) — a manager's manual `ASSIGN`
  or `EXCLUDE`, for a window of a day or the whole of it. The only stored plan
  data.

## The plan is computed, never stored

Coverage is solved on read from the work schedule, the same way the campaign
month is projected rather than materialised. There is no publish step, no
nightly job, and nothing to go stale: a PTO row added a minute ago is already
reflected on the next load. Re-solving on a schedule change is therefore
automatic rather than something that has to be triggered.

## Where availability comes from

`backend/src/services/attendance/scheduleProvider.ts#getScheduledShifts` is the
**only** door to the schedule. The solver never queries shifts or exceptions
itself, which is what keeps queue coverage and schedule coverage from drifting
apart.

Somebody is on coverage for the minutes that are:

- inside their shift, **and**
- not inside a segment whose activity does not count as coverage (lunch,
  training, a meeting), **and**
- not inside an exception window.

A day off, a holiday/closure, or a full-day exception leaves them with no
coverage minutes at all.

That adapter returns **PUBLISHED shifts only** by default — publishing is what
creates attendance denominators. Queue planning may pass `{ publishedOnly: false }`
to preview a week still being built; it scores nothing, and the page labels the
result. Every scoring caller must leave the default alone
(`scheduleProvider.publishedOnly.test.ts` guards this).

## The grain is a 15-minute slot

The day is cut into quarter hours and every one of them is solved. This is the
single most important thing about the module, and it was originally got wrong:
the first version graded whole coverage frames, which for a department with one
all-day frame meant somebody at lunch from 12:30 to 13:30 counted as "available
in the frame" and nothing was ever pulled over to cover them. Arranging lunch
cover is the job, so the grain has to be fine enough to see a lunch.

The axis is the hours the department's people actually work, widened to whole
hours — not a literal midnight-to-midnight day, which would report every queue
as thinning to zero because nobody is on the phone at 3am, and not the
department's `schedule_coverage_window` rows either, because a shift starting an
hour before the first window would simply vanish from the board. A day nobody is
scheduled has no axis and no slots.

`phone_queue_window` supplies numbers, not boundaries. A slot takes the numbers
of whichever window contains its start minute, falling back to the row in
`phone_queue_department`. The two therefore never need to line up.

## How the solver places people

Per slot, in this order (`queue.solve.slot.ts`):

0. **OVERRIDE** — a manager's manual call is a **constraint, resolved first**.
   `ASSIGN` takes its seat before the rules run so the passes below fill around
   it; `EXCLUDE` makes the person ineligible for that queue. Applying an
   exclusion at the end instead would punch a hole nobody backfills, which is
   the opposite of what "take them off this queue" means.
1. **PINNED** — somebody who must not move, seated before seats are contested. A
   department that has turned pins off ignores them completely: a pin that no
   longer holds somebody in place must not still be what puts them there.
2. **FLOOR** — every active queue gets one body before any queue is filled to its
   minimum, when `require_min_one_per_queue` is on. A queue with nobody in it
   does not ring, so a fully-staffed queue beside an empty one is worse than two
   thin ones. A queue nobody eligible can staff is reported `UNSTAFFABLE` and
   skipped for the rest of the pass rather than starving the others.
3. **MINIMUM**, then **TARGET**, in `fill_priority` order — the highest-priority
   queue reaches its minimum first, then the next, until the pool is dry. Ties on
   priority break on the library `sort_order`, so the order is total and never
   arbitrary. `max_agents` caps both passes.
4. **HOME** — whoever is still spare returns to their usual queue rather than
   sitting idle, capped by `max_agents`.

Candidates for a seat are ordered by home queue first, then by whoever held that
queue in the previous slot, then by the department's `fill_strategy`, then by
username so the answer never depends on row order.

### Continuity: one person covers a whole absence

Slots are solved in ascending order and each is told who held each queue in the
slot before it. Without that, every quarter hour is decided from scratch and the
cover changes four times an hour, which is unworkable on a real phone system.

Continuity sits **below** home in the candidate order, and that is what makes it
settle rather than flap. At 12:30 Jamie is at lunch, so Mitch is pulled to
Inbound; at 12:45 and 13:00 he keeps it on continuity because nobody is closer;
at 13:30 Jamie is back, wins on home, and Mitch is released to his own queue.
One cover for the whole hour, given up the moment it is not needed.

### `fill_strategy`: who covers when several people could

- **`PRIORITY`** (default) — ascending `person_priority`, the order people
  already understand from the queue fill order.
- **`ROUND_ROBIN`** — whoever has served the fewest **cover-minutes** so far that
  day, so lunch cover is shared out rather than always falling on the same
  person. Only time spent on a queue that is *not* your home counts; sitting at
  home is not a favour you are owed a turn away from. An exact tie breaks on a
  stable position in the roster. No rotation state is stored, which is what keeps
  the plan deterministic under compute-on-read.

### Home is a preference, never a claim

Seating everyone at home **before** the priority passes looks like the way to
honour "people sit where they normally sit", and it is wrong. It hands every
person to whichever queue they happen to live on before any queue is measured,
so with `max_queues_per_person` at 1 the pool is empty by the time the fill
passes run: a low-priority queue holds five people against a target of one, the
top-priority queue can never be brought up to its minimum, and taking somebody
out of a short queue moves nobody in to replace them. Pulling from a lower
priority queue to a higher one is the entire point of the module, so seats are
allocated by priority and home only decides **who** takes them.

Because the floor rule still runs first, a lower-priority queue is never emptied
to feed a higher-priority one — it gives up only the people it holds *above* its
own floor.

### Four seat reasons, not one per pass

A seat reads **HOME** whenever the person landed on their own home queue,
whichever pass placed them, and **COVER** whenever they did not. The other two
are **PINNED** and **OVERRIDE**. Which internal pass seated somebody matters far
less to a supervisor than the one thing they need to see at a glance: this
person is where they usually are, or this person was pulled off their usual
queue to prop up another.

## Assigned vs. thins to

Two numbers per queue per slot, answering different questions:

- **Assigned** — how many people are in the queue.
- **Thins to** (`trough`) — the fewest assigned people actually on coverage at
  any moment inside the slot, once part-slot absences come out.

A lunch that starts at 12:35 makes the 12:30 slot's trough lower than its
assigned count, and the trough is the number that answers the phone. So the
grade uses it: `green` at or above target, `yellow` at or above minimum, `red`
below, `none` at zero, and `closed` when nobody in the department is on shift at
all. The trough is computed at interval boundaries rather than by sampling a
grid, so a ten-minute hole inside a slot still registers.

Contiguous slots with the same problem are merged into one warning, so "Inbound
below minimum 12:30–13:30" is reported once rather than four times.

## On screen

One department-scoped page with Day and Week pills
(`QueueCoveragePage.tsx`).

**Day** — people down the side, quarter hours across, each cell coloured by the
queue that person is on. It is the spreadsheet supervisors already keep, made
live: lunches and gaps are holes in the colour, which is how you spot two people
away at once. A cover is the covered queue's colour knocked back and outlined; a
manual placement carries a dark underline. Under the people, one row per queue
shows the headcount slot by slot, graded with the same `COVERAGE_CLS` language as
the scheduling views.

**Week** — queues down the side, days across, each cell an hourly strip graded by
that day's worst slot with the headcount at that same moment. Click a day to open
it.

**Click a cell** to correct the plan: a checklist of the queues that person can
take, plus a scope — this slot, this block, or the whole day. The default is the
**block**, meaning the contiguous run of slots under the cursor, because almost
every correction covers a block of the day and overriding an hour should be one
click rather than four. Ticking writes `ASSIGN`, unticking writes `EXCLUDE`, and
"Back to automatic" deletes both — a real third state, since excluding somebody
is a decision the solver must keep honouring whereas clearing hands the window
back to it.

Settings and membership are **one sheet** (`QueueSettingsSheet.tsx`): the rules,
each queue's numbers, and each queue's membership behind an expander on its own
row, saved together. Setting a queue's minimum to three and checking whether
three people can take it is one thought.

## Routes & access

| Page key | Route | Admin | Manager | Director | CSR/Agent |
|----------|-------|-------|---------|----------|-----------|
| `sched_queues` | `/app/scheduling/queues` | EDIT | EDIT | ALL | — |

There is deliberately **no CSR grant**: no self-scoped "My Queue" view exists
yet, and an OWN viewer would land on a manager page with nothing scoped for
them. Add the grant together with that route, not before.

The queue **library** is admin-only (like campaign categories) and edited under
**Admin → List Management → Scheduling → Phone Queues**. A manager tunes their
own department's numbers and membership on the Phone Queues page.

API is mounted at `/api/scheduling/queues`, which must stay registered **before**
`/api/scheduling` in `backend/src/index.ts` or the scheduling router swallows it.
Handlers use `asyncHandler` + `AppError` per
[`.cursor/rules/backend-api-conventions.mdc`](../.cursor/rules/backend-api-conventions.mdc),
not the scheduling slice's legacy `respond.ts`. Dates cross the wire as
`YYYY-MM-DD` and times as `HH:MM`, never `Date` instants.

## Code map

| Concern | Location |
|---------|----------|
| Pure availability + interval math (unit-tested) | `backend/src/services/queues/queue.availability.ts` |
| Pure per-slot placement (unit-tested) | `backend/src/services/queues/queue.solve.slot.ts` |
| Loading for a date range, shared by day and week | `backend/src/services/queues/queue.solve.context.ts` |
| Day: the slot loop, continuity carry, warnings | `backend/src/services/queues/queue.solve.service.ts` |
| Week roll-up | `backend/src/services/queues/queue.solve.week.ts` |
| Library / department assignment / membership / policy / overrides | `backend/src/services/queues/queue.*.service.ts` |
| Department scope guards | `backend/src/services/queues/queue.permissions.ts` |
| Controllers / routes / validation | `backend/src/controllers/queues/*`, `backend/src/routes/phoneQueue.routes.ts`, `backend/src/validation/queue.validation.ts` |
| Frontend service + query keys | `frontend/src/services/phoneQueueService.ts`, `phoneQueueQueryKeys.ts` |
| Page + components | `frontend/src/pages/scheduling/QueueCoveragePage.tsx`, `frontend/src/components/scheduling/Queue*.tsx` |
| Library editor | `frontend/src/pages/admin/list-management/PhoneQueueListEditor.tsx` |
| Migration + 6 tables | `backend/prisma/migrations/20260828120000_add_phone_queues/migration.sql` |
| Override windows + `fill_strategy` | `backend/prisma/migrations/20260828163000_queue_slot_overrides/migration.sql` |

## Override windows

An override carries a window shaped exactly like a partial-day
`schedule_exception`: nullable `starts_at` / `ends_at` `DATETIME`, both null
meaning all day. Following that model rather than inventing `TIME` columns means
the existing `combineLocal` / `hmFromDateTime` helpers carry it and the API keeps
speaking `HH:MM`.

There is deliberately **no unique key** across the window columns. MySQL cannot
express "no two rows may overlap", and a key that merely included the start time
would happily accept two contradictory rows a minute apart. So writes
delete whatever they overlap and then insert — idempotent under a double-click,
and the natural way to extend or shrink an existing override. `schedule_exception`
answers the identical question the same way, and it is the same
delete-then-create shape as `campaign.override.service`.

## Known gaps

- **No editor for `phone_queue_window`.** The solver honours per-hour numbers and
  the settings sheet round-trips them untouched, but they can only be set
  through the API today.
- **No agent-facing "My Queue" view**, which is why there is no CSR grant.
- **Forward-looking PTO from Paychex is still unavailable.** That belongs to
  Scheduling (availability), not here — when it lands it flows in through
  `schedule_exception` and the solver picks it up with no change.
