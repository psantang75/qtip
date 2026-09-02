/**
 * Contract for `canAccessInternalFormCurrent` — the DB-backed audience gate used
 * on read paths that may hold a superseded form version (e.g. loading a form
 * definition by an older id). It must always evaluate the form family's CURRENT
 * governance (active version, else highest version), so a grant removed on a
 * newer version is honoured even when an OLD version row is the one in hand.
 * Prisma is mocked so this runs with no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../config/prisma', () => ({
  default: { form: { findFirst: vi.fn() } },
}))

import prisma from '../../config/prisma'
import { canAccessInternalFormCurrent, INTERNAL_MODE } from '../formScope'

const db = prisma as unknown as { form: { findFirst: ReturnType<typeof vi.fn> } }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('canAccessInternalFormCurrent', () => {
  it('always allows normal (non-internal) forms without a query', async () => {
    const ok = await canAccessInternalFormCurrent('csr', { access_mode: null })
    expect(ok).toBe(true)
    expect(db.form.findFirst).not.toHaveBeenCalled()
  })

  it('admin passes without a query', async () => {
    const ok = await canAccessInternalFormCurrent('admin', { access_mode: INTERNAL_MODE, form_group_id: 309 })
    expect(ok).toBe(true)
    expect(db.form.findFirst).not.toHaveBeenCalled()
  })

  it('denies a user removed on the current version even when handed the OLD version row', async () => {
    // Handed the stale v4 row (granted user:5) but the family's current version
    // (looked up by group) narrowed the audience to qa.
    db.form.findFirst.mockResolvedValue({ access_mode: INTERNAL_MODE, access_roles: ['qa'] })
    const staleRow = { access_mode: INTERNAL_MODE, access_roles: ['user:5'], form_group_id: 309, id: 312 }

    expect(await canAccessInternalFormCurrent('manager', staleRow, 5)).toBe(false)
    // The qa audience (current) is granted.
    expect(await canAccessInternalFormCurrent('qa', staleRow, 1)).toBe(true)
    // Lookup is keyed on the family group, newest-first.
    expect(db.form.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { form_group_id: 309 },
        orderBy: [{ is_active: 'desc' }, { version: 'desc' }],
      }),
    )
  })

  it('grants an individually-named user per the current version', async () => {
    db.form.findFirst.mockResolvedValue({ access_mode: INTERNAL_MODE, access_roles: ['user:42'] })
    const row = { access_mode: INTERNAL_MODE, access_roles: [], form_group_id: 20, id: 21 }
    expect(await canAccessInternalFormCurrent('manager', row, 42)).toBe(true)
    expect(await canAccessInternalFormCurrent('manager', row, 99)).toBe(false)
  })

  it('locks down (admin-only) when the family is no longer internal', async () => {
    db.form.findFirst.mockResolvedValue({ access_mode: null, access_roles: null })
    const row = { access_mode: INTERNAL_MODE, access_roles: ['qa'], form_group_id: 5, id: 6 }
    expect(await canAccessInternalFormCurrent('qa', row, 1)).toBe(false)
  })

  it('falls back to the handed row when it has no family key (pre-backfill)', async () => {
    const row = { access_mode: INTERNAL_MODE, access_roles: ['qa'] }
    expect(await canAccessInternalFormCurrent('qa', row, 1)).toBe(true)
    expect(db.form.findFirst).not.toHaveBeenCalled()
  })
})
