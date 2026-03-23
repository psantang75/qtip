import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { 
  AuditAssignmentWithDetails, 
  CreateAuditAssignmentDTO, 
  UpdateAuditAssignmentDTO
} from '../models';

class HttpError extends Error {
  constructor(public statusCode: number, message: string, public responseData?: Record<string, any>) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Get all audit assignments with pagination and optional filtering
 * @route GET /api/audit-assignments
 */
export const getAuditAssignments = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const is_active = req.query.is_active;
    const form_id = req.query.form_id;
    const target_type = req.query.target_type;
    const target_id = req.query.target_id;
    const search = req.query.search as string || '';

    try {
      const existCheck = await prisma.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT COUNT(*) as count FROM audit_assignments`
      );
      const count = Number(existCheck[0]?.count || 0);

      if (count === 0) {
        res.status(200).json({
          assignments: [],
          totalItems: 0,
          totalPages: 0,
          currentPage: page
        });
        return;
      }
    } catch (error) {
      console.error('Error checking if audit_assignments exists:', error);
    }

    const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

    if (is_active !== undefined) {
      conditions.push(Prisma.sql`a.is_active = ${is_active === 'true' ? 1 : 0}`);
    }
    if (form_id) {
      conditions.push(Prisma.sql`a.form_id = ${Number(form_id)}`);
    }
    if (target_type) {
      conditions.push(Prisma.sql`a.target_type = ${String(target_type)}`);
    }
    if (target_id) {
      conditions.push(Prisma.sql`a.target_id = ${Number(target_id)}`);
    }
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(Prisma.sql`(f.form_name LIKE ${searchPattern} OR u_target.username LIKE ${searchPattern} OR d.department_name LIKE ${searchPattern})`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        a.*,
        f.form_name,
        CASE
          WHEN a.target_type = 'USER' THEN u_target.username
          WHEN a.target_type = 'DEPARTMENT' THEN d.department_name
        END AS target_name,
        u_qa.username AS qa_name,
        u_creator.username AS created_by_name
      FROM
        audit_assignments a
        LEFT JOIN forms f ON a.form_id = f.id
        LEFT JOIN users u_target ON a.target_type = 'USER' AND a.target_id = u_target.id
        LEFT JOIN departments d ON a.target_type = 'DEPARTMENT' AND a.target_id = d.id
        LEFT JOIN users u_qa ON a.qa_id = u_qa.id
        LEFT JOIN users u_creator ON a.created_by = u_creator.id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) as total
      FROM
        audit_assignments a
        LEFT JOIN forms f ON a.form_id = f.id
        LEFT JOIN users u_target ON a.target_type = 'USER' AND a.target_id = u_target.id
        LEFT JOIN departments d ON a.target_type = 'DEPARTMENT' AND a.target_id = d.id
        LEFT JOIN users u_qa ON a.qa_id = u_qa.id
        LEFT JOIN users u_creator ON a.created_by = u_creator.id
      WHERE ${whereClause}
    `);

    const total = Number(countResult[0]?.total || 0);
    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      assignments: rows,
      totalItems: total,
      totalPages,
      currentPage: page
    });
  } catch (error) {
    console.error('Error retrieving audit assignments:', error);
    res.status(500).json({ message: 'Failed to retrieve audit assignments' });
  }
};

/**
 * Get a single audit assignment by ID
 * @route GET /api/audit-assignments/:id
 */
export const getAuditAssignmentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const assignmentId = req.params.id;

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        a.*,
        f.form_name,
        CASE
          WHEN a.target_type = 'USER' THEN u_target.username
          WHEN a.target_type = 'DEPARTMENT' THEN d.department_name
        END AS target_name,
        u_qa.username AS qa_name,
        u_creator.username AS created_by_name
      FROM
        audit_assignments a
        LEFT JOIN forms f ON a.form_id = f.id
        LEFT JOIN users u_target ON a.target_type = 'USER' AND a.target_id = u_target.id
        LEFT JOIN departments d ON a.target_type = 'DEPARTMENT' AND a.target_id = d.id
        LEFT JOIN users u_qa ON a.qa_id = u_qa.id
        LEFT JOIN users u_creator ON a.created_by = u_creator.id
      WHERE a.id = ${Number(assignmentId)}
    `);

    if (rows.length === 0) {
      res.status(404).json({ message: 'Audit assignment not found' });
      return;
    }

    res.status(200).json(rows[0] as AuditAssignmentWithDetails);
  } catch (error) {
    console.error('Error retrieving audit assignment:', error);
    res.status(500).json({ message: 'Failed to retrieve audit assignment' });
  }
};

/**
 * Create a new audit assignment
 * @route POST /api/audit-assignments
 */
export const createAuditAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const assignmentData: CreateAuditAssignmentDTO = req.body;

    const formRows = await prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM forms WHERE id = ${Number(assignmentData.form_id)} AND is_active = true`
    );

    if (formRows.length === 0) {
      res.status(400).json({ message: 'Form does not exist or is not active' });
      return;
    }

    if (assignmentData.target_type === 'USER') {
      const userExists = await prisma.user.findUnique({
        where: { id: Number(assignmentData.target_id) },
        select: { id: true }
      });
      if (!userExists) {
        res.status(400).json({ message: 'Target user does not exist' });
        return;
      }
    } else if (assignmentData.target_type === 'DEPARTMENT') {
      const deptExists = await prisma.department.findUnique({
        where: { id: Number(assignmentData.target_id) },
        select: { id: true }
      });
      if (!deptExists) {
        res.status(400).json({ message: 'Target department does not exist' });
        return;
      }
    }

    if (assignmentData.qa_id) {
      const qaRows = await prisma.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT id FROM users WHERE id = ${Number(assignmentData.qa_id)} AND role_id = (SELECT id FROM roles WHERE role_name = 'QA')`
      );
      if (qaRows.length === 0) {
        res.status(400).json({ message: 'QA analyst does not exist or does not have QA role' });
        return;
      }
    }

    const created = await prisma.auditAssignment.create({
      data: {
        form_id: Number(assignmentData.form_id),
        target_id: Number(assignmentData.target_id),
        target_type: assignmentData.target_type,
        schedule: assignmentData.schedule,
        qa_id: assignmentData.qa_id ? Number(assignmentData.qa_id) : null,
        start_date: assignmentData.start_date,
        end_date: assignmentData.end_date || null,
        created_by: Number(assignmentData.created_by),
        is_active: true
      }
    });

    await prisma.$executeRaw`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${Number(assignmentData.created_by)}, ${'Created audit assignment'}, ${created.id}, ${'AUDIT_ASSIGNMENT'}, ${JSON.stringify(assignmentData)})
    `;

    res.status(201).json({
      message: 'Audit assignment created successfully',
      assignment_id: created.id
    });
  } catch (error) {
    console.error('Error creating audit assignment:', error);
    res.status(500).json({ message: 'Failed to create audit assignment' });
  }
};

/**
 * Create multiple audit assignments in batch
 * @route POST /api/audit-assignments
 */
export const createBatchAuditAssignments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { assignments } = req.body;

    if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
      res.status(400).json({ message: 'No assignments provided or invalid format' });
      return;
    }

    if (!req.user || !req.user.user_id) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }
    const user_id = req.user.user_id;

    const createdAssignments: any[] = [];

    await prisma.$transaction(async (tx) => {
      for (const assignment of assignments) {
        const assignmentWithCreator = { ...assignment, created_by: user_id };

        const formsList = await tx.$queryRaw<{ id: number; form_name: string }[]>(
          Prisma.sql`SELECT id, form_name FROM forms WHERE id = ${Number(assignmentWithCreator.form_id)} AND is_active = true`
        );

        if (formsList.length === 0) {
          throw new HttpError(400, 'Form does not exist or is not active', { form_id: assignmentWithCreator.form_id });
        }

        const form_name = formsList[0].form_name;
        let targetName = '';

        if (assignmentWithCreator.target_type === 'USER') {
          const usersList = await tx.$queryRaw<{ id: number; username: string }[]>(
            Prisma.sql`SELECT id, username FROM users WHERE id = ${Number(assignmentWithCreator.target_id)}`
          );
          if (usersList.length === 0) {
            throw new HttpError(400, 'Target user does not exist', { target_id: assignmentWithCreator.target_id });
          }
          targetName = usersList[0].username;
        } else if (assignmentWithCreator.target_type === 'DEPARTMENT') {
          const deptsList = await tx.$queryRaw<{ id: number; department_name: string }[]>(
            Prisma.sql`SELECT id, department_name FROM departments WHERE id = ${Number(assignmentWithCreator.target_id)}`
          );
          if (deptsList.length === 0) {
            throw new HttpError(400, 'Target department does not exist', { target_id: assignmentWithCreator.target_id });
          }
          targetName = deptsList[0].department_name;
        }

        let qaName: string | null = null;
        if (assignmentWithCreator.qa_id) {
          const qaList = await tx.$queryRaw<{ id: number; username: string }[]>(
            Prisma.sql`SELECT id, username FROM users WHERE id = ${Number(assignmentWithCreator.qa_id)}`
          );
          if (qaList.length === 0) {
            throw new HttpError(400, 'QA analyst does not exist', { qa_id: assignmentWithCreator.qa_id });
          }
          qaName = qaList[0].username;
        }

        const created = await tx.auditAssignment.create({
          data: {
            form_id: Number(assignmentWithCreator.form_id),
            target_id: Number(assignmentWithCreator.target_id),
            target_type: assignmentWithCreator.target_type,
            schedule: assignmentWithCreator.schedule,
            qa_id: assignmentWithCreator.qa_id ? Number(assignmentWithCreator.qa_id) : null,
            start_date: assignmentWithCreator.start_date,
            end_date: assignmentWithCreator.end_date || null,
            created_by: Number(assignmentWithCreator.created_by),
            is_active: true
          }
        });

        createdAssignments.push({
          id: created.id,
          form_id: assignmentWithCreator.form_id,
          form_name: form_name,
          target_id: assignmentWithCreator.target_id,
          target_name: targetName,
          target_type: assignmentWithCreator.target_type,
          schedule: assignmentWithCreator.schedule,
          qa_id: assignmentWithCreator.qa_id,
          qa_name: qaName,
          start_date: assignmentWithCreator.start_date,
          end_date: assignmentWithCreator.end_date,
          is_active: true,
          created_by: assignmentWithCreator.created_by,
          created_at: new Date().toISOString()
        });

        await tx.$executeRaw`
          INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
          VALUES (${Number(assignmentWithCreator.created_by)}, ${'CREATE_AUDIT_ASSIGNMENT'}, ${created.id}, ${'AUDIT_ASSIGNMENT'}, ${JSON.stringify(assignmentWithCreator)})
        `;
      }
    });

    res.status(201).json({
      message: 'Audit assignments created successfully',
      assignments: createdAssignments
    });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ message: error.message, ...error.responseData });
      return;
    }
    console.error('Error creating audit assignments:', error);
    res.status(500).json({ message: 'Failed to create audit assignments' });
  }
};

/**
 * Update an existing audit assignment
 * @route PUT /api/audit-assignments/:id
 */
export const updateAuditAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const assignmentId = req.params.id;
    const assignmentData: UpdateAuditAssignmentDTO = req.body;

    if (!req.user || !req.user.user_id) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }
    const user_id = req.user.user_id;

    const existing = await prisma.auditAssignment.findUnique({
      where: { id: Number(assignmentId) }
    });

    if (!existing) {
      res.status(404).json({ message: 'Audit assignment not found' });
      return;
    }

    const updateData: Record<string, any> = {};

    if (assignmentData.form_id !== undefined) {
      const formRows = await prisma.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT id FROM forms WHERE id = ${Number(assignmentData.form_id)} AND is_active = true`
      );
      if (formRows.length === 0) {
        res.status(400).json({ message: 'Form does not exist or is not active' });
        return;
      }
      updateData.form_id = Number(assignmentData.form_id);
    }

    if (assignmentData.target_type !== undefined && assignmentData.target_id !== undefined) {
      if (assignmentData.target_type === 'USER') {
        const userExists = await prisma.user.findUnique({
          where: { id: Number(assignmentData.target_id) },
          select: { id: true }
        });
        if (!userExists) {
          res.status(400).json({ message: 'Target user does not exist' });
          return;
        }
      } else if (assignmentData.target_type === 'DEPARTMENT') {
        const deptExists = await prisma.department.findUnique({
          where: { id: Number(assignmentData.target_id) },
          select: { id: true }
        });
        if (!deptExists) {
          res.status(400).json({ message: 'Target department does not exist' });
          return;
        }
      }
      updateData.target_type = assignmentData.target_type;
      updateData.target_id = Number(assignmentData.target_id);
    } else if (assignmentData.target_type !== undefined) {
      res.status(400).json({ message: 'When updating target_type, target_id must also be provided' });
      return;
    } else if (assignmentData.target_id !== undefined) {
      res.status(400).json({ message: 'When updating target_id, target_type must also be provided' });
      return;
    }

    if (assignmentData.schedule !== undefined) {
      updateData.schedule = assignmentData.schedule;
    }

    if (assignmentData.qa_id !== undefined) {
      if (assignmentData.qa_id !== null) {
        const qaRows = await prisma.$queryRaw<{ id: number }[]>(
          Prisma.sql`SELECT id FROM users WHERE id = ${Number(assignmentData.qa_id)} AND role_id = (SELECT id FROM roles WHERE role_name = 'QA')`
        );
        if (qaRows.length === 0) {
          res.status(400).json({ message: 'QA analyst does not exist or does not have QA role' });
          return;
        }
      }
      updateData.qa_id = assignmentData.qa_id !== null ? Number(assignmentData.qa_id) : null;
    }

    if (assignmentData.start_date !== undefined) {
      updateData.start_date = assignmentData.start_date;
    }

    if (assignmentData.end_date !== undefined) {
      updateData.end_date = assignmentData.end_date;
    }

    if (assignmentData.is_active !== undefined) {
      updateData.is_active = assignmentData.is_active;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ message: 'No fields to update' });
      return;
    }

    await prisma.auditAssignment.update({
      where: { id: Number(assignmentId) },
      data: updateData
    });

    await prisma.$executeRaw`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${Number(user_id)}, ${'Updated audit assignment'}, ${Number(assignmentId)}, ${'AUDIT_ASSIGNMENT'}, ${JSON.stringify(assignmentData)})
    `;

    res.status(200).json({
      message: 'Audit assignment updated successfully',
      assignment_id: assignmentId
    });
  } catch (error) {
    console.error('Error updating audit assignment:', error);
    res.status(500).json({ message: 'Failed to update audit assignment' });
  }
};

/**
 * Deactivate an audit assignment (soft delete)
 * @route DELETE /api/audit-assignments/:id
 */
export const deactivateAuditAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const assignmentId = req.params.id;

    if (!req.user || !req.user.user_id) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }
    const user_id = req.user.user_id;

    const existing = await prisma.auditAssignment.findUnique({
      where: { id: Number(assignmentId) }
    });

    if (!existing) {
      res.status(404).json({ message: 'Audit assignment not found' });
      return;
    }

    await prisma.auditAssignment.update({
      where: { id: Number(assignmentId) },
      data: { is_active: false }
    });

    await prisma.$executeRaw`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${Number(user_id)}, ${'Deactivated audit assignment'}, ${Number(assignmentId)}, ${'AUDIT_ASSIGNMENT'}, ${JSON.stringify({ assignment_id: assignmentId })})
    `;

    res.status(200).json({
      message: 'Audit assignment deactivated successfully',
      assignment_id: assignmentId
    });
  } catch (error) {
    console.error('Error deactivating audit assignment:', error);
    res.status(500).json({ message: 'Failed to deactivate audit assignment' });
  }
};
