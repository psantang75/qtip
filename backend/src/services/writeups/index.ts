/**
 * Barrel for the writeups service domain.
 *
 * Single import surface for the controllers and (future) cross-domain
 * callers. Sub-modules:
 *
 *   writeup.types               - shared interfaces + WriteUpServiceError
 *   writeup.permissions         - canSeeAll, ALLOWED_TRANSITIONS, guards
 *   writeup.helpers             - splitSep, toIntArray, insertIncidents,
 *                                 replaceWriteUpListItems, shapePriorDiscipline
 *   writeup.list.service        - listWriteUps, getWriteUpDetail, getPriorDiscipline
 *   writeup.lifecycle.service   - createWriteUp, updateWriteUp,
 *                                 updateInternalNotes, updateFollowUpNotes
 *   writeup.transition.service  - transitionStatus, signWriteUp, setFollowUp
 *   writeup.search.service      - searchQaRecords, searchCoachingSessions
 *   writeup.attachment.service  - createAttachment, resolveAttachmentForDownload,
 *                                 deleteAttachment
 *   writeup.linkedCoaching      - createLinkedCoachingSession
 *
 * Created during the pre-production review (item #29) when
 * `controllers/writeup.controller.ts` (915 lines) and
 * `services/writeup.service.ts` (97 lines, inverted) were split into a
 * proper transport / domain / data layout under the strict 300-line cap.
 */

export * from './writeup.types'
export * from './writeup.permissions'
export * from './writeup.helpers'
export * from './writeup.list.service'
export * from './writeup.lifecycle.service'
export * from './writeup.transition.service'
export * from './writeup.search.service'
export * from './writeup.attachment.service'
export * from './writeup.linkedCoaching.service'
