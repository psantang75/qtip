import prisma from '../config/prisma';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateReportData {
  name: string;
  description?: string;
  layout_config: any;
  audience_scope: 'USER' | 'TEAM' | 'DEPARTMENT' | 'ORG';
  show_in_nav?: boolean;
  nav_order?: number;
  is_active?: boolean;
  department_ids?: number[];
}

export interface UpdateReportData {
  name?: string;
  description?: string;
  layout_config?: any;
  audience_scope?: 'USER' | 'TEAM' | 'DEPARTMENT' | 'ORG';
  show_in_nav?: boolean;
  nav_order?: number;
  is_active?: boolean;
  department_ids?: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build the Prisma where-clause for reports visible to this user. */
function buildVisibilityWhere(
  userRole: string,
  departmentId: number | null,
): object {
  const base: any = { is_active: true };

  // Admin and Director see everything
  if (userRole === 'Admin' || userRole === 'Director') return base;

  // Manager sees reports with no department restriction OR reports for their department
  if (userRole === 'Manager') {
    if (departmentId) {
      base.OR = [
        { report_departments: { none: {} } },
        { report_departments: { some: { department_id: departmentId } } },
      ];
    }
    return base;
  }

  // All other roles: audience_scope must match their level or lower,
  // and no department restriction OR their department is included.
  const scopeMap: Record<string, string[]> = {
    QA:      ['USER', 'TEAM', 'DEPARTMENT', 'ORG'],
    Trainer: ['USER', 'TEAM', 'DEPARTMENT', 'ORG'],
    CSR:     ['USER'],
  };
  const allowedScopes = scopeMap[userRole] ?? ['USER'];
  base.audience_scope = { in: allowedScopes };

  if (departmentId) {
    base.OR = [
      { report_departments: { none: {} } },
      { report_departments: { some: { department_id: departmentId } } },
    ];
  }

  return base;
}

const INCLUDE_DEPARTMENTS = {
  report_departments: {
    include: {
      department: { select: { id: true, department_name: true } },
    },
  },
} as const;

// ── Service functions ─────────────────────────────────────────────────────────

/** Return all reports visible to this user. */
export async function getReports(
  _userId: number,
  userRole: string,
  departmentId: number | null,
  options: { page?: number; limit?: number; search?: string } = {},
) {
  const { page = 1, limit = 50, search } = options;
  const where: any = buildVisibilityWhere(userRole, departmentId);

  if (search) {
    const existingOr = where.OR ?? [];
    where.AND = [
      { OR: existingOr.length ? existingOr : [{ id: { gt: 0 } }] },
      { OR: [{ name: { contains: search } }, { description: { contains: search } }] },
    ];
    delete where.OR;
  }

  const [total, reports] = await prisma.$transaction([
    prisma.reportDefinition.count({ where }),
    prisma.reportDefinition.findMany({
      where,
      include: {
        ...INCLUDE_DEPARTMENTS,
        creator: { select: { id: true, username: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return { reports, total, page, limit, total_pages: Math.ceil(total / limit) };
}

/** Return nav reports (show_in_nav=true) visible to this user, ordered by nav_order. */
export async function getNavReports(
  userId: number,
  userRole: string,
  departmentId: number | null,
) {
  const where: any = {
    ...buildVisibilityWhere(userRole, departmentId),
    show_in_nav: true,
  };

  return prisma.reportDefinition.findMany({
    where,
    include: INCLUDE_DEPARTMENTS,
    orderBy: { nav_order: 'asc' },
  });
}

/** Return a single report by ID with department associations. */
export async function getReportById(id: number) {
  return prisma.reportDefinition.findUnique({
    where: { id },
    include: {
      ...INCLUDE_DEPARTMENTS,
      creator: { select: { id: true, username: true } },
    },
  });
}

/** Create a new report, optionally associating it with departments. */
export async function createReport(data: CreateReportData, createdBy: number) {
  const { department_ids, ...reportData } = data;

  return prisma.$transaction(async (tx) => {
    const report = await tx.reportDefinition.create({
      data: {
        name: reportData.name,
        description: reportData.description ?? null,
        layout_config: reportData.layout_config,
        audience_scope: reportData.audience_scope,
        show_in_nav: reportData.show_in_nav ?? false,
        nav_order: reportData.nav_order ?? 0,
        is_active: reportData.is_active ?? true,
        created_by: createdBy,
      },
    });

    if (department_ids && department_ids.length > 0) {
      await tx.reportDefinitionDepartment.createMany({
        data: department_ids.map((deptId) => ({
          report_id: report.id,
          department_id: deptId,
        })),
      });
    }

    return report;
  });
}

/** Update a report and sync its department associations. */
export async function updateReport(id: number, data: UpdateReportData) {
  const { department_ids, ...updateData } = data;

  return prisma.$transaction(async (tx) => {
    const report = await tx.reportDefinition.update({
      where: { id },
      data: {
        ...(updateData.name !== undefined && { name: updateData.name }),
        ...(updateData.description !== undefined && { description: updateData.description }),
        ...(updateData.layout_config !== undefined && { layout_config: updateData.layout_config }),
        ...(updateData.audience_scope !== undefined && { audience_scope: updateData.audience_scope }),
        ...(updateData.show_in_nav !== undefined && { show_in_nav: updateData.show_in_nav }),
        ...(updateData.nav_order !== undefined && { nav_order: updateData.nav_order }),
        ...(updateData.is_active !== undefined && { is_active: updateData.is_active }),
      },
    });

    if (department_ids !== undefined) {
      await tx.reportDefinitionDepartment.deleteMany({ where: { report_id: id } });
      if (department_ids.length > 0) {
        await tx.reportDefinitionDepartment.createMany({
          data: department_ids.map((deptId) => ({
            report_id: id,
            department_id: deptId,
          })),
        });
      }
    }

    return report;
  });
}

/** Soft-delete a report by setting is_active = false. */
export async function deleteReport(id: number) {
  return prisma.reportDefinition.update({
    where: { id },
    data: { is_active: false },
  });
}

/** Duplicate a report with a "Copy of" name prefix, copying department associations. */
export async function duplicateReport(id: number, createdBy: number) {
  const source = await prisma.reportDefinition.findUnique({
    where: { id },
    include: { report_departments: true },
  });

  if (!source) throw new Error('Report not found');

  return prisma.$transaction(async (tx) => {
    const copy = await tx.reportDefinition.create({
      data: {
        name: `Copy of ${source.name}`,
        description: source.description,
        layout_config: source.layout_config ?? {},
        audience_scope: source.audience_scope,
        show_in_nav: false,
        nav_order: source.nav_order,
        is_active: true,
        created_by: createdBy,
      },
    });

    if (source.report_departments.length > 0) {
      await tx.reportDefinitionDepartment.createMany({
        data: source.report_departments.map((rd) => ({
          report_id: copy.id,
          department_id: rd.department_id,
        })),
      });
    }

    return copy;
  });
}
