import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { 
  EnrollmentStatus,
  assignment_type,
  target_type,
  BatchAssignmentDTO,
  EnrollmentListItem,
  PaginatedResponse
} from '../types/enrollment.types';

class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Get all enrollments with pagination and filtering
 * @route GET /api/enrollments
 */
export const getEnrollments = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.perPage as string) || 10;
    const offset = (page - 1) * perPage;

    const course_id = req.query.course_id ? parseInt(req.query.course_id as string) : null;
    const status = req.query.status as EnrollmentStatus | undefined;
    const target_id = req.query.target_id ? parseInt(req.query.target_id as string) : null;
    const search = req.query.search as string | undefined;

    const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];

    if (course_id) {
      conditions.push(Prisma.sql`e.course_id = ${course_id}`);
    }
    if (status) {
      conditions.push(Prisma.sql`e.status = ${status}`);
    }
    if (target_id) {
      conditions.push(Prisma.sql`(e.user_id = ${target_id} OR e.department_id = ${target_id})`);
    }
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(Prisma.sql`(c.course_name LIKE ${searchPattern} OR tp.path_name LIKE ${searchPattern} OR u.username LIKE ${searchPattern} OR d.department_name LIKE ${searchPattern})`);
    }

    const whereClause = Prisma.join(conditions, ' AND ');

    const countResult = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) as total
      FROM enrollments e
      LEFT JOIN courses c ON e.course_id = c.id
      LEFT JOIN training_paths tp ON e.path_id = tp.id
      LEFT JOIN users u ON e.user_id = u.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE ${whereClause}
    `);
    const total = Number(countResult[0]?.total || 0);

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        e.id, e.course_id, e.path_id, e.user_id, e.department_id,
        e.assignment_type, e.target_type, e.status, e.progress,
        e.due_date, e.created_at,
        c.course_name,
        tp.path_name,
        u.username as user_name,
        d.department_name,
        CASE
          WHEN e.target_type = 'USER' THEN u.username
          WHEN e.target_type = 'DEPARTMENT' THEN d.department_name
          ELSE 'Unknown'
        END as target_name
      FROM enrollments e
      LEFT JOIN courses c ON e.course_id = c.id
      LEFT JOIN training_paths tp ON e.path_id = tp.id
      LEFT JOIN users u ON e.user_id = u.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE ${whereClause}
      ORDER BY e.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `);

    const enrollments: EnrollmentListItem[] = rows.map((row: any) => ({
      id: row.id,
      course_id: row.course_id,
      path_id: row.path_id,
      course_name: row.course_name,
      path_name: row.path_name,
      user_id: row.user_id,
      user_name: row.user_name,
      department_id: row.department_id,
      department_name: row.department_name,
      assignment_type: row.assignment_type || 'COURSE',
      target_type: row.target_type || 'USER',
      target_name: row.target_name,
      status: row.status,
      progress: row.progress,
      due_date: row.due_date,
      created_at: row.created_at
    }));

    const totalPages = Math.ceil(total / perPage);

    const response: PaginatedResponse<EnrollmentListItem> = {
      data: enrollments,
      total,
      page,
      perPage,
      totalPages
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    res.status(500).json({ message: 'Failed to fetch enrollments' });
  }
};

/**
 * Get a single enrollment by ID
 * @route GET /api/enrollments/:id
 */
export const getEnrollmentById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        e.id, e.course_id, e.path_id, e.user_id, e.department_id,
        e.assignment_type, e.target_type, e.status, e.progress,
        e.due_date, e.created_at,
        c.course_name,
        tp.path_name,
        u.username as user_name,
        d.department_name,
        CASE
          WHEN e.target_type = 'USER' THEN u.username
          WHEN e.target_type = 'DEPARTMENT' THEN d.department_name
          ELSE 'Unknown'
        END as target_name
      FROM enrollments e
      LEFT JOIN courses c ON e.course_id = c.id
      LEFT JOIN training_paths tp ON e.path_id = tp.id
      LEFT JOIN users u ON e.user_id = u.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE e.id = ${Number(id)}
    `);

    if (rows.length === 0) {
      res.status(404).json({ message: 'Enrollment not found' });
      return;
    }

    const row = rows[0];
    const enrollment: EnrollmentListItem = {
      id: row.id,
      course_id: row.course_id,
      path_id: row.path_id,
      course_name: row.course_name,
      path_name: row.path_name,
      user_id: row.user_id,
      user_name: row.user_name,
      department_id: row.department_id,
      department_name: row.department_name,
      assignment_type: row.assignment_type || 'COURSE',
      target_type: row.target_type || 'USER',
      target_name: row.target_name,
      status: row.status,
      progress: row.progress,
      due_date: row.due_date,
      created_at: row.created_at
    };

    res.status(200).json(enrollment);
  } catch (error) {
    console.error('Error fetching enrollment by id:', error);
    res.status(500).json({ message: 'Failed to fetch enrollment' });
  }
};

/**
 * Get published courses for assignment
 * @route GET /api/trainer/courses
 */
export const getPublishedCourses = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT c.id, c.course_name, c.description, c.created_at,
        u.username as creator_name, COUNT(cp.id) as page_count
      FROM courses c
      JOIN users u ON c.created_by = u.id
      JOIN course_pages cp ON c.id = cp.course_id
      GROUP BY c.id
      HAVING page_count > 0
      ORDER BY c.course_name ASC
    `);

    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching published courses:', error);
    res.status(500).json({ message: 'Failed to fetch courses' });
  }
};

/**
 * Get training paths for assignment
 * @route GET /api/trainer/paths
 */
export const getTrainingPaths = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT tp.id, tp.path_name, tp.created_at,
        u.username as creator_name, COUNT(tpc.id) as course_count
      FROM training_paths tp
      JOIN users u ON tp.created_by = u.id
      JOIN training_path_courses tpc ON tp.id = tpc.path_id
      GROUP BY tp.id
      HAVING course_count > 0
      ORDER BY tp.path_name ASC
    `);

    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching training paths:', error);
    res.status(500).json({ message: 'Failed to fetch training paths' });
  }
};

/**
 * Get CSRs and departments for assignment
 * @route GET /api/trainer/targets
 */
export const getAssignmentTargets = async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT u.id, u.username, u.email, u.role_id, u.department_id, u.is_active, d.department_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE r.role_name = 'CSR' AND u.is_active = 1
      ORDER BY u.username ASC
    `);

    const departments = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, department_name, is_active
      FROM departments
      WHERE is_active = 1
      ORDER BY department_name ASC
    `);

    res.status(200).json({ users, departments });
  } catch (error) {
    console.error('Error fetching assignment targets:', error);
    res.status(500).json({ message: 'Failed to fetch assignment targets' });
  }
};

/**
 * Create training assignments (batch)
 * @route POST /api/enrollments/batch
 */
export const createBatchEnrollments = async (req: Request, res: Response): Promise<void> => {
  const user_id = req.user?.user_id;
  const { assignments } = req.body as BatchAssignmentDTO;

  if (!assignments || assignments.length === 0) {
    res.status(400).json({ message: 'No assignments provided' });
    return;
  }

  const results: any[] = [];
  const audits: any[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const assignment of assignments) {
        const {
          assignment_type,
          target_type,
          target_id,
          course_id,
          path_id,
          due_date
        } = assignment;

        console.log('Processing assignment:', JSON.stringify(assignment, null, 2));

        if (assignment_type === 'COURSE' && !course_id) {
          console.log('Validation failed: Course ID required for course assignments');
          throw new HttpError(400, 'Course ID is required for course assignments');
        }

        if (assignment_type === 'TRAINING_PATH' && !path_id) {
          console.log('Validation failed: Path ID required for training path assignments');
          throw new HttpError(400, 'Path ID is required for training path assignments');
        }

        if (!target_id) {
          console.log('Validation failed: Target ID required');
          throw new HttpError(400, 'Target ID is required');
        }

        console.log('Assignment validation passed, processing assignment type:', assignment_type);

        try {
          if (assignment_type === 'COURSE') {
            console.log('Processing COURSE assignment for course_id:', course_id);

            const courseExists = await tx.course.findUnique({
              where: { id: course_id },
              select: { id: true }
            });

            console.log('Course query result:', courseExists);

            if (!courseExists) {
              console.log(`Course with ID ${course_id} not found`);
              throw new HttpError(404, `Course with ID ${course_id} not found`);
            }

            if (target_type === 'USER') {
              console.log('Processing USER target for target_id:', target_id);

              const userExists = await tx.user.findUnique({
                where: { id: target_id },
                select: { id: true }
              });

              console.log('User query result:', userExists);

              if (!userExists) {
                console.log(`User with ID ${target_id} not found`);
                throw new HttpError(404, `User with ID ${target_id} not found`);
              }

              console.log('Creating new enrollment...');
              const created = await tx.enrollment.create({
                data: {
                  course_id: course_id,
                  user_id: target_id,
                  assignment_type: assignment_type,
                  target_type: target_type,
                  status: EnrollmentStatus.IN_PROGRESS,
                  progress: 0,
                  due_date: due_date || null
                }
              });

              results.push({ success: true, id: created.id, assignment });

              audits.push({
                user_id: user_id,
                action: 'Assigned course to user',
                target_id: created.id,
                target_type: 'ENROLLMENT',
                details: JSON.stringify({ assignment_type, course_id, user_id: target_id, due_date })
              });
            } else if (target_type === 'DEPARTMENT') {
              const deptExists = await tx.department.findUnique({
                where: { id: target_id },
                select: { id: true }
              });

              if (!deptExists) {
                throw new HttpError(404, `Department with ID ${target_id} not found`);
              }

              const created = await tx.enrollment.create({
                data: {
                  course_id: course_id,
                  department_id: target_id,
                  assignment_type: assignment_type,
                  target_type: target_type,
                  status: EnrollmentStatus.IN_PROGRESS,
                  progress: 0,
                  due_date: due_date || null
                }
              });

              results.push({ success: true, id: created.id, assignment });

              audits.push({
                user_id: user_id,
                action: 'Assigned course to department',
                target_id: created.id,
                target_type: 'ENROLLMENT',
                details: JSON.stringify({ assignment_type, course_id, department_id: target_id, due_date })
              });
            }
          } else if (assignment_type === 'TRAINING_PATH') {
            const pathExists = await tx.trainingPath.findUnique({
              where: { id: path_id },
              select: { id: true }
            });

            if (!pathExists) {
              throw new HttpError(404, `Training path with ID ${path_id} not found`);
            }

            if (target_type === 'USER') {
              const userExists = await tx.user.findUnique({
                where: { id: target_id },
                select: { id: true }
              });

              if (!userExists) {
                throw new HttpError(404, `User with ID ${target_id} not found`);
              }

              const created = await tx.enrollment.create({
                data: {
                  path_id: path_id,
                  user_id: target_id,
                  assignment_type: assignment_type,
                  target_type: target_type,
                  status: EnrollmentStatus.IN_PROGRESS,
                  progress: 0,
                  due_date: due_date || null
                }
              });

              results.push({ success: true, id: created.id, assignment });

              audits.push({
                user_id: user_id,
                action: 'Assigned training path to user',
                target_id: created.id,
                target_type: 'ENROLLMENT',
                details: JSON.stringify({ assignment_type, path_id, user_id: target_id, due_date })
              });
            } else if (target_type === 'DEPARTMENT') {
              const deptExists = await tx.department.findUnique({
                where: { id: target_id },
                select: { id: true }
              });

              if (!deptExists) {
                throw new HttpError(404, `Department with ID ${target_id} not found`);
              }

              const created = await tx.enrollment.create({
                data: {
                  path_id: path_id,
                  department_id: target_id,
                  assignment_type: assignment_type,
                  target_type: target_type,
                  status: EnrollmentStatus.IN_PROGRESS,
                  progress: 0,
                  due_date: due_date || null
                }
              });

              results.push({ success: true, id: created.id, assignment });

              audits.push({
                user_id: user_id,
                action: 'Assigned training path to department',
                target_id: created.id,
                target_type: 'ENROLLMENT',
                details: JSON.stringify({ assignment_type, path_id, department_id: target_id, due_date })
              });
            }
          }
        } catch (assignmentError: any) {
          if (assignmentError instanceof HttpError) {
            throw assignmentError;
          }
          console.error('Error processing assignment:', assignmentError);
          console.error('Assignment that failed:', JSON.stringify(assignment, null, 2));
          console.error('Stack trace:', assignmentError?.stack);
          results.push({
            success: false,
            message: `Failed to process assignment: ${assignmentError?.message || assignmentError}`,
            assignment
          });
        }
      }

      for (const audit of audits) {
        try {
          await tx.$executeRaw`
            INSERT INTO audit_logs (user_id, action, target_id, target_type, details, created_at)
            VALUES (${audit.user_id}, ${audit.action}, ${audit.target_id}, ${audit.target_type}, ${audit.details}, NOW())
          `;
        } catch (auditError) {
          console.error('Error inserting audit log:', auditError);
        }
      }
    });

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.status(200).json({
      message: `Successfully created ${successCount} assignments${failureCount > 0 ? ` (${failureCount} failed)` : ''}`,
      results,
      created_count: successCount
    });
  } catch (error: any) {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    console.error('Error creating batch enrollments:', error);
    res.status(500).json({ message: 'Failed to create assignments' });
  }
};

/**
 * Create a single enrollment
 * @route POST /api/enrollments
 */
export const createEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const current_user_id = req.user?.user_id;
    const { course_id, user_id, due_date } = req.body;

    if (!course_id || !user_id) {
      res.status(400).json({ message: 'Course ID and User ID are required' });
      return;
    }

    const courseExists = await prisma.course.findUnique({
      where: { id: course_id },
      select: { id: true }
    });

    if (!courseExists) {
      res.status(404).json({ message: 'Course not found' });
      return;
    }

    const userExists = await prisma.user.findUnique({
      where: { id: user_id },
      select: { id: true }
    });

    if (!userExists) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const created = await prisma.enrollment.create({
      data: {
        course_id: course_id,
        user_id: user_id,
        status: EnrollmentStatus.IN_PROGRESS,
        progress: 0,
        due_date: due_date || null
      }
    });

    await prisma.$executeRaw`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${user_id}, ${'Created enrollment'}, ${created.id}, ${'ENROLLMENT'}, ${JSON.stringify({ course_id, user_id, due_date })})
    `;

    res.status(201).json({
      message: 'Enrollment created successfully',
      id: created.id
    });
  } catch (error) {
    console.error('Error creating enrollment:', error);
    res.status(500).json({ message: 'Failed to create enrollment' });
  }
};

/**
 * Cancel an enrollment
 * @route DELETE /api/enrollments/:id
 */
export const cancelEnrollment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user_id = req.user?.user_id;

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        e.id, e.course_id, e.path_id, e.user_id, e.department_id,
        e.assignment_type, e.target_type, e.status, e.progress,
        e.due_date, e.created_at,
        c.course_name,
        tp.path_name,
        u.username as user_name,
        d.department_name,
        CASE
          WHEN e.target_type = 'USER' THEN u.username
          WHEN e.target_type = 'DEPARTMENT' THEN d.department_name
          ELSE 'Unknown'
        END as target_name
      FROM enrollments e
      LEFT JOIN courses c ON e.course_id = c.id
      LEFT JOIN training_paths tp ON e.path_id = tp.id
      LEFT JOIN users u ON e.user_id = u.id
      LEFT JOIN departments d ON e.department_id = d.id
      WHERE e.id = ${Number(id)}
    `);

    if (rows.length === 0) {
      res.status(404).json({ message: 'Enrollment not found' });
      return;
    }

    const enrollment = rows[0];

    if (enrollment.status === EnrollmentStatus.COMPLETED) {
      res.status(400).json({ message: 'Cannot cancel a completed enrollment' });
      return;
    }

    await prisma.enrollment.delete({ where: { id: Number(id) } });

    const auditDetails: any = {
      assignment_type: enrollment.assignment_type,
      target_type: enrollment.target_type
    };

    if (enrollment.assignment_type === 'COURSE') {
      auditDetails.course_id = enrollment.course_id;
      auditDetails.course_name = enrollment.course_name;
    } else if (enrollment.assignment_type === 'TRAINING_PATH') {
      auditDetails.path_id = enrollment.path_id;
      auditDetails.path_name = enrollment.path_name;
    }

    if (enrollment.target_type === 'USER') {
      auditDetails.user_id = enrollment.user_id;
      auditDetails.user_name = enrollment.user_name;
    } else if (enrollment.target_type === 'DEPARTMENT') {
      auditDetails.department_id = enrollment.department_id;
      auditDetails.department_name = enrollment.department_name;
    }

    await prisma.$executeRaw`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details, created_at)
      VALUES (${user_id}, ${'Cancelled assignment'}, ${Number(id)}, ${'ENROLLMENT'}, ${JSON.stringify(auditDetails)}, NOW())
    `;

    const assignmentDescription = enrollment.assignment_type === 'COURSE'
      ? `course "${enrollment.course_name || enrollment.course_id}"`
      : `training path "${enrollment.path_name || enrollment.path_id}"`;

    const targetDescription = enrollment.target_type === 'USER'
      ? `user "${enrollment.user_name || enrollment.user_id}"`
      : `department "${enrollment.department_name || enrollment.department_id}"`;

    res.status(200).json({
      success: true,
      message: `Successfully cancelled assignment of ${assignmentDescription} to ${targetDescription}`
    });
  } catch (error) {
    console.error('Error cancelling enrollment:', error);
    res.status(500).json({ message: 'Failed to cancel enrollment' });
  }
};
