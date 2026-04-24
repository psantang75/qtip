/**
 * Barrel for the trainer transport layer.
 *
 * Created during the pre-production review (item #29) when the
 * 792-line `controllers/trainer.controller.ts` was split into focused
 * files. `routes/trainer.routes.ts` imports from this barrel so the
 * internal layout can change without touching the router.
 */

export * from './reports.controller'
export * from './dashboard.controller'
export * from './health.controller'
export * from './submissions.controller'
