import prisma from '../config/prisma';
import {
  Department,
  DepartmentWithDetails,
  DepartmentManager,
  DepartmentFilters,
  PaginatedDepartmentResponse,
  DepartmentCreateRequest,
  DepartmentUpdateRequest,
} from '../types/department.types';

/**
 * MySQL implementation of DepartmentRepository using Prisma
 */
export class MySQLDepartmentRepository {

  constructor(_pool?: any) {
    // pool parameter kept for backward compatibility but no longer used
  }

  private async getDepartmentManagers(department_id: number): Promise<any[]> {
    const managers = await prisma.departmentManager.findMany({
      where: { department_id: department_id, is_active: true },
      include: { manager: { select: { username: true } } },
      orderBy: { assigned_at: 'asc' },
    });

    return managers.map((dm) => ({
      id: dm.id,
      department_id: dm.department_id,
      manager_id: dm.manager_id,
      assigned_at: dm.assigned_at,
      assigned_by: dm.assigned_by,
      is_active: dm.is_active,
      manager_name: dm.manager.username,
    }));
  }

  async findAll(page: number, limit: number, filters?: DepartmentFilters): Promise<PaginatedDepartmentResponse> {
    try {
      const offset = (page - 1) * limit;

      const where: any = {};
      if (filters?.is_active !== undefined) where.is_active = filters.is_active;
      if (filters?.search) where.department_name = { contains: filters.search };
      if (filters?.manager_id !== undefined) {
        where.department_managers = {
          some: { manager_id: filters.manager_id, is_active: true },
        };
      }

      const [totalItems, rows] = await prisma.$transaction([
        prisma.department.count({ where }),
        prisma.department.findMany({
          where,
          include: {
            users: { where: { is_active: true }, select: { id: true } },
            parent: { select: { id: true, department_name: true } },
          },
          orderBy: { department_name: 'asc' },
          skip: offset,
          take: limit,
        }),
      ]);

      const departmentsWithManagers: DepartmentWithDetails[] = await Promise.all(
        rows.map(async (dept) => {
          const managers = await this.getDepartmentManagers(dept.id);
          return {
            id: dept.id,
            department_name: dept.department_name,
            is_active: dept.is_active,
            parent_id: dept.parent_id ?? null,
            parent_name: (dept as any).parent?.department_name ?? null,
            user_count: dept.users.length,
            managers,
          } as DepartmentWithDetails;
        })
      );

      console.log(`[NEW DEPT REPO] Found ${departmentsWithManagers.length} departments, total: ${totalItems}`);

      return {
        items: departmentsWithManagers,
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        totalItems,
      };
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in findAll:', error);
      throw new Error(`Failed to fetch departments: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async findById(id: number): Promise<DepartmentWithDetails | null> {
    try {
      const dept = await prisma.department.findUnique({
        where: { id },
        include: {
          users: { where: { is_active: true }, select: { id: true } },
          parent: { select: { id: true, department_name: true } },
        },
      });

      if (!dept) {
        console.log(`[NEW DEPT REPO] Department not found with ID: ${id}`);
        return null;
      }

      const managers = await this.getDepartmentManagers(id);

      console.log(`[NEW DEPT REPO] Found department: ${dept.department_name}`);
      return {
        id: dept.id,
        department_name: dept.department_name,
        is_active: dept.is_active,
        parent_id: dept.parent_id ?? null,
        parent_name: dept.parent?.department_name ?? null,
        user_count: dept.users.length,
        managers,
      } as DepartmentWithDetails;
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in findById:', error);
      throw new Error(`Failed to fetch department: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async findByName(name: string): Promise<Department | null> {
    try {
      const dept = await prisma.department.findFirst({ where: { department_name: name } });
      return dept as unknown as Department | null;
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in findByName:', error);
      throw new Error(`Failed to find department by name: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async create(departmentData: DepartmentCreateRequest, created_by: number): Promise<DepartmentWithDetails> {
    try {
      await prisma.$transaction(async (tx) => {
        const dept = await tx.department.create({
          data: {
            department_name: departmentData.department_name,
            parent_id: (departmentData as any).parent_id ?? null,
          },
        });

        if (departmentData.manager_ids && departmentData.manager_ids.length > 0) {
          await tx.departmentManager.createMany({
            data: departmentData.manager_ids.map((manager_id) => ({
              department_id: dept.id,
              manager_id: manager_id,
              assigned_by: created_by,
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            user_id: created_by,
            action: 'CREATE',
            target_type: 'departments',
            target_id: dept.id,
            details: JSON.stringify(departmentData),
          },
        });

        return dept;
      });

      // Re-fetch with managers after transaction
      const lastDept = await prisma.department.findFirst({ orderBy: { id: 'desc' } });
      const createdDepartment = await this.findById(lastDept!.id);
      if (!createdDepartment) throw new Error('Failed to retrieve created department');

      console.log(`[NEW DEPT REPO] Department created`);
      return createdDepartment;
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in create:', error);
      throw new Error(`Failed to create department: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async update(id: number, departmentData: DepartmentUpdateRequest, updatedBy: number): Promise<DepartmentWithDetails> {
    try {
      const currentDepartment = await this.findById(id);
      if (!currentDepartment) throw new Error('Department not found');

      await prisma.$transaction(async (tx) => {
        const updateData: Record<string, any> = {};
        if (departmentData.department_name !== undefined) {
          updateData.department_name = departmentData.department_name;
        }
        if ((departmentData as any).parent_id !== undefined) {
          updateData.parent_id = (departmentData as any).parent_id;
        }
        if (Object.keys(updateData).length > 0) {
          await tx.department.update({ where: { id }, data: updateData });
        }

        if (departmentData.manager_ids !== undefined) {
          await tx.departmentManager.updateMany({
            where: { department_id: id },
            data: { is_active: false },
          });

          if (departmentData.manager_ids.length > 0) {
            for (const manager_id of departmentData.manager_ids) {
              await tx.departmentManager.upsert({
                where: { unique_dept_manager: { department_id: id, manager_id: manager_id } },
                update: { is_active: true, assigned_by: updatedBy },
                create: { department_id: id, manager_id: manager_id, assigned_by: updatedBy },
              });
            }
          }
        }

        await tx.auditLog.create({
          data: {
            user_id: updatedBy,
            action: 'UPDATE',
            target_type: 'departments',
            target_id: id,
            details: JSON.stringify({ old: currentDepartment, new: departmentData }),
          },
        });
      });

      console.log(`[NEW DEPT REPO] Department updated with ID: ${id}`);
      const updatedDepartment = await this.findById(id);
      if (!updatedDepartment) throw new Error('Failed to retrieve updated department');
      return updatedDepartment;
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in update:', error);
      throw new Error(`Failed to update department: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async delete(id: number, deletedBy: number): Promise<void> {
    try {
      const currentDepartment = await this.findById(id);
      if (!currentDepartment) throw new Error('Department not found');

      await prisma.$transaction(async (tx) => {
        await tx.department.delete({ where: { id } });

        await tx.auditLog.create({
          data: {
            user_id: deletedBy,
            action: 'DELETE',
            target_type: 'departments',
            target_id: id,
            details: JSON.stringify(currentDepartment),
          },
        });
      });

      console.log(`[NEW DEPT REPO] Department deleted with ID: ${id}`);
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in delete:', error);
      throw new Error(`Failed to delete department: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async toggleStatus(id: number, is_active: boolean, updatedBy: number): Promise<DepartmentWithDetails> {
    try {
      const currentDepartment = await this.findById(id);
      if (!currentDepartment) throw new Error('Department not found');

      await prisma.$transaction(async (tx) => {
        await tx.department.update({ where: { id }, data: { is_active: is_active } });

        await tx.auditLog.create({
          data: {
            user_id: updatedBy,
            action: 'STATUS_CHANGE',
            target_type: 'departments',
            target_id: id,
            details: JSON.stringify({ old: { is_active: currentDepartment.is_active }, new: { is_active: is_active } }),
          },
        });
      });

      console.log(`[NEW DEPT REPO] Department status toggled for ID: ${id} to ${is_active}`);
      const updatedDepartment = await this.findById(id);
      if (!updatedDepartment) throw new Error('Failed to retrieve updated department');
      return updatedDepartment;
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in toggleStatus:', error);
      throw new Error(`Failed to toggle department status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async assignUsers(department_id: number, userIds: number[], assigned_by: number): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        if (userIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: userIds } },
            data: { department_id: department_id },
          });

          await tx.auditLog.create({
            data: {
              user_id: assigned_by,
              action: 'ASSIGN_USERS',
              target_type: 'departments',
              target_id: department_id,
              details: JSON.stringify({ user_ids: userIds }),
            },
          });
        }
      });

      console.log(`[NEW DEPT REPO] ${userIds.length} users assigned to department ID: ${department_id}`);
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in assignUsers:', error);
      throw new Error(`Failed to assign users to department: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getAssignableUsers(): Promise<any[]> {
    try {
      const users = await prisma.user.findMany({
        where: {
          is_active: true,
          role_id: { not: 1 },
        },
        include: {
          role: { select: { role_name: true } },
          department: { select: { department_name: true } },
        },
        orderBy: { username: 'asc' },
      });

      console.log(`[NEW DEPT REPO] Found ${users.length} assignable users`);
      return users.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role_id: u.role_id,
        role_name: u.role.role_name,
        department_id: u.department_id,
        department_name: u.department?.department_name ?? '',
        is_active: u.is_active,
        created_at: u.created_at,
      }));
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in getAssignableUsers:', error);
      throw new Error(`Failed to get assignable users: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getUserCount(department_id: number): Promise<number> {
    try {
      const count = await prisma.user.count({ where: { department_id: department_id, is_active: true } });
      console.log(`[NEW DEPT REPO] Department ${department_id} has ${count} users`);
      return count;
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in getUserCount:', error);
      throw new Error(`Failed to get user count: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async assignManagers(department_id: number, managerIds: number[], assigned_by: number): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.departmentManager.updateMany({
          where: { department_id: department_id },
          data: { is_active: false },
        });

        for (const manager_id of managerIds) {
          await tx.departmentManager.upsert({
            where: { unique_dept_manager: { department_id: department_id, manager_id: manager_id } },
            update: { is_active: true, assigned_by: assigned_by },
            create: { department_id: department_id, manager_id: manager_id, assigned_by: assigned_by },
          });
        }
      });

      console.log(`[NEW DEPT REPO] Assigned ${managerIds.length} managers to department ${department_id}`);
    } catch (error) {
      console.error('[NEW DEPT REPO] Error in assignManagers:', error);
      throw new Error(`Failed to assign managers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getDepartmentManagersPublic(department_id: number): Promise<DepartmentManager[]> {
    return this.getDepartmentManagers(department_id);
  }
}
