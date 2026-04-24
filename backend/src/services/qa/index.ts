/**
 * Barrel for the QA service domain.
 *
 * Created during the pre-production review (item #29) when
 * `controllers/qa.controller.ts` (837 lines) was split into per-handler
 * services. Re-exports each module so consumers (`controllers/qa/*`) hold
 * one import surface and the file layout can evolve without rewiring call
 * sites.
 */

export * from './qa.types'
export * from './qa.submissions.list.service'
export * from './qa.submissions.detail.service'
export * from './qa.submissions.export.service'
export * from './qa.submissions.finalize.service'
export * from './qa.dashboard.service'
