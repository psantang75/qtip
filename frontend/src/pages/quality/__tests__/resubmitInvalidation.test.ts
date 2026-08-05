/**
 * Pins the cache invalidation that runs after a reopened review is
 * re-submitted (AuditFormPage's `prefillMode === 'resume'` branch).
 *
 * This is worth a test because the failure is silent. SubmissionDetailPage
 * keys on the route param, which is a string, while AuditFormPage holds the
 * id as a number. Invalidating with the number matches nothing, TanStack
 * Query reports no error, and the detail page re-serves its five-minute-fresh
 * payload — so a correction that succeeded on the server shows the old score,
 * the old answers and an unlock banner that no longer applies. That looked
 * like the review had never left draft.
 *
 * No DOM runner is needed: QueryClient's key matching is plain JS.
 */

import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const ROLE_ID = 4
const SUBMISSION_ID = 1356

/** Mirrors SubmissionDetailPage: `id` comes from useParams, so it's a string. */
function seedDetailCache(qc: QueryClient) {
  qc.setQueryData(['submission-detail', String(SUBMISSION_ID), ROLE_ID], { score: 87.47 })
}

describe('post-resubmit invalidation of the submission detail cache', () => {
  it('marks the detail query stale when the id is stringified', () => {
    const qc = new QueryClient()
    seedDetailCache(qc)

    qc.invalidateQueries({ queryKey: ['submission-detail', String(SUBMISSION_ID)] })

    const [entry] = qc.getQueryCache().findAll({ queryKey: ['submission-detail'] })
    expect(entry.isStale()).toBe(true)
  })

  it('leaves the detail query fresh when the raw number is used, which is the bug', () => {
    const qc = new QueryClient()
    seedDetailCache(qc)

    qc.invalidateQueries({ queryKey: ['submission-detail', SUBMISSION_ID] })

    const [entry] = qc.getQueryCache().findAll({ queryKey: ['submission-detail'] })
    expect(entry.isStale()).toBe(false)
  })

  it('reaches the detail query for every role, since roleId is not in the key', () => {
    const qc = new QueryClient()
    qc.setQueryData(['submission-detail', String(SUBMISSION_ID), 1], { score: 87.47 })
    qc.setQueryData(['submission-detail', String(SUBMISSION_ID), 6], { score: 87.47 })

    qc.invalidateQueries({ queryKey: ['submission-detail', String(SUBMISSION_ID)] })

    const entries = qc.getQueryCache().findAll({ queryKey: ['submission-detail'] })
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.isStale())).toBe(true)
  })

  it('does not disturb a different submission', () => {
    const qc = new QueryClient()
    seedDetailCache(qc)
    qc.setQueryData(['submission-detail', '1359', ROLE_ID], { score: 100 })

    qc.invalidateQueries({ queryKey: ['submission-detail', String(SUBMISSION_ID)] })

    const other = qc.getQueryCache().find({ queryKey: ['submission-detail', '1359', ROLE_ID] })
    expect(other?.isStale()).toBe(false)
  })

  it('marks the resume banner unlock query stale, which uses a numeric id', () => {
    const qc = new QueryClient()
    qc.setQueryData(['submission-active-unlock', SUBMISSION_ID], { state: 'OPEN' })

    qc.invalidateQueries({ queryKey: ['submission-active-unlock', SUBMISSION_ID] })

    const entry = qc.getQueryCache().find({ queryKey: ['submission-active-unlock', SUBMISSION_ID] })
    expect(entry?.isStale()).toBe(true)
  })
})
