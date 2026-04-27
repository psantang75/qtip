/**
 * Barrel for the CSR controller domain.
 *
 * Single import surface used by `routes/csr.routes.ts` and
 * `routes/quiz.routes.ts`. Sub-modules:
 *
 *   dashboard.controller - getCSRStats, getCSRDashboardStats, getCSRActivity
 *   audit.controller     - getCSRAudits, getCSRAuditDetails,
 *                          isAuditDisputable, finalizeSubmission
 *   coaching.controller  - submitQuizAnswers, getCSRCoachingSessions,
 *                          getCSRCoachingSessionDetails,
 *                          downloadCSRCoachingAttachment, getCSRResourceFile,
 *                          submitCSRResponse
 *
 * Created during the pre-production review (item #69) when the three
 * top-level CSR controllers (`csrDashboard.controller.ts`,
 * `csrAudit.controller.ts`, and `csr.controller.ts`) were collapsed into
 * one folder so the CSR role's transport surface lives in one place.
 */

export * from './dashboard.controller'
export * from './audit.controller'
export * from './coaching.controller'
