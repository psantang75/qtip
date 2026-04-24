/**
 * Barrel for the QA controller domain.
 *
 * Created during the pre-production review (item #29) when the old
 * `controllers/qa.controller.ts` (837 lines) was split into transport-only
 * modules sitting on top of `services/qa`. Routes import from this barrel
 * so future module reshapes don't ripple into `routes/qa.routes.ts`.
 */

export * from './submissions.controller'
export * from './dashboard.controller'
