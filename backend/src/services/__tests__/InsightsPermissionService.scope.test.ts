/**
 * Scope-resolution tests for InsightsPermissionService.
 *
 * Inserts a small set of throwaway `ie_page` rows + role_access /
 * user_override mappings for the slice user (Marc, user 23 in dept 2) and
 * exercises every code path in `resolveAccess` / `resolveScope`.
 *
 * All fixture rows live under unique page_keys with the prefix
 * `__test_perm_` so cleanup is unambiguous and cannot collide with real
 * pages.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { InsightsPermissionService } from '../InsightsPermissionService'
import { getAncestorDepartmentKeys } from '../../utils/departmentHierarchy'
import pool, { closeDatabaseConnections } from '../../config/database'
import { RowDataPacket } from 'mysql2'
import { DB_TESTS_ENABLED } from '../../__tests__/setup'

const describeDb = describe.skipIf(!DB_TESTS_ENABLED)

const SVC = new InsightsPermissionService()

// Pick a user that exists in `ie_dim_employee` with `is_current = 1` so the
// SCD lookup in resolveScope() returns an employee_key + department_key.
// User 16 ("PG CSR" in the dim table) is a CSR with department_key = 2.
const TEST_USER = 16
const ROLE_CSR  = 3
const ROLE_ADMIN = 1
const GRANTED_BY = 1

const PAGE_KEYS = {
  noRole:    '__test_perm_no_role',
  roleAll:   '__test_perm_role_all',
  roleSelf:  '__test_perm_role_self',
  roleDept:  '__test_perm_role_dept',
  roleDiv:   '__test_perm_role_div',
  ovrDeny:   '__test_perm_ovr_deny',
  ovrAll:    '__test_perm_ovr_all',
  ovrExp:    '__test_perm_ovr_expired',
  // department-grant fixtures (additive access by department)
  deptOwn:    '__test_perm_dept_own',
  deptParent: '__test_perm_dept_parent',
  deptOther:  '__test_perm_dept_other',
  deptUnion:  '__test_perm_dept_union',
}

let pageIds: Record<string, number> = {}
let employeeKey: number | null = null
let departmentKey: number | null = null
let parentDeptKey: number | null = null
let otherDeptKey: number | null = null

async function insertPage(key: string): Promise<number> {
  await pool.query(
    `INSERT INTO ie_page (page_key, page_name, category, route_path, sort_order, is_active)
     VALUES (?, ?, 'TEST', '/test', 0, 1)`,
    [key, key]
  )
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM ie_page WHERE page_key = ?',
    [key]
  )
  return rows[0].id as number
}

beforeAll(async () => {
  if (!DB_TESTS_ENABLED) return
  // Idempotent cleanup of any orphaned fixtures from a prior aborted run.
  await pool.query(
    `DELETE FROM ie_page WHERE page_key LIKE '__test_perm_%'`
  )

  for (const [name, key] of Object.entries(PAGE_KEYS)) {
    pageIds[name] = await insertPage(key)
  }

  // Role grants (CSR = role 3) for the four scope variants.
  const roleSeeds: Array<[number, 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF']> = [
    [pageIds.roleAll,  'ALL'],
    [pageIds.roleDiv,  'DIVISION'],
    [pageIds.roleDept, 'DEPARTMENT'],
    [pageIds.roleSelf, 'SELF'],
  ]
  for (const [pageId, scope] of roleSeeds) {
    await pool.query(
      `INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope) VALUES (?, ?, 1, ?)`,
      [pageId, ROLE_CSR, scope]
    )
  }

  // Override #1: explicit deny for an otherwise-granted page.
  await pool.query(
    `INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope) VALUES (?, ?, 1, 'SELF')`,
    [pageIds.ovrDeny, ROLE_CSR]
  )
  await pool.query(
    `INSERT INTO ie_page_user_override (page_id, user_id, can_access, data_scope, granted_by, reason)
     VALUES (?, ?, 0, 'SELF', ?, 'test deny override')`,
    [pageIds.ovrDeny, TEST_USER, GRANTED_BY]
  )

  // Override #2: lift a CSR (default deny) to ALL via per-user override.
  await pool.query(
    `INSERT INTO ie_page_user_override (page_id, user_id, can_access, data_scope, granted_by, reason)
     VALUES (?, ?, 1, 'ALL', ?, 'test grant override')`,
    [pageIds.ovrAll, TEST_USER, GRANTED_BY]
  )

  // Override #3: expired override should be ignored entirely.
  await pool.query(
    `INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope) VALUES (?, ?, 1, 'SELF')`,
    [pageIds.ovrExp, ROLE_CSR]
  )
  await pool.query(
    `INSERT INTO ie_page_user_override (page_id, user_id, can_access, data_scope, granted_by, expires_at, reason)
     VALUES (?, ?, 0, 'SELF', ?, '2020-01-01 00:00:00', 'expired')`,
    [pageIds.ovrExp, TEST_USER, GRANTED_BY]
  )

  // Capture the user's employee/department keys for assertion.
  const [emp] = await pool.execute<RowDataPacket[]>(
    'SELECT employee_key, department_key FROM ie_dim_employee WHERE user_id = ? AND is_current = 1',
    [TEST_USER]
  )
  if (emp.length > 0) {
    employeeKey = emp[0].employee_key as number
    departmentKey = (emp[0].department_key as number | null) ?? null
  }

  // ── Department-grant fixtures ──────────────────────────────────────────────
  // Resolve the user's ancestor-inclusive department set to pick:
  //   parentDeptKey — an ancestor of the user's dept (grant here must cascade)
  //   otherDeptKey  — a current dept NOT in the chain (grant here must NOT apply)
  if (departmentKey != null) {
    const ancSet = new Set(await getAncestorDepartmentKeys(departmentKey))
    parentDeptKey = [...ancSet].find(k => k !== departmentKey) ?? null

    const [allDepts] = await pool.execute<RowDataPacket[]>(
      'SELECT department_key FROM ie_dim_department WHERE is_current = 1'
    )
    otherDeptKey = (allDepts
      .map(d => d.department_key as number)
      .find(k => !ancSet.has(k))) ?? null

    // Grant on the user's OWN department, DEPARTMENT scope, no role grant.
    await pool.query(
      `INSERT INTO ie_page_department_access (page_id, department_key, can_access, data_scope) VALUES (?, ?, 1, 'DEPARTMENT')`,
      [pageIds.deptOwn, departmentKey]
    )

    // Union case: CSR role grant SELF + own-dept grant ALL → broadest = ALL.
    await pool.query(
      `INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope) VALUES (?, ?, 1, 'SELF')`,
      [pageIds.deptUnion, ROLE_CSR]
    )
    await pool.query(
      `INSERT INTO ie_page_department_access (page_id, department_key, can_access, data_scope) VALUES (?, ?, 1, 'ALL')`,
      [pageIds.deptUnion, departmentKey]
    )

    // Grant on an ANCESTOR department, ALL scope — must cascade to the child.
    if (parentDeptKey != null) {
      await pool.query(
        `INSERT INTO ie_page_department_access (page_id, department_key, can_access, data_scope) VALUES (?, ?, 1, 'ALL')`,
        [pageIds.deptParent, parentDeptKey]
      )
    }

    // Grant on an UNRELATED department — must NOT grant access to this user.
    if (otherDeptKey != null) {
      await pool.query(
        `INSERT INTO ie_page_department_access (page_id, department_key, can_access, data_scope) VALUES (?, ?, 1, 'ALL')`,
        [pageIds.deptOther, otherDeptKey]
      )
    }
  }
})

afterAll(async () => {
  if (!DB_TESTS_ENABLED) return
  await pool.query(
    `DELETE FROM ie_page WHERE page_key LIKE '__test_perm_%'`
  )
  await closeDatabaseConnections()
})

describeDb('InsightsPermissionService — resolveAccess', () => {
  it('returns NO_ACCESS for an unknown page key', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, 'this_page_does_not_exist_xyz')
    expect(result.canAccess).toBe(false)
    expect(result.dataScope).toBeNull()
    expect(result.pageId).toBeNull()
  })

  it('returns NO_ACCESS (with pageId) for a real page that has no role grant', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.noRole)
    expect(result.canAccess).toBe(false)
    expect(result.dataScope).toBeNull()
    expect(result.pageId).toBe(pageIds.noRole)
  })

  it('role grant ALL: empty departmentKeys, employeeKey null', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.roleAll)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('ALL')
    expect(result.departmentKeys).toEqual([])
    expect(result.employeeKey).toBeNull()
  })

  it('role grant SELF: employeeKey = user\'s own employee_key', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.roleSelf)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('SELF')
    expect(result.departmentKeys).toEqual([])
    expect(result.employeeKey).toBe(employeeKey)
    expect(result.employeeKey).not.toBeNull()
  })

  it('role grant DEPARTMENT: returns user\'s own department_key', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.roleDept)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('DEPARTMENT')
    expect(result.employeeKey).toBeNull()
    if (departmentKey != null) {
      expect(result.departmentKeys).toEqual([departmentKey])
    } else {
      expect(result.departmentKeys).toEqual([])
    }
  })

  it('role grant DIVISION: includes the user\'s own dept and all descendants', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.roleDiv)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('DIVISION')
    expect(result.employeeKey).toBeNull()
    if (departmentKey != null) {
      expect(result.departmentKeys).toContain(departmentKey)
    }
  })

  it('user override DENY beats a role grant', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.ovrDeny)
    expect(result.canAccess).toBe(false)
    expect(result.dataScope).toBeNull()
    expect(result.pageId).toBe(pageIds.ovrDeny)
  })

  it('user override GRANT lifts a default-deny page to ALL', async () => {
    // Use ROLE_ADMIN here to confirm the override is independent of the role
    // grant — role 1 has no row for this page, but the override carries
    // both can_access AND data_scope, so resolveAccess must succeed.
    const result = await SVC.resolveAccess(TEST_USER, ROLE_ADMIN, PAGE_KEYS.ovrAll)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('ALL')
    expect(result.departmentKeys).toEqual([])
  })

  it('expired user override is ignored — falls back to the role grant', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.ovrExp)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('SELF')
    expect(result.employeeKey).toBe(employeeKey)
  })
})

describeDb('InsightsPermissionService — department grants (additive)', () => {
  it('department grant on the user\'s own department allows access', async () => {
    if (departmentKey == null) return
    // No role grant exists for this page; access comes purely from the dept grant.
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.deptOwn)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('DEPARTMENT')
    expect(result.departmentKeys).toEqual([departmentKey])
  })

  it('parent-department grant cascades down to a child department', async () => {
    if (parentDeptKey == null) return
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.deptParent)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('ALL')
  })

  it('department grant outside the user\'s chain does NOT grant access', async () => {
    if (otherDeptKey == null) return
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.deptOther)
    expect(result.canAccess).toBe(false)
    expect(result.dataScope).toBeNull()
    expect(result.pageId).toBe(pageIds.deptOther)
  })

  it('role + department grant resolves to the broadest scope (ALL > SELF)', async () => {
    if (departmentKey == null) return
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.deptUnion)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('ALL')
  })

  it('no-regression: a page with no department grants behaves exactly as before', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.roleSelf)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('SELF')
    expect(result.employeeKey).toBe(employeeKey)
  })
})

describeDb('InsightsPermissionService — resolveAccessForAllPages (batch, dept grants)', () => {
  it('honors role+dept union, parent inheritance, and chain exclusion in one pass', async () => {
    const all = await SVC.resolveAccessForAllPages(TEST_USER, ROLE_CSR)

    if (departmentKey != null) {
      const own = all.get(PAGE_KEYS.deptOwn)!
      expect(own.canAccess).toBe(true)
      expect(own.dataScope).toBe('DEPARTMENT')

      const union = all.get(PAGE_KEYS.deptUnion)!
      expect(union.canAccess).toBe(true)
      expect(union.dataScope).toBe('ALL')
    }

    if (parentDeptKey != null) {
      const parent = all.get(PAGE_KEYS.deptParent)!
      expect(parent.canAccess).toBe(true)
      expect(parent.dataScope).toBe('ALL')
    }

    if (otherDeptKey != null) {
      const other = all.get(PAGE_KEYS.deptOther)!
      expect(other.canAccess).toBe(false)
      expect(other.dataScope).toBeNull()
    }

    // No-regression: a plain role-SELF page still resolves identically.
    const roleSelf = all.get(PAGE_KEYS.roleSelf)!
    expect(roleSelf.canAccess).toBe(true)
    expect(roleSelf.dataScope).toBe('SELF')
  })
})
