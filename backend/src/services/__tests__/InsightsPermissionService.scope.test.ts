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
// User 32 (Sales Team - Inbound, department_key = 7) sits in a CHILD department
// whose parent is "Sales Department - All" (key 6) — this lets the gate tests
// exercise the ancestor cascade (a grant on the parent must reach the child).
const TEST_USER = 32
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
  // department-gate fixtures (funnel: dept gate -> role scope)
  gateOwnRole:   '__test_perm_gate_own_role',    // gate own dept + role SELF   -> access SELF
  gateOwnNoRole: '__test_perm_gate_own_norole',  // gate own dept + no role     -> deny
  gateOutside:   '__test_perm_gate_outside',      // gate other dept + role SELF -> deny (gate closed)
  gateParent:    '__test_perm_gate_parent',       // gate ancestor dept + role   -> access (cascade)
  gateAdmin:     '__test_perm_gate_admin',        // gate other dept, Admin query -> access (bypass)
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

  // ── Department-gate fixtures (funnel semantics) ────────────────────────────
  // Resolve the user's ancestor-inclusive department set to pick:
  //   parentDeptKey — an ancestor of the user's dept (a gate here must cascade)
  //   otherDeptKey  — a current dept NOT in the chain (a gate here must block)
  if (departmentKey != null) {
    const ancSet = new Set(await getAncestorDepartmentKeys(departmentKey))
    parentDeptKey = [...ancSet].find(k => k !== departmentKey) ?? null

    const [allDepts] = await pool.execute<RowDataPacket[]>(
      'SELECT department_key FROM ie_dim_department WHERE is_current = 1'
    )
    otherDeptKey = (allDepts
      .map(d => d.department_key as number)
      .find(k => !ancSet.has(k))) ?? null

    // Gate on OWN dept + role SELF → passes the gate; scope comes from the role.
    await pool.query(
      `INSERT INTO ie_page_department_access (page_id, department_key, can_access, data_scope) VALUES (?, ?, 1, 'DEPARTMENT')`,
      [pageIds.gateOwnRole, departmentKey]
    )
    await pool.query(
      `INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope) VALUES (?, ?, 1, 'SELF')`,
      [pageIds.gateOwnRole, ROLE_CSR]
    )

    // Gate on OWN dept + NO role grant → gate passes but the role layer denies.
    await pool.query(
      `INSERT INTO ie_page_department_access (page_id, department_key, can_access, data_scope) VALUES (?, ?, 1, 'DEPARTMENT')`,
      [pageIds.gateOwnNoRole, departmentKey]
    )

    // Gate on an ANCESTOR dept + role SELF → the cascade passes the gate.
    if (parentDeptKey != null) {
      await pool.query(
        `INSERT INTO ie_page_department_access (page_id, department_key, can_access, data_scope) VALUES (?, ?, 1, 'DEPARTMENT')`,
        [pageIds.gateParent, parentDeptKey]
      )
      await pool.query(
        `INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope) VALUES (?, ?, 1, 'SELF')`,
        [pageIds.gateParent, ROLE_CSR]
      )
    }

    if (otherDeptKey != null) {
      // Gate on an UNRELATED dept + role SELF → gate closed; the role grant
      // cannot rescue a user outside the allowed department.
      await pool.query(
        `INSERT INTO ie_page_department_access (page_id, department_key, can_access, data_scope) VALUES (?, ?, 1, 'DEPARTMENT')`,
        [pageIds.gateOutside, otherDeptKey]
      )
      await pool.query(
        `INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope) VALUES (?, ?, 1, 'SELF')`,
        [pageIds.gateOutside, ROLE_CSR]
      )

      // Same closed gate, no role grant — Admin (role 1) bypasses it entirely.
      await pool.query(
        `INSERT INTO ie_page_department_access (page_id, department_key, can_access, data_scope) VALUES (?, ?, 1, 'DEPARTMENT')`,
        [pageIds.gateAdmin, otherDeptKey]
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

describeDb('InsightsPermissionService — department gate (funnel)', () => {
  it('gate on own dept + role grant: passes the gate, scope from the role', async () => {
    if (departmentKey == null) return
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.gateOwnRole)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('SELF')
    expect(result.employeeKey).toBe(employeeKey)
  })

  it('gate on own dept but NO role grant: denied (passing the gate is not enough)', async () => {
    if (departmentKey == null) return
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.gateOwnNoRole)
    expect(result.canAccess).toBe(false)
    expect(result.dataScope).toBeNull()
    expect(result.pageId).toBe(pageIds.gateOwnNoRole)
  })

  it('gate on a parent department cascades down to the child + role scope', async () => {
    if (parentDeptKey == null) return
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.gateParent)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('SELF')
  })

  it('gate on an outside department blocks a user even WITH a role grant', async () => {
    if (otherDeptKey == null) return
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.gateOutside)
    expect(result.canAccess).toBe(false)
    expect(result.dataScope).toBeNull()
    expect(result.pageId).toBe(pageIds.gateOutside)
  })

  it('Admin bypasses a closed department gate (defaults to ALL with no admin role grant)', async () => {
    if (otherDeptKey == null) return
    const result = await SVC.resolveAccess(TEST_USER, ROLE_ADMIN, PAGE_KEYS.gateAdmin)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('ALL')
  })

  it('no-regression: a page with no department grants stays role-only (gate open)', async () => {
    const result = await SVC.resolveAccess(TEST_USER, ROLE_CSR, PAGE_KEYS.roleSelf)
    expect(result.canAccess).toBe(true)
    expect(result.dataScope).toBe('SELF')
    expect(result.employeeKey).toBe(employeeKey)
  })
})

describeDb('InsightsPermissionService — resolveAccessForAllPages (batch, funnel)', () => {
  it('applies gate pass, gate-without-role, cascade, and outside-block in one pass', async () => {
    const all = await SVC.resolveAccessForAllPages(TEST_USER, ROLE_CSR)

    if (departmentKey != null) {
      const ownRole = all.get(PAGE_KEYS.gateOwnRole)!
      expect(ownRole.canAccess).toBe(true)
      expect(ownRole.dataScope).toBe('SELF')

      const ownNoRole = all.get(PAGE_KEYS.gateOwnNoRole)!
      expect(ownNoRole.canAccess).toBe(false)
      expect(ownNoRole.dataScope).toBeNull()
    }

    if (parentDeptKey != null) {
      const parent = all.get(PAGE_KEYS.gateParent)!
      expect(parent.canAccess).toBe(true)
      expect(parent.dataScope).toBe('SELF')
    }

    if (otherDeptKey != null) {
      const outside = all.get(PAGE_KEYS.gateOutside)!
      expect(outside.canAccess).toBe(false)
      expect(outside.dataScope).toBeNull()
    }

    // No-regression: a plain role-SELF page still resolves identically.
    const roleSelf = all.get(PAGE_KEYS.roleSelf)!
    expect(roleSelf.canAccess).toBe(true)
    expect(roleSelf.dataScope).toBe('SELF')
  })

  it('Admin sees an outside-gated page via bypass in the batch path', async () => {
    if (otherDeptKey == null) return
    const all = await SVC.resolveAccessForAllPages(TEST_USER, ROLE_ADMIN)
    const adminGate = all.get(PAGE_KEYS.gateAdmin)!
    expect(adminGate.canAccess).toBe(true)
    expect(adminGate.dataScope).toBe('ALL')
  })
})
