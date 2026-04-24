/**
 * Trainer reports transport.
 *
 * Handlers for `GET /api/trainer/filters` and `POST /api/trainer/reports`.
 * Pure transport — body parsing + delegation to the service. The legacy
 * `/export/:report_id` and `/export/current` endpoints are intentionally
 * absent (removed in pre-production review item #24 — they returned
 * placeholder data).
 */

import { Request, Response } from 'express'
import {
  getFilterOptions  as svcGetFilterOptions,
  generateReport    as svcGenerateReport,
  type ReportFilters,
} from '../../services/trainer'

export const getFilterOptions = async (_req: Request, res: Response): Promise<void> => {
  try {
    const options = await svcGetFilterOptions()
    res.json(options)
  } catch (error) {
    console.error('Error fetching filter options:', error)
    res.status(500).json({ error: 'Failed to fetch filter options' })
  }
}

export const generateReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = req.body as ReportFilters
    const report  = await svcGenerateReport(filters)
    res.json(report)
  } catch (error) {
    console.error('Error generating report:', error)
    res.status(500).json({ error: 'Failed to generate report' })
  }
}
