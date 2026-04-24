/**
 * Barrel for the trainer service domain.
 *
 * Created during the pre-production review (item #29) when the
 * 792-line `controllers/trainer.controller.ts` and the 431-line
 * `services/TrainerService.ts` (mostly dead code) were split into
 * focused modules under this folder. Consumers should import from this
 * barrel rather than the underlying files so the internal layout can
 * keep evolving without churning controller imports.
 */

export * from './trainer.types'
export * from './trainer.reports.service'
export * from './trainer.dashboard.stats.service'
export * from './trainer.dashboard.csrActivity.service'
export * from './trainer.team.service'
export * from './trainer.training.stats.service'
export * from './trainer.health.service'
export * from './trainer.submissions.list.service'
export * from './trainer.submissions.detail.service'
