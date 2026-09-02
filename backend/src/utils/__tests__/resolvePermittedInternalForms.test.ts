/**
 * Contract for `resolvePermittedInternalForms` — the audience gate for the
 * Internal Research section and the Internal submissions list.
 *
 * The security-critical property: editing a form's audience creates a NEW
 * version row and deactivates the old one, but the superseded row keeps its OLD
 * `access_roles`. The current audience must be read from the family's CURRENT
 * version only — otherwise a grant removed on the new version keeps leaking
 * through the stale row (the "removed access but they still see the data" bug).
 * Versions are grouped by the stable `form_group_id`, NOT by name (a form can be
 * renamed between versions). All version ids/names of a permitted family are
 * still returned, because submissions snapshot the form_id captured at creation.
 * Prisma is mocked so this runs with no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../config/prisma', () => ({
  default: { form: { findMany: vi.fn() } },
}))

import prisma from '../../config/prisma'
import { resolvePermittedInternalForms } from '../formScope'

const db = prisma as unknown as { form: { findMany: ReturnType<typeof vi.fn> } }

type Row = {
  id: number
  form_name: string
  version: number
  is_active: boolean
  form_group_id: number | null
  access_roles: unknown
}

function mockForms(rows: Row[]) {
  db.form.findMany.mockResolvedValue(rows)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolvePermittedInternalForms — group-aware audience', () => {
  it('honours the current version audience, ignoring a grant removed on the new version', async () => {
    // One family (group 309). v4 granted user:5 individually; v5 (current/active)
    // narrowed the audience to qa. The form was even renamed at v5.
    mockForms([
      { id: 312, form_name: 'Test Form', version: 4, is_active: false, form_group_id: 309, access_roles: ['user:5'] },
      { id: 313, form_name: 'Test Form v2', version: 5, is_active: true, form_group_id: 309, access_roles: ['qa'] },
    ])

    // The individually-granted user lost access on v5 → no longer permitted,
    // even though the stale v4 row still lists them.
    const removed = await resolvePermittedInternalForms('manager', 5)
    expect(removed.names).toEqual([])
    expect(removed.ids).toEqual([])

    // The current audience (qa) sees it — and gets EVERY version id + name
    // (including the pre-rename name) so older submissions remain matchable.
    const current = await resolvePermittedInternalForms('qa', 1)
    expect(current.ids.sort((a, b) => a - b)).toEqual([312, 313])
    expect(current.names.sort()).toEqual(['Test Form', 'Test Form v2'])
  })

  it('reads the audience from the highest version when none is active', async () => {
    mockForms([
      { id: 10, form_name: 'A', version: 1, is_active: false, form_group_id: 10, access_roles: ['manager'] },
      { id: 11, form_name: 'A', version: 2, is_active: false, form_group_id: 10, access_roles: ['qa'] },
    ])
    // Highest version (v2) governs → qa in, manager out.
    expect((await resolvePermittedInternalForms('qa', 1)).ids.sort((a, b) => a - b)).toEqual([10, 11])
    expect((await resolvePermittedInternalForms('manager', 1)).ids).toEqual([])
  })

  it('keeps distinct families separate', async () => {
    mockForms([
      { id: 1, form_name: 'A', version: 1, is_active: true, form_group_id: 1, access_roles: ['qa'] },
      { id: 2, form_name: 'B', version: 1, is_active: true, form_group_id: 2, access_roles: ['manager'] },
    ])
    const qa = await resolvePermittedInternalForms('qa', 1)
    expect(qa.ids).toEqual([1])
    expect(qa.names).toEqual(['A'])
  })

  it('admin sees every internal form across all families and versions', async () => {
    mockForms([
      { id: 1, form_name: 'A', version: 1, is_active: false, form_group_id: 1, access_roles: [] },
      { id: 2, form_name: 'A', version: 2, is_active: true, form_group_id: 1, access_roles: [] },
      { id: 3, form_name: 'B', version: 1, is_active: true, form_group_id: 3, access_roles: ['manager'] },
    ])
    const res = await resolvePermittedInternalForms('admin', 99)
    expect(res.ids.sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect(res.names.sort()).toEqual(['A', 'B'])
  })

  it('grants an individually-named user access even when their role is not in the audience', async () => {
    mockForms([
      { id: 20, form_name: 'Coaching', version: 1, is_active: true, form_group_id: 20, access_roles: ['user:42'] },
    ])
    expect((await resolvePermittedInternalForms('manager', 42)).ids).toEqual([20])
    expect((await resolvePermittedInternalForms('manager', 99)).ids).toEqual([])
  })

  it('falls back to the row id when form_group_id is null (pre-backfill rows)', async () => {
    mockForms([
      { id: 50, form_name: 'Legacy', version: 1, is_active: true, form_group_id: null, access_roles: ['qa'] },
    ])
    const res = await resolvePermittedInternalForms('qa', 1)
    expect(res.ids).toEqual([50])
  })

  it('returns nothing when no internal forms exist', async () => {
    mockForms([])
    const res = await resolvePermittedInternalForms('qa', 1)
    expect(res).toEqual({ ids: [], names: [] })
  })
})
