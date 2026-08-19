import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma';
import {
  asyncHandler,
  createValidationError,
  createNotFoundError,
  createAuthorizationError,
} from '../utils/errorHandler';
import { qcCacheClear } from '../middleware/qcCache';

/**
 * Insights Admin Page-access controller — CRUD over the `ie_page` access model
 * (`ie_page_role_access`, `ie_page_department_access`, `ie_page_user_override`)
 * that gates the Insights dashboards (`/api/insights/admin/pages/*`).
 *
 * Data access: Prisma only. Migrated off the legacy `mysql2` pool as part of
 * the "one data-access layer" cleanup, mirroring `insightsAdminKpi.controller.ts`.
 * Response shapes are preserved exactly for the frontend `insightsService.ts`
 * types (`IePage` with flattened `role_access[].role_name`,
 * `department_access[].{department_name,hierarchy_path}`, and
 * `IePageUserOverride.{user_name,granter_name}`). One intentional improvement:
 * `can_access` is now a real boolean (Prisma) rather than the raw `0/1` the
 * pool returned — this matches the declared TS type. Errors use the canonical
 * `AppError` envelope rendered by the global handler (see `utils/errorHandler.ts`).
 */

const VALID_DATA_SCOPES = ['ALL', 'DIVISION', 'DEPARTMENT', 'SELF'] as const;

const pageAccessRoleSchema = z.object({
  role_id: z.number().int().positive(),
  can_access: z.boolean(),
  data_scope: z.enum(VALID_DATA_SCOPES).default('SELF'),
});

const updatePageAccessBodySchema = z.object({
  roles: z.array(pageAccessRoleSchema).min(1),
});

const createOverrideSchema = z.object({
  user_id: z.number().int().positive(),
  can_access: z.boolean(),
  data_scope: z.enum(VALID_DATA_SCOPES).nullish(),
  expires_at: z.string().nullish(),
  reason: z.string().nullish(),
});

const pageAccessDepartmentSchema = z.object({
  department_key: z.number().int().positive(),
  can_access: z.boolean(),
  data_scope: z.enum(VALID_DATA_SCOPES).default('DEPARTMENT'),
});

// Empty array is valid — it clears all department grants for the page.
const updatePageDepartmentAccessBodySchema = z.object({
  departments: z.array(pageAccessDepartmentSchema),
});

function parseId(raw: string, label: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id)) throw createValidationError(`Invalid ${label}`);
  return id;
}

/**
 * GET /api/insights/admin/pages
 */
export const listPages = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const pages = await prisma.iePage.findMany({
    orderBy: [{ category: 'asc' }, { sort_order: 'asc' }],
    include: {
      role_access: {
        orderBy: { role_id: 'asc' },
        include: { role: { select: { role_name: true } } },
      },
      department_access: {
        include: { department: { select: { department_name: true, hierarchy_path: true } } },
      },
    },
  });

  res.json(
    pages.map((p) => {
      const { role_access, department_access, ...page } = p;
      return {
        ...page,
        role_access: role_access.map(({ role, ...a }) => ({ ...a, role_name: role.role_name })),
        department_access: department_access
          .map(({ department, ...da }) => ({
            ...da,
            department_name: department.department_name,
            hierarchy_path: department.hierarchy_path,
          }))
          // Match the legacy ORDER BY d.department_name.
          .sort((x, y) => x.department_name.localeCompare(y.department_name)),
      };
    }),
  );
});

/**
 * PUT /api/insights/admin/pages/:id/access
 * Body: { roles: [{ role_id, can_access, data_scope }] }
 */
export const updatePageAccess = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const pageId = parseId(req.params.id, 'page id');
  const { roles } = updatePageAccessBodySchema.parse(req.body);

  // Replace-set the page's role grants atomically.
  await prisma.$transaction([
    prisma.iePageRoleAccess.deleteMany({ where: { page_id: pageId } }),
    prisma.iePageRoleAccess.createMany({
      data: roles.map((r) => ({
        page_id: pageId,
        role_id: r.role_id,
        can_access: r.can_access,
        data_scope: r.data_scope,
      })),
    }),
  ]);

  // Invalidate the QC HTTP response cache so the new grants take effect
  // immediately — without this, a freshly added user with `qc_coaching`
  // would keep getting 403s from `/api/insights/qc/kpis` until the cache
  // entry expired. See `middleware/qcCache.ts`.
  qcCacheClear();

  res.json({ success: true });
});

/**
 * PUT /api/insights/admin/pages/:id/department-access
 * Body: { departments: [{ department_key, can_access, data_scope }] }
 *
 * Replace-set of the page's department grants, mirroring updatePageAccess.
 * Additive to role access: a user can open the page if their role grant OR any
 * matching department grant (their dept or an ancestor) allows it.
 */
export const updatePageDepartmentAccess = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const pageId = parseId(req.params.id, 'page id');
  const { departments } = updatePageDepartmentAccessBodySchema.parse(req.body);

  // Replace-set atomically. An empty `departments` array clears all grants, so
  // only issue the createMany when there is something to insert.
  await prisma.$transaction([
    prisma.iePageDepartmentAccess.deleteMany({ where: { page_id: pageId } }),
    ...(departments.length
      ? [
          prisma.iePageDepartmentAccess.createMany({
            data: departments.map((d) => ({
              page_id: pageId,
              department_key: d.department_key,
              can_access: d.can_access,
              data_scope: d.data_scope,
            })),
          }),
        ]
      : []),
  ]);

  // Department grants are now the access gate (opt-in), so a change here can
  // flip who reaches a page. Invalidate the QC HTTP response cache — same as
  // updatePageAccess — so the new gate takes effect immediately instead of
  // lingering behind a cached 200/403. See `middleware/qcCache.ts`.
  qcCacheClear();

  res.json({ success: true });
});

/**
 * GET /api/insights/admin/departments
 * Current (is_current) conformed departments for the access picker.
 */
export const listDepartments = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const rows = await prisma.ieDimDepartment.findMany({
    where: { is_current: true },
    orderBy: { department_name: 'asc' },
    select: {
      department_key: true,
      department_id: true,
      department_name: true,
      parent_id: true,
      hierarchy_path: true,
    },
  });
  res.json(rows);
});

/**
 * GET /api/insights/admin/pages/:id/overrides
 */
export const listOverrides = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const pageId = parseId(req.params.id, 'page id');

  const rows = await prisma.iePageUserOverride.findMany({
    where: { page_id: pageId },
    orderBy: { granted_at: 'desc' },
    include: {
      user: { select: { username: true } },
      granter: { select: { username: true } },
    },
  });

  res.json(
    rows.map(({ user, granter, ...o }) => ({
      ...o,
      user_name: user.username,
      granter_name: granter.username,
    })),
  );
});

/**
 * POST /api/insights/admin/pages/:id/overrides
 */
export const createOverride = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const pageId = parseId(req.params.id, 'page id');
  const grantedBy = req.user?.user_id;
  if (grantedBy == null) throw createAuthorizationError('Not authenticated');

  const d = createOverrideSchema.parse(req.body);
  const dataScope = d.data_scope ?? null;
  const expiresAt = d.expires_at ? new Date(d.expires_at) : null;
  const reason = d.reason ?? null;

  // Replicates INSERT ... ON DUPLICATE KEY UPDATE on the (page_id, user_id)
  // unique key — an existing grant for the same user is refreshed in place.
  const saved = await prisma.iePageUserOverride.upsert({
    where: { uq_page_user: { page_id: pageId, user_id: d.user_id } },
    create: {
      page_id: pageId,
      user_id: d.user_id,
      can_access: d.can_access,
      data_scope: dataScope,
      granted_by: grantedBy,
      expires_at: expiresAt,
      reason,
    },
    update: {
      can_access: d.can_access,
      data_scope: dataScope,
      granted_by: grantedBy,
      granted_at: new Date(),
      expires_at: expiresAt,
      reason,
    },
  });

  res.status(201).json({
    id: saved.id,
    page_id: pageId,
    user_id: d.user_id,
    can_access: d.can_access,
    data_scope: d.data_scope,
  });
});

/**
 * DELETE /api/insights/admin/pages/:id/overrides/:overrideId
 */
export const deleteOverride = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const overrideId = parseId(req.params.overrideId, 'override id');

  const result = await prisma.iePageUserOverride.deleteMany({ where: { id: overrideId } });
  if (result.count === 0) throw createNotFoundError('Override not found');
  res.json({ success: true });
});
