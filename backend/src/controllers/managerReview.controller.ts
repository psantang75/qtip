import type { Request, Response } from 'express'
import { asyncHandler } from '../utils/errorHandler'
import { resolvePeriod, type PeriodRanges } from '../utils/periodUtils'
import { resolveRequestedDepts } from '../services/insightsScope'
import { parseFormNames } from './insightsQC.controller'
import { getFilterOptions } from '../services/QCQualityData'
import * as managerReview from '../services/QCManagerReviewData'

// Quality > Manager Review Items. Reachability is gated by
// authorizePage('quality_manager_review', 'viewAll') at the router; CSRs are
// capped at OWN by AppPermissionService, so they can never pass that gate.

function periodRanges(req: Request): PeriodRanges {
  return resolvePeriod(
    (req.query.period as string) || 'current_month',
    req.query.start as string | undefined,
    req.query.end as string | undefined,
  )
}

const deptFilter = (req: Request) => resolveRequestedDepts(req.query.departments as string | undefined)

export const getManagerReviewFilterOptions = asyncHandler(async (req: Request, res: Response) => {
  res.json(await getFilterOptions(await deptFilter(req), parseFormNames(req), periodRanges(req)))
})

export const getManagerReviewSummary = asyncHandler(async (req: Request, res: Response) => {
  res.json(await managerReview.getHiddenQuestionSummary(await deptFilter(req), parseFormNames(req), periodRanges(req)))
})

export const getManagerReviewAnswers = asyncHandler(async (req: Request, res: Response) => {
  const onlyFlagged = req.query.all !== '1'
  res.json(await managerReview.getHiddenAnswers(await deptFilter(req), parseFormNames(req), periodRanges(req), { onlyFlagged }))
})
