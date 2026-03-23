import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

// Types
interface DirectorDepartment {
  id: number;
  director_id: number;
  department_id: number;
  director_name?: string;
  department_name?: string;
  created_at: string;
}

// Get all director department assignments with pagination and filters
export const getDirectorDepartments = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const directorId = req.query.director_id;
    const department_id = req.query.department_id;
    const search = req.query.search as string;

    const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

    if (directorId) {
      conditions.push(Prisma.sql`dd.director_id = ${Number(directorId)}`);
    }
    if (department_id) {
      conditions.push(Prisma.sql`dd.department_id = ${Number(department_id)}`);
    }
    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(Prisma.sql`(u.username LIKE ${searchTerm} OR d.department_name LIKE ${searchTerm})`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const rows = await prisma.$queryRaw<DirectorDepartment[]>(Prisma.sql`
      SELECT dd.id, dd.director_id, dd.department_id, u.username as director_name,
             d.department_name, dd.created_at
      FROM director_departments dd
      JOIN users u ON dd.director_id = u.id
      JOIN departments d ON dd.department_id = d.id
      WHERE ${whereClause}
      ORDER BY dd.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) as total
      FROM director_departments dd
      JOIN users u ON dd.director_id = u.id
      JOIN departments d ON dd.department_id = d.id
      WHERE ${whereClause}
    `);

    const totalItems = Number(countResult[0]?.total || 0);
    const totalPages = Math.ceil(totalItems / limit);

    res.status(200).json({
      items: rows,
      totalItems,
      totalPages,
      currentPage: page
    });
  } catch (error) {
    console.error('Error fetching director department assignments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Get assignments for a specific director
export const getDirectorDepartmentsById = async (req: Request, res: Response) => {
  try {
    const directorId = req.params.directorId;

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT dd.id, dd.department_id, d.department_name, dd.created_at
      FROM director_departments dd
      JOIN departments d ON dd.department_id = d.id
      WHERE dd.director_id = ${Number(directorId)}
      ORDER BY dd.created_at DESC
    `);

    res.status(200).json(rows);
  } catch (error) {
    console.error(`Error fetching assignments for director ID ${req.params.directorId}:`, error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Create a new director-department assignment
export const createDirectorDepartment = async (req: Request, res: Response) => {
  try {
    const { director_id, department_id } = req.body;

    if (!director_id || !department_id) {
      res.status(400).json({ message: 'Director ID and Department ID are required' });
      return;
    }

    const directorCheck = await prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM users WHERE id = ${Number(director_id)} AND role_id = (SELECT id FROM roles WHERE role_name = 'Director')`
    );

    if (directorCheck.length === 0) {
      res.status(400).json({ message: 'Invalid Director ID or user is not a Director' });
      return;
    }

    const departmentCheck = await prisma.department.findUnique({
      where: { id: Number(department_id) },
      select: { id: true }
    });

    if (!departmentCheck) {
      res.status(400).json({ message: 'Invalid Department ID' });
      return;
    }

    const duplicateCheck = await prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM director_departments WHERE director_id = ${Number(director_id)} AND department_id = ${Number(department_id)}`
    );

    if (duplicateCheck.length > 0) {
      res.status(409).json({ message: 'This director-department assignment already exists' });
      return;
    }

    await prisma.$executeRaw`
      INSERT INTO director_departments (director_id, department_id)
      VALUES (${Number(director_id)}, ${Number(department_id)})
    `;

    const insertIdResult = await prisma.$queryRaw<{ id: bigint }[]>`SELECT LAST_INSERT_ID() as id`;
    const insertId = Number(insertIdResult[0].id);

    const createdAssignment = await prisma.$queryRaw<DirectorDepartment[]>(Prisma.sql`
      SELECT dd.id, dd.director_id, dd.department_id, u.username as director_name,
             d.department_name, dd.created_at
      FROM director_departments dd
      JOIN users u ON dd.director_id = u.id
      JOIN departments d ON dd.department_id = d.id
      WHERE dd.id = ${insertId}
    `);

    await prisma.$executeRaw`
      INSERT INTO audit_logs (user_id, action, details)
      VALUES (${req.user?.user_id}, ${'CREATE_DIRECTOR_DEPARTMENT'}, ${JSON.stringify({ director_id, department_id, assignment_id: insertId })})
    `;

    res.status(201).json(createdAssignment[0]);
  } catch (error) {
    console.error('Error creating director department assignment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Create multiple director-department assignments
export const createBulkDirectorDepartments = async (req: Request, res: Response) => {
  try {
    const { assignments } = req.body;

    if (!Array.isArray(assignments) || assignments.length === 0) {
      res.status(400).json({ message: 'Valid assignments array is required' });
      return;
    }

    const createdAssignments: DirectorDepartment[] = [];

    for (const assignment of assignments) {
      const { director_id, department_id } = assignment;

      if (!director_id || !department_id) {
        continue;
      }

      const duplicateCheck = await prisma.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT id FROM director_departments WHERE director_id = ${Number(director_id)} AND department_id = ${Number(department_id)}`
      );

      if (duplicateCheck.length > 0) {
        continue;
      }

      await prisma.$executeRaw`
        INSERT INTO director_departments (director_id, department_id)
        VALUES (${Number(director_id)}, ${Number(department_id)})
      `;

      const insertIdResult = await prisma.$queryRaw<{ id: bigint }[]>`SELECT LAST_INSERT_ID() as id`;
      const insertId = Number(insertIdResult[0].id);

      const createdAssignment = await prisma.$queryRaw<DirectorDepartment[]>(Prisma.sql`
        SELECT dd.id, dd.director_id, dd.department_id, u.username as director_name,
               d.department_name, dd.created_at
        FROM director_departments dd
        JOIN users u ON dd.director_id = u.id
        JOIN departments d ON dd.department_id = d.id
        WHERE dd.id = ${insertId}
      `);

      if (createdAssignment.length > 0) {
        createdAssignments.push(createdAssignment[0]);

        await prisma.$executeRaw`
          INSERT INTO audit_logs (user_id, action, details)
          VALUES (${req.user?.user_id}, ${'CREATE_DIRECTOR_DEPARTMENT'}, ${JSON.stringify({ director_id, department_id, assignment_id: insertId })})
        `;
      }
    }

    res.status(201).json(createdAssignments);
  } catch (error) {
    console.error('Error creating bulk director department assignments:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Delete a director-department assignment
export const deleteDirectorDepartment = async (req: Request, res: Response) => {
  try {
    const assignmentId = req.params.id;

    const assignmentDetails = await prisma.$queryRaw<{ director_id: number; department_id: number }[]>(
      Prisma.sql`SELECT director_id, department_id FROM director_departments WHERE id = ${Number(assignmentId)}`
    );

    if (assignmentDetails.length === 0) {
      res.status(404).json({ message: 'Assignment not found' });
      return;
    }

    const result = await prisma.$executeRaw`
      DELETE FROM director_departments WHERE id = ${Number(assignmentId)}
    `;

    if (result === 0) {
      res.status(404).json({ message: 'Assignment not found' });
      return;
    }

    await prisma.$executeRaw`
      INSERT INTO audit_logs (user_id, action, details)
      VALUES (${req.user?.user_id}, ${'DELETE_DIRECTOR_DEPARTMENT'}, ${JSON.stringify({
        assignment_id: assignmentId,
        director_id: assignmentDetails[0].director_id,
        department_id: assignmentDetails[0].department_id
      })})
    `;

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(`Error deleting director department assignment with ID ${req.params.id}:`, error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
