/**
 * Barrel for the writeups controller domain.
 *
 * Single import surface used by `routes/writeup.routes.ts`. Sub-modules:
 *
 *   list.controller          - getWriteUps, getWriteUpById, getPriorDiscipline
 *   lifecycle.controller     - createWriteUp, updateWriteUp,
 *                              updateInternalNotes, updateFollowUpNotes,
 *                              transitionStatus, signWriteUp, setFollowUp
 *   search.controller        - searchQaRecords, searchCoachingSessions
 *   attachment.controller    - uploadAttachment, downloadAttachment, deleteAttachment
 *   linkedCoaching.controller - createLinkedCoachingSession
 *
 * Created during the pre-production review (item #29) when the old
 * `controllers/writeup.controller.ts` (915 lines) was split into
 * transport-only modules sitting on top of `services/writeups`.
 */

export * from './list.controller'
export * from './lifecycle.controller'
export * from './search.controller'
export * from './attachment.controller'
export * from './linkedCoaching.controller'
