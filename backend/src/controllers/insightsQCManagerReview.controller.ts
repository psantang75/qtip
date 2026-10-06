import type { Request } from 'express'
import type { InsightsAccessResult } from '../services/InsightsPermissionService'
import { qcHandler, parseFormNames, ForbiddenError } from './insightsQC.controller'
import * as managerReview from '../services/QCManagerReviewData'

export const MANAGER_REVIEW_PAGE_KEY = 'qc_manager_review'

// These answers are hidden from the reviewed agent by design. An agent must
// never read them, even if an admin grants the page to the CSR role or opens a
// SELF-scoped grant, so the rule is enforced here rather than left to ie_page.
export function assertManagementAccess(access: InsightsAccessResult, req: Request): void {
  if (access.dataScope === 'SELF' || req.user?.role === 'CSR') {
    throw new ForbiddenError('Manager review items are not available to agents')
  }
}

export const getManagerReviewSummary = qcHandler(MANAGER_REVIEW_PAGE_KEY, (deptFilter, ranges, req, access) => {
  assertManagementAccess(access, req)
  return managerReview.getHiddenQuestionSummary(deptFilter, parseFormNames(req), ranges)
})

export const getManagerReviewAnswers = qcHandler(MANAGER_REVIEW_PAGE_KEY, (deptFilter, ranges, req, access) => {
  assertManagementAccess(access, req)
  const onlyFlagged = req.query.all !== '1'
  return managerReview.getHiddenAnswers(deptFilter, parseFormNames(req), ranges, { onlyFlagged })
})
