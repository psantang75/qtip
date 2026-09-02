/**
 * Scope contract for the completed-submissions list (`listCompletedSubmissions`).
 *
 * The list backs both the normal Submissions surface (STANDARD scope) and the
 * Internal-form audits added for their permitted audience (INTERNAL scope). The
 * security-critical bit is fail-closed behaviour: an INTERNAL request with no
 * permitted forms must return nothing WITHOUT running a query (an empty id set
 * would otherwise emit `IN ()` / leak). Prisma is mocked so this runs with no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../config/prisma', () => ({
  default: { $queryRaw: vi.fn() },
}))

import prisma from '../../../config/prisma'
import { listCompletedSubmissions } from '../qa.submissions.list.service'

const db = prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listCompletedSubmissions — INTERNAL scope', () => {
  it('fails closed: no permitted forms returns empty WITHOUT querying', async () => {
    const result = await listCompletedSubmissions({
      page: 1,
      limit: 20,
      accessScope: 'INTERNAL',
      permittedInternalFormIds: [],
    })

    expect(result.data).toEqual([])
    expect(result.pagination).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 })
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })

  it('queries and maps Internal rows when the requester is permitted forms', async () => {
    db.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 2710,
          form_id: 312,
          access_mode: 'INTERNAL',
          form_name: 'Test Form',
          auditor_name: 'PG Admin',
          csr_name: 'No CSR assigned',
          submitted_at: new Date('2026-09-01T12:00:00Z'),
          total_score: 90,
          status: 'FINALIZED',
          critical_fail_count: 0,
          score_capped: 0,
          ai_overall_confidence: null,
          reopen_count: 0,
          unlock_open: '0',
          interaction_date: null,
        },
      ])
      .mockResolvedValueOnce([{ total: 1n }])

    const result = await listCompletedSubmissions({
      page: 1,
      limit: 20,
      accessScope: 'INTERNAL',
      permittedInternalFormIds: [312],
    })

    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
    expect(result.pagination.total).toBe(1)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ id: 2710, access_mode: 'INTERNAL', unlock_open: 0 })
  })
})

describe('listCompletedSubmissions — STANDARD scope', () => {
  it('runs the query for the default (normal) scope', async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0n }])

    const result = await listCompletedSubmissions({ page: 1, limit: 20 })

    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual([])
    expect(result.pagination.total).toBe(0)
  })
})
