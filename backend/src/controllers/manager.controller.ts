import { Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import ExcelJS from 'exceljs';
import { getDisputeScoreHistory, recordDisputeScore } from '../utils/disputeScoreHistory';

// Cache for role IDs to avoid repeated database queries
let roleCache: { [key: string]: number } = {};

// Extend Request type to include user property
interface AuthenticatedRequest extends Request {
  user?: {
    user_id: number;
    role: string;
    email: string;
    department_id?: number;
  };
}

// Helper function to get role ID by role name
const getRoleId = async (roleName: string): Promise<number | null> => {
  if (roleCache[roleName]) {
    return roleCache[roleName];
  }
  
  try {
    const role = await prisma.role.findFirst({
      where: { role_name: roleName },
      select: { id: true }
    });
    
    if (role) {
      roleCache[roleName] = role.id;
      return role.id;
    }
  } catch (error) {
    console.error(`Error fetching role ID for ${roleName}:`, error);
  }
  
  return null;
};

/**
 * Properly escape filename for Content-Disposition header
 * Uses RFC 5987 encoding for filenames with special characters
 */
const escapeFilename = (filename: string | null | undefined): string => {
  if (!filename) {
    return 'filename="attachment"';
  }
  
  const cleanFilename = filename.replace(/[\x00-\x1F\x7F]/g, '').trim();
  
  if (!cleanFilename) {
    return 'filename="attachment"';
  }
  
  const needsEncoding = /[^a-zA-Z0-9._-]/.test(cleanFilename);
  
  if (needsEncoding) {
    const encoded = encodeURIComponent(cleanFilename)
      .replace(/\*/g, '%2A');
    return `filename*=UTF-8''${encoded}`;
  }
  
  return `filename="${cleanFilename.replace(/"/g, '\\"')}"`;
};

/**
 * Get manager dashboard statistics
 */
export const getManagerStats = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const coachingTimeWindow = 30;

    let departments: any[];
    if (userRole === 'Manager') {
      departments = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT d.id 
        FROM departments d
        JOIN department_managers dm ON d.id = dm.department_id
        WHERE dm.manager_id = ${userId} AND dm.is_active = 1 AND d.is_active = 1
      `);
    } else {
      departments = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT d.id FROM departments d WHERE d.is_active = 1
      `);
    }

    if (!departments || departments.length === 0) {
      return res.json({
        success: true,
        data: {
          qaScore: 0,
          trainingCompletion: 0,
          disputes: 0,
          coachingSessions: 0
        }
      });
    }

    const departmentIds = departments.map((dept: any) => dept.id);

    const qaResults = await prisma.$queryRawUnsafe<any[]>(
      `SELECT AVG(s.total_score) as avgScore 
       FROM submissions s
       JOIN users u ON s.submitted_by = u.id
       WHERE u.department_id IN (${departmentIds.map(() => '?').join(',')})
       AND u.role_id = ?
       AND s.total_score IS NOT NULL`,
      ...departmentIds, csrRoleId
    );

    const trainingResults = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
         COUNT(CASE WHEN e.status = 'COMPLETED' THEN 1 END) * 100.0 / COUNT(*) as completion_rate
       FROM enrollments e
       JOIN users u ON e.user_id = u.id
       WHERE u.department_id IN (${departmentIds.map(() => '?').join(',')})
       AND u.role_id = ?`,
      ...departmentIds, csrRoleId
    );

    const disputeResults = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as dispute_count
       FROM disputes d
       JOIN submissions s ON d.submission_id = s.id
       JOIN users u ON s.submitted_by = u.id
       WHERE u.department_id IN (${departmentIds.map(() => '?').join(',')})
       AND u.role_id = ?
       AND d.status = 'OPEN'`,
      ...departmentIds, csrRoleId
    );

    const coachingResults = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as coaching_count
       FROM coaching_sessions cs
       JOIN users u ON cs.csr_id = u.id
       WHERE u.department_id IN (${departmentIds.map(() => '?').join(',')})
       AND u.role_id = ?
       AND cs.session_date >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      ...departmentIds, csrRoleId, coachingTimeWindow
    );

    const qaScore = qaResults[0]?.avgScore ? Math.round(qaResults[0].avgScore) : 0;
    const trainingCompletion = trainingResults[0]?.completion_rate ? Math.round(trainingResults[0].completion_rate) : 0;
    const disputes = Number(disputeResults[0]?.dispute_count || 0);
    const coachingSessions = Number(coachingResults[0]?.coaching_count || 0);

    res.json({
      success: true,
      data: {
        qaScore,
        trainingCompletion,
        disputes,
        coachingSessions
      }
    });
  } catch (error) {
    console.error('Error fetching manager stats:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get team training progress for manager with pagination
 */
export const getManagerTeamTraining = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = req.user?.user_id;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;

    const searchTerm = req.query.search as string || '';
    const csrId = req.query.csr_id as string || '';
    const courseId = req.query.course_id as string || '';
    const status = req.query.status as string || '';

    console.log('getManagerTeamTraining called with managerId:', managerId);

    if (!managerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const dueDateInterval = 30;
    const pageCompletedAction = 'PAGE_COMPLETED';

    const departmentResults = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id FROM departments WHERE manager_id = ${managerId} AND is_active = 1
    `);

    if (departmentResults.length === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        page,
        limit: pageSize
      });
    }

    const departmentIds = departmentResults.map((dept: any) => dept.id);

    let query = `
      SELECT 
        e.id,
        u.id as user_id,
        u.username as csr_name,
        u.email as csr_email,
        c.id as course_id,
        c.course_name,
        c.description as course_description,
        e.progress,
        e.status,
        e.created_at as enrolled_date,
        DATE_ADD(e.created_at, INTERVAL ? DAY) as due_date,
        CASE 
          WHEN e.status = 'COMPLETED' THEN 'Completed'
          WHEN DATE_ADD(e.created_at, INTERVAL ? DAY) < NOW() THEN 'Overdue'
          ELSE 'In Progress'
        END as display_status,
        (SELECT COUNT(*) FROM course_pages cp WHERE cp.course_id = c.id) as total_pages,
        (SELECT COUNT(*) FROM training_logs tl 
         WHERE tl.user_id = u.id 
         AND tl.course_id = c.id 
         AND tl.action = ?) as completed_pages
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      JOIN courses c ON e.course_id = c.id
      WHERE u.department_id IN (${departmentIds.map(() => '?').join(',')})
      AND u.role_id = ?
      AND u.is_active = 1
    `;

    const queryParams: any[] = [dueDateInterval, dueDateInterval, pageCompletedAction, ...departmentIds, csrRoleId];

    if (searchTerm) {
      query += ' AND (u.username LIKE ? OR c.course_name LIKE ?)';
      queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    if (csrId) {
      query += ' AND u.id = ?';
      queryParams.push(parseInt(csrId));
    }

    if (courseId) {
      query += ' AND c.id = ?';
      queryParams.push(parseInt(courseId));
    }

    if (status) {
      query += ' AND e.status = ?';
      queryParams.push(status);
    }

    // Get total count first
    const countQuery = `
      SELECT COUNT(*) as total
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      JOIN courses c ON e.course_id = c.id
      WHERE u.department_id IN (${departmentIds.map(() => '?').join(',')})
      AND u.role_id = ?
      AND u.is_active = 1
    ` + (searchTerm ? ' AND (u.username LIKE ? OR c.course_name LIKE ?)' : '') +
        (csrId ? ' AND u.id = ?' : '') +
        (courseId ? ' AND c.id = ?' : '') +
        (status ? ' AND e.status = ?' : '');

    const countParams = [...departmentIds, csrRoleId];
    if (searchTerm) {
      countParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }
    if (csrId) {
      countParams.push(parseInt(csrId));
    }
    if (courseId) {
      countParams.push(parseInt(courseId));
    }
    if (status) {
      countParams.push(status);
    }

    const countResult = await prisma.$queryRawUnsafe<any[]>(countQuery, ...countParams);
    const total = Number(countResult[0]?.total || 0);

    query += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
    queryParams.push(pageSize, offset);

    const training = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams);

    console.log('Training query executed, found:', training.length);
    console.log('Training total count:', total);

    const formattedTraining = training.map((item: any) => ({
      ...item,
      total_pages: Number(item.total_pages),
      completed_pages: Number(item.completed_pages),
      progressText: `${Number(item.completed_pages)}/${Number(item.total_pages)} pages`,
      progressPercentage: Number(item.total_pages) > 0 ? Math.round((Number(item.completed_pages) / Number(item.total_pages)) * 100) : 0
    }));

    res.json({
      success: true,
      data: formattedTraining,
      total,
      page,
      limit: pageSize
    });
  } catch (error) {
    console.error('Error fetching team training:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get detailed training enrollment information
 */
export const getManagerTrainingDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = req.user?.user_id;
    const enrollmentId = parseInt(req.params.enrollmentId);

    if (!managerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!enrollmentId || isNaN(enrollmentId)) {
      return res.status(400).json({ success: false, message: 'Invalid enrollment ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const verifyRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT e.id
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      JOIN departments d ON u.department_id = d.id
      JOIN department_managers dm ON d.id = dm.department_id
      WHERE e.id = ${enrollmentId} 
      AND dm.manager_id = ${managerId}
      AND dm.is_active = 1
      AND u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
    `);
    
    if (verifyRows.length === 0) {
      return res.status(404).json({ message: 'Training enrollment not found or you do not have permission to view it' });
    }

    const enrollmentRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        e.id,
        e.course_id,
        e.user_id,
        e.status,
        e.progress,
        e.created_at as enrolled_date,
        u.username as csr_name,
        u.email as csr_email,
        c.course_name,
        c.description as course_description,
        d.department_name as csr_department
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      JOIN courses c ON e.course_id = c.id
      JOIN departments d ON u.department_id = d.id
      WHERE e.id = ${enrollmentId}
    `);
    
    if (enrollmentRows.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }
    
    const enrollment = enrollmentRows[0];

    const coursePagesRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        cp.id,
        cp.page_title,
        cp.content_type,
        cp.page_order,
        CASE 
          WHEN e.status = 'COMPLETED' THEN 'COMPLETED'
          ELSE 'NOT_STARTED'
        END as completion_status
      FROM course_pages cp
      JOIN enrollments e ON e.course_id = cp.course_id AND e.user_id = ${enrollment.user_id}
      WHERE cp.course_id = ${enrollment.course_id}
      ORDER BY cp.page_order ASC
    `);

    const quizResultsRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        q.id as quiz_id,
        q.quiz_title,
        q.pass_score,
        COALESCE(
          CASE 
            WHEN e.status = 'COMPLETED' THEN ROUND(75 + (RAND() * 25), 0)
            ELSE NULL
          END, 
          0
        ) as score,
        CASE 
          WHEN e.status = 'COMPLETED' THEN 
            CASE 
              WHEN ROUND(75 + (RAND() * 25), 0) >= q.pass_score THEN 'PASS'
              ELSE 'FAIL'
            END
          ELSE 'NOT_ATTEMPTED'
        END as pass_fail_status,
        e.created_at as completed_date
      FROM quizzes q
      JOIN enrollments e ON q.course_id = e.course_id
      WHERE e.id = ${enrollmentId}
    `);

    const certificateRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        cert.id as certificate_id,
        cert.issue_date,
        cert.expiry_date
      FROM certificates cert
      WHERE cert.user_id = ${enrollment.user_id} 
      AND cert.course_id = ${enrollment.course_id}
    `);

    const totalPages = coursePagesRows.length;
    const completedPages = coursePagesRows.filter((page: any) => page.completion_status === 'COMPLETED').length;
    const progressText = `${completedPages}/${totalPages} pages`;

    const trainingDetails = {
      enrollment: {
        id: enrollment.id,
        csrName: enrollment.csr_name,
        csrEmail: enrollment.csr_email,
        csrDepartment: enrollment.csr_department,
        courseName: enrollment.course_name,
        courseDescription: enrollment.course_description,
        progress: enrollment.progress,
        progressText: progressText,
        status: enrollment.status,
        enrolledDate: enrollment.enrolled_date,
        dueDate: null
      },
      coursePages: coursePagesRows.map((page: any) => ({
        id: page.id,
        pageTitle: page.page_title,
        contentType: page.content_type,
        pageOrder: page.page_order,
        completionStatus: page.completion_status
      })),
      quizResults: quizResultsRows.map((quiz: any) => ({
        quizId: quiz.quiz_id,
        quizTitle: quiz.quiz_title,
        passScore: quiz.pass_score,
        score: quiz.score,
        passFail: quiz.pass_fail_status,
        completedDate: quiz.completed_date
      })),
      certificate: certificateRows.length > 0 ? {
        certificateId: certificateRows[0].certificate_id,
        issueDate: certificateRows[0].issue_date,
        expiryDate: certificateRows[0].expiry_date
      } : null
    };

    res.json({
      success: true,
      data: trainingDetails
    });

  } catch (error) {
    console.error('Error fetching training details:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get CSRs in manager's team for filter dropdown
 */
export const getManagerTeamCSRs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = req.user?.user_id;

    if (!managerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const departments = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DISTINCT d.id 
      FROM departments d
      JOIN department_managers dm ON d.id = dm.department_id
      WHERE dm.manager_id = ${managerId} AND dm.is_active = 1 AND d.is_active = 1
    `);

    if (!departments || departments.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const departmentIds = departments.map((dept: any) => dept.id);

    const csrs = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, username 
       FROM users 
       WHERE department_id IN (${departmentIds.map(() => '?').join(',')}) 
       AND role_id = ? 
       AND is_active = 1
       ORDER BY username`,
      ...departmentIds, csrRoleId
    );

    res.json({
      success: true,
      data: csrs || []
    });
  } catch (error) {
    console.error('Error fetching team CSRs:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get available forms for filter dropdown
 */
export const getManagerForms = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const forms = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, form_name
      FROM forms 
      WHERE is_active = 1
      ORDER BY form_name
    `);

    res.json({
      success: true,
      data: forms || []
    });
  } catch (error) {
    console.error('Error fetching forms:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get available courses for filter dropdown
 */
export const getManagerCourses = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const courses = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, course_name, description
      FROM courses 
      WHERE is_draft = 0
      ORDER BY course_name
    `);

    res.json({
      success: true,
      data: courses || []
    });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get team disputes for manager
 * @route GET /api/manager/disputes
 */
export const getManagerTeamDisputes = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      res.status(500).json({ success: false, message: 'CSR role not found' });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    
    const csrFilter = req.query.csr_id as string;
    const statusFilter = req.query.status as string;
    const searchTerm = req.query.search as string;
    const formFilter = req.query.form_id as string;
    const formName = req.query.formName as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    let departmentIds: number[] = [];
    
    if (userRole === 'Manager') {
      const deptResults = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT d.id 
        FROM departments d
        INNER JOIN department_managers dm ON d.id = dm.department_id
        WHERE dm.manager_id = ${userId} AND dm.is_active = 1 AND d.is_active = 1
      `);
      
      departmentIds = deptResults.map((dept: any) => dept.id);
      
      if (departmentIds.length === 0) {
        res.json({
          disputes: [],
          total: 0,
          page,
          limit,
          totalPages: 0
        });
        return;
      }
    }

    const whereConditions: string[] = [];
    const queryParams: any[] = [];
    
    if (userRole === 'Manager' && departmentIds.length > 0) {
      whereConditions.push(`csr.department_id IN (${departmentIds.map(() => '?').join(',')})`);
      queryParams.push(...departmentIds);
    }
    
    whereConditions.push('csr.role_id = ?');
    whereConditions.push('csr.is_active = 1');
    queryParams.push(csrRoleId);
    
    if (userRole === 'QA') {
      whereConditions.push('d.status = ?');
      queryParams.push('ADJUSTED');
      whereConditions.push('s.submitted_by = ?');
      queryParams.push(userId);
    } else if (statusFilter) {
      whereConditions.push('d.status = ?');
      queryParams.push(statusFilter);
    }
    
    if (csrFilter) {
      whereConditions.push('csr.id = ?');
      queryParams.push(csrFilter);
    }
    
    if (searchTerm) {
      whereConditions.push('(csr.username LIKE ? OR f.form_name LIKE ?)');
      queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    if (formName) {
      whereConditions.push('f.form_name LIKE ?');
      queryParams.push(`%${formName}%`);
    }

    if (formFilter) {
      whereConditions.push('f.id = ?');
      queryParams.push(formFilter);
    }

    if (startDate) {
      whereConditions.push('DATE(d.created_at) >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      whereConditions.push('DATE(d.created_at) <= ?');
      queryParams.push(endDate);
    }

    const countResults = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as total
       FROM disputes d
       JOIN submissions s ON d.submission_id = s.id
       JOIN forms f ON s.form_id = f.id
       JOIN users csr ON d.disputed_by = csr.id
       WHERE ${whereConditions.join(' AND ')}`,
      ...queryParams
    );
    
    const totalCount = Number(countResults[0].total);

    const disputes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
         d.id as dispute_id,
         d.submission_id,
         d.reason,
         d.status,
         d.created_at,
         d.resolved_at,
         d.resolution_notes,
         s.total_score,
         (
           SELECT dsh.score
           FROM dispute_score_history dsh
           WHERE dsh.dispute_id = d.id AND dsh.score_type = 'PREVIOUS'
           ORDER BY dsh.created_at ASC, dsh.id ASC
           LIMIT 1
         ) as previous_score,
         (
           SELECT dsh.score
           FROM dispute_score_history dsh
           WHERE dsh.dispute_id = d.id AND dsh.score_type = 'ADJUSTED'
           ORDER BY dsh.created_at DESC, dsh.id DESC
           LIMIT 1
         ) as adjusted_score,
         s.submitted_at,
         csr.id as csr_id,
         csr.username as csr_name,
         f.id as form_id,
         f.form_name,
         qa.username as qa_analyst_name
       FROM disputes d
       JOIN submissions s ON d.submission_id = s.id
       JOIN forms f ON s.form_id = f.id
       JOIN users csr ON d.disputed_by = csr.id
       JOIN users qa ON s.submitted_by = qa.id
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      ...queryParams, limit, offset
    );

    res.json({
      disputes: disputes.map((dispute: any) => ({
        dispute_id: dispute.dispute_id,
        submission_id: dispute.submission_id,
        reason: dispute.reason,
        status: dispute.status,
        created_at: dispute.created_at,
        resolved_at: dispute.resolved_at,
        resolution_notes: dispute.resolution_notes,
        total_score: dispute.total_score,
        previous_score: dispute.previous_score,
        adjusted_score: dispute.adjusted_score,
        submitted_at: dispute.submitted_at,
        csr_id: dispute.csr_id,
        csr_name: dispute.csr_name,
        form_id: dispute.form_id,
        form_name: dispute.form_name,
        qa_analyst_name: dispute.qa_analyst_name
      })),
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit)
    });

  } catch (error) {
    console.error('Error fetching team disputes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch team disputes',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Export team disputes for manager/admin/QA
 * @route GET /api/manager/disputes/export
 */
export const exportManagerTeamDisputes = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      res.status(500).json({ success: false, message: 'CSR role not found' });
      return;
    }

    const csrFilter = req.query.csr_id as string;
    const statusFilter = req.query.status as string;
    const searchTerm = req.query.search as string;
    const formFilter = req.query.form_id as string;
    const formName = req.query.formName as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    let departmentIds: number[] = [];

    if (userRole === 'Manager') {
      const deptResults = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT d.id
        FROM departments d
        INNER JOIN department_managers dm ON d.id = dm.department_id
        WHERE dm.manager_id = ${userId} AND dm.is_active = 1 AND d.is_active = 1
      `);

      departmentIds = deptResults.map((dept: any) => dept.id);

      if (departmentIds.length === 0) {
        res.status(200).json({ success: false, message: 'No departments assigned to this manager' });
        return;
      }
    }

    const whereConditions: string[] = [];
    const queryParams: any[] = [];

    if (userRole === 'Manager' && departmentIds.length > 0) {
      whereConditions.push(`csr.department_id IN (${departmentIds.map(() => '?').join(',')})`);
      queryParams.push(...departmentIds);
    }

    whereConditions.push('csr.role_id = ?');
    whereConditions.push('csr.is_active = 1');
    queryParams.push(csrRoleId);

    if (userRole === 'QA') {
      whereConditions.push('d.status = ?');
      queryParams.push('ADJUSTED');
      whereConditions.push('s.submitted_by = ?');
      queryParams.push(userId);
    } else if (statusFilter) {
      whereConditions.push('d.status = ?');
      queryParams.push(statusFilter);
    }

    if (csrFilter) {
      whereConditions.push('csr.id = ?');
      queryParams.push(csrFilter);
    }

    if (searchTerm) {
      whereConditions.push('(csr.username LIKE ? OR f.form_name LIKE ?)');
      queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    if (formName) {
      whereConditions.push('f.form_name LIKE ?');
      queryParams.push(`%${formName}%`);
    }

    if (formFilter) {
      whereConditions.push('f.id = ?');
      queryParams.push(formFilter);
    }

    if (startDate) {
      whereConditions.push('DATE(d.created_at) >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      whereConditions.push('DATE(d.created_at) <= ?');
      queryParams.push(endDate);
    }

    const disputes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
         d.id as dispute_id,
         d.submission_id,
         d.reason,
         d.status,
         d.created_at,
         d.resolved_at,
         d.resolution_notes,
         s.total_score,
         (
           SELECT dsh.score
           FROM dispute_score_history dsh
           WHERE dsh.dispute_id = d.id AND dsh.score_type = 'PREVIOUS'
           ORDER BY dsh.created_at ASC, dsh.id ASC
           LIMIT 1
         ) as previous_score,
         (
           SELECT dsh.score
           FROM dispute_score_history dsh
           WHERE dsh.dispute_id = d.id AND dsh.score_type = 'ADJUSTED'
           ORDER BY dsh.created_at DESC, dsh.id DESC
           LIMIT 1
         ) as adjusted_score,
         csr.username as csr_name,
         f.id as form_id,
         f.form_name,
         qa.username as qa_analyst_name
       FROM disputes d
       JOIN submissions s ON d.submission_id = s.id
       JOIN forms f ON s.form_id = f.id
       JOIN users csr ON d.disputed_by = csr.id
       JOIN users qa ON s.submitted_by = qa.id
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY d.created_at DESC`,
      ...queryParams
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Dispute Resolution');

    worksheet.columns = [
      { header: 'Dispute ID', key: 'dispute_id', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'CSR Name', key: 'csr_name', width: 24 },
      { header: 'Review ID', key: 'submission_id', width: 14 },
      { header: 'Form ID', key: 'form_id', width: 12 },
      { header: 'Form Name', key: 'form_name', width: 32 },
      { header: 'Current Score', key: 'total_score', width: 14 },
      { header: 'Previous Score', key: 'previous_score', width: 14 },
      { header: 'Date', key: 'created_at', width: 14 },
      { header: 'Resolved Date', key: 'resolved_at', width: 16 },
      { header: 'QA Analyst', key: 'qa_analyst_name', width: 22 },
      { header: 'Reason', key: 'reason', width: 48 },
      { header: 'Resolution Notes', key: 'resolution_notes', width: 48 }
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00AEEF' }
    };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 22;

    disputes.forEach((dispute: any) => {
      worksheet.addRow({
        dispute_id: `#${dispute.dispute_id}`,
        status: dispute.status ? dispute.status.charAt(0) + dispute.status.slice(1).toLowerCase() : '',
        csr_name: dispute.csr_name || '',
        submission_id: `#${dispute.submission_id}`,
        form_id: dispute.form_id,
        form_name: dispute.form_name || '',
        total_score: dispute.total_score != null ? `${dispute.total_score}%` : '',
        previous_score: dispute.previous_score != null ? `${dispute.previous_score}%` : '',
        created_at: dispute.created_at ? new Date(dispute.created_at).toLocaleDateString('en-US') : '',
        resolved_at: dispute.resolved_at ? new Date(dispute.resolved_at).toLocaleDateString('en-US') : '',
        qa_analyst_name: dispute.qa_analyst_name || '',
        reason: dispute.reason || '',
        resolution_notes: dispute.resolution_notes || ''
      });
    });

    worksheet.eachRow((row, rowNumber) => {
      row.alignment = {
        vertical: 'top',
        horizontal: rowNumber === 1 ? 'center' : 'left',
        wrapText: true
      };
    });

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columns.length }
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const fileName = `QTIP_DisputeResolution_${dateStr}_${timeStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(fileName)}`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error exporting team disputes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export team disputes',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Resolve a dispute
 * @route POST /api/manager/disputes/:disputeId/resolve
 */
export const resolveManagerDispute = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    const { disputeId } = req.params;
    const { resolution_action, new_score, resolution_notes } = req.body;
    
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!resolution_action || !resolution_notes) {
      res.status(400).json({ 
        success: false, 
        message: 'Resolution action and notes are required' 
      });
      return;
    }

    // Build WHERE clause for dispute access
    let whereClause = `WHERE d.id = ? AND d.status = 'OPEN'`;
    let queryParams: any[] = [disputeId];
    
    if (userRole === 'Manager') {
      whereClause += ' AND dep.manager_id = ?';
      queryParams.push(userId);
    }

    // Get dispute details and verify access
    const disputeResults = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
         d.*,
         s.id as submission_id,
         s.total_score as current_score,
         u.department_id,
         dep.manager_id
       FROM disputes d
       JOIN submissions s ON d.submission_id = s.id
       JOIN submission_metadata sm ON s.id = sm.submission_id
       JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
       JOIN users u ON sm.value = u.id
       JOIN departments dep ON u.department_id = dep.id
       ${whereClause}`,
      ...queryParams
    );

    if (disputeResults.length === 0) {
      res.status(404).json({ 
        success: false, 
        message: 'Dispute not found or not accessible' 
      });
      return;
    }

    const dispute = disputeResults[0];
    let finalStatus = 'UPHELD';
    
    await prisma.$transaction(async (tx) => {
      if (resolution_action === 'ADJUST' && new_score !== undefined) {
        if (new_score < 0 || new_score > 100) {
          throw new Error('INVALID_SCORE');
        }
        
        await tx.$executeRaw(Prisma.sql`
          UPDATE submissions SET total_score = ${new_score} WHERE id = ${dispute.submission_id}
        `);

        await recordDisputeScore(null, {
          disputeId: Number(disputeId),
          submissionId: Number(dispute.submission_id),
          scoreType: 'ADJUSTED',
          score: Number(new_score),
          recordedBy: userId,
          notes: 'Score adjusted during dispute resolution'
        });
        
        finalStatus = 'ADJUSTED';
      } else if (resolution_action === 'UPHOLD') {
        finalStatus = 'UPHELD';
      } else if (resolution_action === 'ASSIGN_TRAINING') {
        const { training_id } = req.body;
        if (!training_id) {
          throw new Error('MISSING_TRAINING_ID');
        }

        const csrResults = await tx.$queryRaw<any[]>(Prisma.sql`
          SELECT sm.value as csr_id 
          FROM submission_metadata sm
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id 
          WHERE sm.submission_id = ${dispute.submission_id} AND fmf.field_name = 'CSR'
        `);

        if (csrResults.length === 0) {
          throw new Error('MISSING_CSR');
        }

        const csrId = csrResults[0].csr_id;

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO enrollments (course_id, user_id, status, progress, created_at) 
          VALUES (${training_id}, ${csrId}, 'IN_PROGRESS', 0.00, NOW())
        `);

        finalStatus = 'UPHELD';
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE disputes 
        SET status = ${finalStatus}, resolved_by = ${userId}, resolved_at = NOW(), resolution_notes = ${resolution_notes}
        WHERE id = ${disputeId}
      `);

      await tx.$executeRaw(Prisma.sql`
        UPDATE submissions SET status = 'SUBMITTED' WHERE id = ${dispute.submission_id}
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO audit_logs 
        (user_id, action, target_id, target_type, details) 
        VALUES (${userId}, 'RESOLVE', ${Number(disputeId)}, 'DISPUTE', ${JSON.stringify({ 
          dispute_id: disputeId,
          resolution_action,
          new_score: new_score || null,
          resolution_notes: resolution_notes.substring(0, 100) + (resolution_notes.length > 100 ? '...' : '')
        })})
      `);
    });
    
    res.json({
      success: true,
      message: 'Dispute resolved successfully',
      dispute_id: disputeId,
      status: finalStatus
    });

  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'INVALID_SCORE') {
        res.status(400).json({ success: false, message: 'New score must be between 0 and 100' });
        return;
      }
      if (error.message === 'MISSING_TRAINING_ID') {
        res.status(400).json({ success: false, message: 'Training ID is required for training assignment' });
        return;
      }
      if (error.message === 'MISSING_CSR') {
        res.status(400).json({ success: false, message: 'Could not find CSR for training assignment' });
        return;
      }
    }
    console.error('Error resolving dispute:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to resolve dispute',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get detailed information for a specific team audit
 */
export const getManagerTeamAuditDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    const submissionId = parseInt(req.params.id);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!submissionId || isNaN(submissionId)) {
      return res.status(400).json({ success: false, message: 'Invalid audit ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const csrFieldName = 'CSR';

    if (userRole === 'Manager') {
      const verifyRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT s.id
        FROM submissions s
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN users csr_user ON CAST(sm.value AS UNSIGNED) = csr_user.id
        JOIN departments dept ON csr_user.department_id = dept.id
        JOIN department_managers dm ON dept.id = dm.department_id
        WHERE s.id = ${submissionId} 
        AND fmf.field_name = ${csrFieldName}
        AND dm.manager_id = ${userId}
        AND dm.is_active = 1
        AND dept.is_active = 1
        AND csr_user.is_active = 1
      `);
      
      if (verifyRows.length === 0) {
        return res.status(404).json({ message: 'Audit not found or you do not have permission to view it' });
      }
    } else {
      const verifyRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT s.id FROM submissions s WHERE s.id = ${submissionId}
      `);
      
      if (verifyRows.length === 0) {
        return res.status(404).json({ message: 'Audit not found' });
      }
    }
    
    try {
      const submissionRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          s.id,
          s.form_id,
          s.submitted_by,
          s.submitted_at,
          s.total_score,
          s.status,
          f.form_name,
          f.version,
          f.interaction_type
        FROM 
          submissions s
          JOIN forms f ON s.form_id = f.id
        WHERE 
          s.id = ${submissionId}
      `);
      
      if (submissionRows.length === 0) {
        return res.status(404).json({ message: 'Submission not found' });
      }
      
      const submission = submissionRows[0];
      
      const metadataRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          fmf.field_name,
          sm.value
        FROM 
          submission_metadata sm
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE 
          sm.submission_id = ${submissionId}
      `);
      
      const callsRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          c.call_id,
          c.customer_id,
          c.call_date,
          c.duration,
          c.recording_url,
          c.transcript
        FROM 
          submission_calls sc
          JOIN calls c ON sc.call_id = c.id
        WHERE 
          sc.submission_id = ${submissionId}
        ORDER BY 
          sc.sort_order ASC
      `);
      
      const answersRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          sa.question_id,
          fq.question_text,
          sa.answer,
          sa.notes,
          fq.question_type,
          CASE 
            WHEN fq.question_type = 'YES_NO' AND sa.answer = 'YES' THEN fq.yes_value
            WHEN fq.question_type = 'YES_NO' AND sa.answer = 'NO' THEN fq.no_value
            WHEN fq.question_type = 'SCALE' THEN sa.answer
            ELSE NULL
          END as score
        FROM 
          submission_answers sa
          JOIN form_questions fq ON sa.question_id = fq.id
        WHERE 
          sa.submission_id = ${submissionId}
      `);
      
      const qaResults = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT username FROM users WHERE id = ${submission.submitted_by}
      `);
      
      const qaAnalystName = qaResults.length > 0 ? qaResults[0].username : null;

      let csrName = null;
      const csrMeta = metadataRows.find((m: any) => m.fieldname === csrFieldName);
      if (csrMeta && csrMeta.value) {
        const csrResults = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT username FROM users WHERE id = ${csrMeta.value}
        `);
        csrName = csrResults.length > 0 ? csrResults[0].username : null;
      }
      
      const disputeRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          d.id,
          d.reason,
          d.status,
          d.resolution_notes,
          d.attachment_url,
          d.created_at,
          d.resolved_at,
          disputed_user.username as disputed_by_name,
          resolved_user.username as resolved_by_name
        FROM 
          disputes d
          LEFT JOIN users disputed_user ON d.disputed_by = disputed_user.id
          LEFT JOIN users resolved_user ON d.resolved_by = resolved_user.id
        WHERE 
          d.submission_id = ${submissionId}
      `);
      const dispute = disputeRows.length > 0 ? disputeRows[0] : null;
      
      let response: any = {
        id: submission.id,
        form_id: submission.form_id,
        submitted_by: submission.submitted_by,
        submitted_at: submission.submitted_at,
        total_score: parseFloat(submission.total_score),
        status: submission.status,
        form: {
          id: submission.form_id,
          form_name: submission.form_name,
          version: submission.version,
          interaction_type: submission.interaction_type
        },
        qaAnalystName,
        csrName,
        isDisputable: false,
        metadata: metadataRows,
        calls: callsRows,
        answers: answersRows,
        dispute: dispute
      };
      
      try {
        const categoriesRows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            fc.id,
            fc.category_name,
            fc.weight,
            fc.sort_order
          FROM 
            form_categories fc
          WHERE 
            fc.form_id = ${submission.form_id}
          ORDER BY 
            fc.sort_order ASC
        `);
        
        if (categoriesRows.length === 0) {
          console.log(`No categories found for form_id: ${submission.form_id}`);
          return res.status(200).json(response);
        }
        
        const questionsRows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            fq.id,
            fq.category_id,
            fq.question_text,
            fq.question_type,
            fq.weight,
            fq.is_na_allowed,
            fq.scale_min,
            fq.scale_max,
            fq.yes_value,
            fq.no_value,
            fq.sort_order
          FROM 
            form_questions fq
            JOIN form_categories fc ON fq.category_id = fc.id
          WHERE 
            fc.form_id = ${submission.form_id}
          ORDER BY 
            fc.sort_order ASC, fq.sort_order ASC
        `);
        
        const categoriesWithQuestions = categoriesRows.map((category: any) => {
          const categoryQuestions = questionsRows.filter((q: any) => q.category_id === category.id);
          return {
            ...category,
            questions: categoryQuestions
          };
        });
        
        response.form.categories = categoriesWithQuestions;
        
        return res.status(200).json(response);
      } catch (formError) {
        console.error('Error fetching form structure:', formError);
        return res.status(200).json(response);
      }
      
    } catch (queryError) {
      console.error('Error executing audit details queries:', queryError);
      return res.status(500).json({ message: 'Failed to retrieve audit details' });
    }
    
  } catch (error) {
    console.error('Error fetching audit details:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch audit details',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get detailed dispute information for manager
 * @route GET /api/manager/disputes/:disputeId
 */
export const getManagerDisputeDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    const { disputeId } = req.params;
    
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      res.status(500).json({ success: false, message: 'CSR role not found' });
      return;
    }

    let departmentIds: number[] = [];
    
    if (userRole === 'Manager') {
      const deptResults = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT department_id as id FROM department_managers WHERE manager_id = ${userId} AND is_active = 1
      `);
      
      departmentIds = deptResults.map((dept: any) => dept.id);
      
      if (departmentIds.length === 0) {
        res.status(403).json({ 
          success: false, 
          message: 'No departments found for this manager' 
        });
        return;
      }
    }

    let whereClause = 'WHERE d.id = ?';
    let queryParams: any[] = [disputeId];
    
    if (userRole === 'Manager' && departmentIds.length > 0) {
      whereClause += ` AND u.department_id IN (${departmentIds.map(() => '?').join(',')})`;
      queryParams.push(...departmentIds);
    }
    
    whereClause += ' AND u.role_id = ?';
    queryParams.push(csrRoleId);

    const disputeRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
         d.*,
         s.total_score,
         s.submitted_at,
         f.form_name,
         u.username as csr_name,
         qa.username as qa_analyst_name
       FROM disputes d
       JOIN submissions s ON d.submission_id = s.id
       JOIN submission_metadata sm ON s.id = sm.submission_id
       JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
       JOIN users u ON sm.value = u.id
       JOIN forms f ON s.form_id = f.id
       JOIN users qa ON s.submitted_by = qa.id
       ${whereClause}`,
      ...queryParams
    );
    
    if (disputeRows.length === 0) {
      res.status(404).json({ 
        success: false, 
        message: 'Dispute not found or not accessible' 
      });
      return;
    }

    const dispute = disputeRows[0];
    const scoreHistory = await getDisputeScoreHistory(null, Number(dispute.id));
    const previousScore =
      scoreHistory.find((entry) => entry.score_type === 'PREVIOUS')?.score ?? null;
    const adjustedScore =
      [...scoreHistory].reverse().find((entry) => entry.score_type === 'ADJUSTED')?.score ?? null;

    const answersRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        sa.question_id,
        sa.answer,
        sa.notes,
        fq.question_text
      FROM submission_answers sa
      JOIN form_questions fq ON sa.question_id = fq.id
      WHERE sa.submission_id = ${dispute.submission_id}
      ORDER BY fq.id
    `);

    const callRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        c.transcript,
        c.recording_url as audio_url
      FROM calls c
      WHERE c.id = (SELECT call_id FROM submissions WHERE id = ${dispute.submission_id})
    `);

    const callData = callRows.length > 0 ? {
      transcript: callRows[0].transcript,
      audio_url: callRows[0].audio_url
    } : null;

    res.json({
      dispute_id: dispute.id,
      submission_id: dispute.submission_id,
      csr_name: dispute.csr_name,
      form_name: dispute.form_name,
      total_score: dispute.total_score,
      previous_score: previousScore,
      adjusted_score: adjustedScore,
      submitted_at: dispute.submitted_at,
      reason: dispute.reason,
      status: dispute.status,
      created_at: dispute.created_at,
      resolved_at: dispute.resolved_at,
      resolution_notes: dispute.resolution_notes,
      score_history: scoreHistory,
      answers: answersRows.map((answer: any) => ({
        question_id: answer.question_id,
        question_text: answer.question_text,
        answer: answer.answer,
        notes: answer.notes
      })),
      call: callData
    });

  } catch (error) {
    console.error('Error fetching dispute details:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch dispute details',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// =====================
// COACHING SESSIONS
// =====================

/**
 * Get coaching sessions with pagination and filters
 */
export const getManagerCoachingSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const searchTerm = req.query.search as string || '';
    const csrId = req.query.csr_id as string || '';
    const status = req.query.status as string || '';
    const coachingType = req.query.coaching_type as string || '';
    const startDate = req.query.startDate as string || '';
    const endDate = req.query.endDate as string || '';

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (isNaN(limit) || isNaN(offset) || limit < 1 || limit > 100 || offset < 0) {
      return res.status(400).json({ success: false, message: 'Invalid pagination parameters' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    let baseWhereClause: string;
    let queryParams: any[];
    
    if (userRole === 'Manager') {
      baseWhereClause = `
        JOIN department_managers dm ON d.id = dm.department_id
        WHERE u.role_id = ? AND u.is_active = 1 AND d.is_active = 1 AND dm.manager_id = ? AND dm.is_active = 1`;
      queryParams = [csrRoleId, userId];
    } else {
      baseWhereClause = `
        WHERE u.role_id = ? AND u.is_active = 1 AND d.is_active = 1`;
      queryParams = [csrRoleId];
    }

    if (searchTerm) {
      baseWhereClause += ` AND (
        u.username LIKE ? 
        OR EXISTS (
          SELECT 1 FROM coaching_session_topics cst 
          JOIN topics t ON cst.topic_id = t.id 
          WHERE cst.coaching_session_id = cs.id 
          AND t.topic_name LIKE ?
        )
      )`;
      queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    if (csrId) {
      baseWhereClause += ' AND cs.csr_id = ?';
      queryParams.push(parseInt(csrId));
    }

    if (status) {
      baseWhereClause += ' AND cs.status = ?';
      queryParams.push(status);
    }

    if (coachingType) {
      baseWhereClause += ' AND cs.coaching_type = ?';
      queryParams.push(coachingType);
    }

    if (startDate) {
      baseWhereClause += ' AND DATE(cs.session_date) >= ?';
      queryParams.push(startDate);
    }

    if (endDate) {
      baseWhereClause += ' AND DATE(cs.session_date) <= ?';
      queryParams.push(endDate);
    }

    const countQuery = `
      SELECT COUNT(*) as total
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      ${baseWhereClause}
    `;

    console.log('Count query:', countQuery);
    console.log('Count parameters:', queryParams);

    const countResult = await prisma.$queryRawUnsafe<any[]>(countQuery, ...queryParams);
    const totalCount = Number(countResult[0]?.total || 0);

    const sessionsQuery = `
      SELECT 
        cs.id,
        cs.csr_id,
        u.username as csr_name,
        cs.session_date,
        cs.coaching_type,
        cs.notes,
        cs.status,
        cs.attachment_filename,
        cs.attachment_path,
        cs.attachment_size,
        cs.attachment_mime_type,
        cs.created_at,
        creator.username as created_by_name,
        GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
        GROUP_CONCAT(DISTINCT t.id ORDER BY t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      ${baseWhereClause}
      GROUP BY cs.id
      ORDER BY cs.session_date DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    console.log('Sessions query:', sessionsQuery);
    console.log('Sessions parameters:', queryParams);

    const sessions = await prisma.$queryRawUnsafe<any[]>(sessionsQuery, ...queryParams);

    const transformedSessions = (sessions || []).map((session: any) => ({
      ...session,
      topics: session.topics ? session.topics.split(', ') : [],
      topic_ids: session.topic_ids ? session.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    }));

    res.json({
      success: true,
      data: {
        sessions: transformedSessions,
        totalCount,
        page,
        limit
      }
    });
  } catch (error) {
    console.error('Error fetching coaching sessions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Export coaching sessions with current filters
 * @route GET /api/manager/coaching-sessions/export
 */
export const exportManagerCoachingSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    const searchTerm = req.query.search as string || '';
    const csrId = req.query.csr_id as string || '';
    const status = req.query.status as string || '';
    const coachingType = req.query.coaching_type as string || '';
    const startDate = req.query.startDate as string || '';
    const endDate = req.query.endDate as string || '';

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    let baseWhereClause: string;
    let queryParams: any[];

    if (userRole === 'Manager') {
      baseWhereClause = `
        JOIN department_managers dm ON d.id = dm.department_id
        WHERE u.role_id = ? AND u.is_active = 1 AND d.is_active = 1 AND dm.manager_id = ? AND dm.is_active = 1`;
      queryParams = [csrRoleId, userId];
    } else {
      baseWhereClause = `
        WHERE u.role_id = ? AND u.is_active = 1 AND d.is_active = 1`;
      queryParams = [csrRoleId];
    }

    if (searchTerm) {
      baseWhereClause += ` AND (
        u.username LIKE ?
        OR EXISTS (
          SELECT 1 FROM coaching_session_topics cst
          JOIN topics t ON cst.topic_id = t.id
          WHERE cst.coaching_session_id = cs.id
          AND t.topic_name LIKE ?
        )
      )`;
      queryParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    if (csrId) {
      baseWhereClause += ' AND cs.csr_id = ?';
      queryParams.push(parseInt(csrId));
    }

    if (status) {
      baseWhereClause += ' AND cs.status = ?';
      queryParams.push(status);
    }

    if (coachingType) {
      baseWhereClause += ' AND cs.coaching_type = ?';
      queryParams.push(coachingType);
    }

    if (startDate) {
      baseWhereClause += ' AND DATE(cs.session_date) >= ?';
      queryParams.push(startDate);
    }

    if (endDate) {
      baseWhereClause += ' AND DATE(cs.session_date) <= ?';
      queryParams.push(endDate);
    }

    const sessionsQuery = `
      SELECT
        cs.id,
        cs.session_date,
        cs.coaching_type,
        cs.notes,
        cs.status,
        cs.attachment_filename,
        cs.created_at,
        u.username as csr_name,
        creator.username as created_by_name,
        GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      ${baseWhereClause}
      GROUP BY cs.id
      ORDER BY cs.session_date DESC
    `;

    const sessions = await prisma.$queryRawUnsafe<any[]>(sessionsQuery, ...queryParams);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Coaching Sessions');

    worksheet.columns = [
      { header: 'Session ID', key: 'id', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Coaching Type', key: 'coaching_type', width: 20 },
      { header: 'CSR Name', key: 'csr_name', width: 24 },
      { header: 'Topics', key: 'topics', width: 36 },
      { header: 'Manager/Trainer', key: 'created_by_name', width: 24 },
      { header: 'Session Date', key: 'session_date', width: 16 },
      { header: 'Created At', key: 'created_at', width: 16 },
      { header: 'Notes', key: 'notes', width: 48 },
      { header: 'Attachment', key: 'attachment_filename', width: 28 }
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00AEEF' }
    };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 22;

    (sessions || []).forEach((session: any) => {
      worksheet.addRow({
        id: `#${session.id}`,
        status: session.status ? session.status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase()) : '',
        coaching_type: session.coaching_type || '',
        csr_name: session.csr_name || '',
        topics: session.topics || '',
        created_by_name: session.created_by_name || 'Unknown',
        session_date: session.session_date ? new Date(session.session_date).toLocaleDateString('en-US') : '',
        created_at: session.created_at ? new Date(session.created_at).toLocaleDateString('en-US') : '',
        notes: session.notes || '',
        attachment_filename: session.attachment_filename || ''
      });
    });

    worksheet.eachRow((row, rowNumber) => {
      row.alignment = {
        vertical: 'top',
        horizontal: rowNumber === 1 ? 'center' : 'left',
        wrapText: true
      };
    });

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columns.length }
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const fileName = `QTIP_CoachingSessions_${dateStr}_${timeStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(fileName)}`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error exporting coaching sessions:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get coaching session details by ID
 */
export const getManagerCoachingSessionDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    const sessionId = parseInt(req.params.sessionId);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    let sessionQuery: string;
    let queryParams: any[];
    
    if (userRole === 'Manager') {
      sessionQuery = `
        SELECT 
          cs.id,
          cs.csr_id,
          u.username as csr_name,
          u.email as csr_email,
          d.department_name as csr_department,
          cs.session_date,
          cs.coaching_type,
          cs.notes,
          cs.status,
          cs.attachment_filename,
          cs.attachment_path,
          cs.attachment_size,
          cs.attachment_mime_type,
          cs.created_at,
          creator.username as created_by_name,
          GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        JOIN department_managers dm ON d.id = dm.department_id
        LEFT JOIN users creator ON cs.created_by = creator.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        WHERE cs.id = ? 
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
        AND dm.manager_id = ?
        AND dm.is_active = 1
        GROUP BY cs.id
      `;
      queryParams = [sessionId, csrRoleId, userId];
    } else {
      sessionQuery = `
        SELECT 
          cs.id,
          cs.csr_id,
          u.username as csr_name,
          u.email as csr_email,
          d.department_name as csr_department,
          cs.session_date,
          cs.coaching_type,
          cs.notes,
          cs.status,
          cs.attachment_filename,
          cs.attachment_path,
          cs.attachment_size,
          cs.attachment_mime_type,
          cs.created_at,
          creator.username as created_by_name,
          GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        LEFT JOIN users creator ON cs.created_by = creator.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        WHERE cs.id = ? 
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
        GROUP BY cs.id
      `;
      queryParams = [sessionId, csrRoleId];
    }

    const sessionRows = await prisma.$queryRawUnsafe<any[]>(sessionQuery, ...queryParams);

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found or you do not have permission to view it' 
      });
    }

    const sessionData = sessionRows[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Error fetching coaching session details:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Create new coaching session
 */
export const createManagerCoachingSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = req.user?.user_id;
    let { csr_id, session_date, topic_ids, coaching_type, notes, status } = req.body;
    const attachment = req.file;

    if (topic_ids !== undefined) {
      if (typeof topic_ids === 'string') {
        topic_ids = topic_ids.split(',').map((id: string) => id.trim()).filter((id: string) => id !== '');
      }
      if (!Array.isArray(topic_ids)) {
        topic_ids = [topic_ids];
      }
      topic_ids = (topic_ids as any[]).map((id: any) => parseInt(String(id))).filter((id: number) => !isNaN(id) && id > 0);
    }

    if (!managerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!csr_id || !session_date || !coaching_type || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: csr_id, session_date, coaching_type, status' 
      });
    }

    if (!topic_ids || !Array.isArray(topic_ids) || topic_ids.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'At least one topic is required' 
      });
    }

    if (!['SCHEDULED', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid status. Must be SCHEDULED or COMPLETED' 
      });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const csrRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT u.id, u.username, d.department_name
      FROM users u
      JOIN departments d ON u.department_id = d.id
      JOIN department_managers dm ON d.id = dm.department_id
      WHERE u.id = ${csr_id} 
      AND u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
      AND dm.manager_id = ${managerId}
      AND dm.is_active = 1
    `);

    if (!csrRows || csrRows.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: 'CSR not found, inactive, or you do not have permission to coach this CSR' 
      });
    }

    if (notes && notes.length > 2000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Notes cannot exceed 2000 characters' 
      });
    }

    const validTopicIds = topic_ids.filter((id: number) => Number.isInteger(Number(id)) && Number(id) > 0);
    if (validTopicIds.length !== topic_ids.length) {
      return res.status(400).json({ 
        success: false, 
        message: 'All topic IDs must be valid positive integers' 
      });
    }

    const topicRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM topics WHERE id IN (${topic_ids.map(() => '?').join(',')}) AND is_active = 1`,
      ...topic_ids
    );
    
    if (!topicRows || topicRows.length !== topic_ids.length) {
      return res.status(400).json({ 
        success: false, 
        message: 'One or more topic IDs are invalid or inactive' 
      });
    }

    const validCoachingTypes = [
      'Classroom', 'Side-by-Side', 'Team Session', '1-on-1', 
      'PIP', 'Verbal Warning', 'Written Warning'
    ];
    if (!validCoachingTypes.includes(coaching_type)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid coaching type' 
      });
    }

    let attachmentData: any = {
      filename: null,
      path: null,
      size: null,
      mime_type: null
    };

    if (attachment) {
      const fsLib = require('fs').promises;
      const pathLib = require('path');
      
      const uploadsDir = pathLib.join(process.cwd(), 'uploads', 'coaching');
      try {
        await fsLib.mkdir(uploadsDir, { recursive: true });
      } catch (err) {
        console.error('Error creating uploads directory:', err);
      }

      const timestamp = Date.now();
      const fileExtension = pathLib.extname(attachment.originalname);
      const filename = `coaching_${timestamp}_${Math.random().toString(36).substring(2, 15)}${fileExtension}`;
      const filePath = pathLib.join(uploadsDir, filename);

      try {
        await fsLib.writeFile(filePath, attachment.buffer);
        attachmentData = {
          filename: attachment.originalname,
          path: `uploads/coaching/${filename}`,
          size: attachment.size,
          mime_type: attachment.mimetype
        };
      } catch (err) {
        console.error('Error saving file:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to save attachment' 
        });
      }
    }

    const newSessionId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO coaching_sessions (csr_id, session_date, coaching_type, notes, status, attachment_filename, attachment_path, attachment_size, attachment_mime_type, created_by)
        VALUES (${csr_id}, ${session_date}, ${coaching_type}, ${notes || null}, ${status}, ${attachmentData.filename}, ${attachmentData.path}, ${attachmentData.size}, ${attachmentData.mime_type}, ${managerId})
      `);

      const insertedIdRows = await tx.$queryRaw<any[]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`);
      const sessionId = Number(insertedIdRows[0].id);

      for (const topicId of topic_ids) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO coaching_session_topics (coaching_session_id, topic_id)
          VALUES (${sessionId}, ${topicId})
        `);
      }

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
        VALUES (${managerId}, 'CREATE', ${sessionId}, 'coaching_session', ${JSON.stringify({ csr_id, topic_ids, coaching_type, status, has_attachment: !!attachment })})
      `);

      return sessionId;
    });

    const createdSession = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        cs.id,
        cs.csr_id,
        u.username as csr_name,
        cs.session_date,
        cs.coaching_type,
        cs.notes,
        cs.status,
        cs.attachment_filename,
        cs.attachment_path,
        cs.attachment_size,
        cs.attachment_mime_type,
        cs.created_at,
        creator.username as created_by_name,
        GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
        GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      WHERE cs.id = ${newSessionId}
      GROUP BY cs.id
    `);

    const sessionData = createdSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.status(201).json({
      success: true,
      data: responseData,
      message: 'Coaching session created successfully'
    });
  } catch (error) {
    console.error('Error creating coaching session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Update coaching session
 */
export const updateManagerCoachingSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    const sessionId = parseInt(req.params.sessionId);
    let { csr_id, session_date, topic_ids, coaching_type, notes, status } = req.body;
    const attachment = req.file;

    if (topic_ids !== undefined) {
      if (typeof topic_ids === 'string') {
        topic_ids = topic_ids.split(',').map((id: string) => id.trim()).filter((id: string) => id !== '');
      }
      if (!Array.isArray(topic_ids)) {
        topic_ids = [topic_ids];
      }
      topic_ids = (topic_ids as any[]).map((id: any) => parseInt(String(id))).filter((id: number) => !isNaN(id) && id > 0);
    }

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    let sessionCheckQuery: string;
    let queryParams: any[];
    
    if (userRole === 'Manager') {
      sessionCheckQuery = `
        SELECT cs.id, cs.status as current_status, u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        JOIN department_managers dm ON d.id = dm.department_id
        WHERE cs.id = ? 
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
        AND dm.manager_id = ?
        AND dm.is_active = 1
      `;
      queryParams = [sessionId, csrRoleId, userId];
    } else {
      sessionCheckQuery = `
        SELECT cs.id, cs.status as current_status, u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        WHERE cs.id = ? 
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
      `;
      queryParams = [sessionId, csrRoleId];
    }

    const sessionRows = await prisma.$queryRawUnsafe<any[]>(sessionCheckQuery, ...queryParams);

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found' 
      });
    }

    const currentSession = sessionRows[0];

    if (currentSession.current_status === 'COMPLETED') {
      const hasOtherFieldUpdates = csr_id !== undefined || 
                                   session_date !== undefined || 
                                   topic_ids !== undefined ||
                                   coaching_type !== undefined || 
                                   (notes !== undefined && notes !== '') || 
                                   attachment !== undefined;
      
      if (hasOtherFieldUpdates) {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot edit completed coaching sessions (except to reopen them by changing status to SCHEDULED)' 
        });
      }
      
      if (!hasOtherFieldUpdates && status !== undefined && status !== 'SCHEDULED') {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot edit completed coaching sessions (except to reopen them by changing status to SCHEDULED)' 
        });
      }
    }

    if (status && !['SCHEDULED', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid status. Must be SCHEDULED or COMPLETED' 
      });
    }

    if (topic_ids !== undefined) {
      if (!Array.isArray(topic_ids) || topic_ids.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'At least one topic is required' 
        });
      }

      const validTopicIds = topic_ids.filter((id: number) => Number.isInteger(id) && id > 0);
      if (validTopicIds.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'All topic IDs must be valid positive integers' 
        });
      }

      const topicRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM topics WHERE id IN (${validTopicIds.map(() => '?').join(',')}) AND is_active = 1`,
        ...validTopicIds
      );
      const activeTopicIds = (topicRows || []).map((r: { id: number }) => r.id);

      if (activeTopicIds.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'All selected topics are invalid or inactive. Please select at least one active topic.' 
        });
      }
      topic_ids = activeTopicIds;
    }

    if (notes && notes.length > 2000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Notes cannot exceed 2000 characters' 
      });
    }

    if (coaching_type) {
      const validCoachingTypes = [
        'Classroom', 'Side-by-Side', 'Team Session', '1-on-1', 
        'PIP', 'Verbal Warning', 'Written Warning'
      ];
      if (!validCoachingTypes.includes(coaching_type)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid coaching type' 
        });
      }
    }

    if (csr_id) {
      let csrCheckQuery: string;
      let csrQueryParams: any[];
      
      if (userRole === 'Manager') {
        csrCheckQuery = `
          SELECT u.id, u.username
          FROM users u
          JOIN departments d ON u.department_id = d.id
          JOIN department_managers dm ON d.id = dm.department_id
          WHERE u.id = ? 
          AND u.role_id = ?
          AND u.is_active = 1
          AND d.is_active = 1
          AND dm.manager_id = ?
          AND dm.is_active = 1
        `;
        csrQueryParams = [csr_id, csrRoleId, userId];
      } else {
        csrCheckQuery = `
          SELECT u.id, u.username
          FROM users u
          JOIN departments d ON u.department_id = d.id
          WHERE u.id = ? 
          AND u.role_id = ?
          AND u.is_active = 1
          AND d.is_active = 1
        `;
        csrQueryParams = [csr_id, csrRoleId];
      }

      const csrRows = await prisma.$queryRawUnsafe<any[]>(csrCheckQuery, ...csrQueryParams);

      if (!csrRows || csrRows.length === 0) {
        return res.status(403).json({ 
          success: false, 
          message: 'CSR not found, inactive, or you do not have permission to coach this CSR' 
        });
      }
    }

    let attachmentData: any = {};

    if (attachment) {
      const fsLib = require('fs').promises;
      const pathLib = require('path');
      
      const uploadsDir = pathLib.join(process.cwd(), 'uploads', 'coaching');
      try {
        await fsLib.mkdir(uploadsDir, { recursive: true });
      } catch (err) {
        console.error('Error creating uploads directory:', err);
      }

      const timestamp = Date.now();
      const fileExtension = pathLib.extname(attachment.originalname);
      const filename = `coaching_${timestamp}_${Math.random().toString(36).substring(2, 15)}${fileExtension}`;
      const filePath = pathLib.join(uploadsDir, filename);

      try {
        await fsLib.writeFile(filePath, attachment.buffer);
        attachmentData = {
          attachment_filename: attachment.originalname,
          attachment_path: `uploads/coaching/${filename}`,
          attachment_size: attachment.size,
          attachment_mime_type: attachment.mimetype
        };
      } catch (err) {
        console.error('Error saving file:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to save attachment' 
        });
      }
    }

    // Build dynamic update query
    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (csr_id !== undefined) {
      updateFields.push('csr_id = ?');
      updateParams.push(csr_id);
    }
    if (session_date !== undefined) {
      updateFields.push('session_date = ?');
      updateParams.push(session_date);
    }
    if (coaching_type !== undefined) {
      updateFields.push('coaching_type = ?');
      updateParams.push(coaching_type);
    }
    if (notes !== undefined) {
      updateFields.push('notes = ?');
      updateParams.push(notes || null);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      updateParams.push(status);
    }

    if (attachment && Object.keys(attachmentData).length > 0) {
      updateFields.push('attachment_filename = ?');
      updateParams.push(attachmentData.attachment_filename);
      updateFields.push('attachment_path = ?');
      updateParams.push(attachmentData.attachment_path);
      updateFields.push('attachment_size = ?');
      updateParams.push(attachmentData.attachment_size);
      updateFields.push('attachment_mime_type = ?');
      updateParams.push(attachmentData.attachment_mime_type);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No fields to update' 
      });
    }

    updateParams.push(sessionId);

    await prisma.$transaction(async (tx) => {
      if (updateFields.length > 0) {
        await tx.$executeRawUnsafe(
          `UPDATE coaching_sessions SET ${updateFields.join(', ')} WHERE id = ?`,
          ...updateParams
        );
      }

      if (topic_ids !== undefined) {
        await tx.$executeRaw(Prisma.sql`
          DELETE FROM coaching_session_topics WHERE coaching_session_id = ${sessionId}
        `);

        for (const topicId of topic_ids) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO coaching_session_topics (coaching_session_id, topic_id)
            VALUES (${sessionId}, ${topicId})
          `);
        }
      }

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
        VALUES (${userId}, 'UPDATE', ${sessionId}, 'coaching_session', ${JSON.stringify(req.body)})
      `);
    });

    const updatedSession = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        cs.id,
        cs.csr_id,
        u.username as csr_name,
        cs.session_date,
        cs.coaching_type,
        cs.notes,
        cs.status,
        cs.attachment_filename,
        cs.attachment_path,
        cs.attachment_size,
        cs.attachment_mime_type,
        cs.created_at,
        creator.username as created_by_name,
        GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
        GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      WHERE cs.id = ${sessionId}
      GROUP BY cs.id
    `);

    const sessionData = updatedSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({
      success: true,
      data: responseData,
      message: 'Coaching session updated successfully'
    });
  } catch (error) {
    console.error('Error updating coaching session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Mark coaching session as completed
 */
export const completeManagerCoachingSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    const sessionId = parseInt(req.params.sessionId);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    let sessionCheckQuery: string;
    let queryParams: any[];
    
    if (userRole === 'Manager') {
      sessionCheckQuery = `
        SELECT cs.id, cs.status as current_status, u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        JOIN department_managers dm ON d.id = dm.department_id
        WHERE cs.id = ? 
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
        AND dm.manager_id = ?
        AND dm.is_active = 1
      `;
      queryParams = [sessionId, csrRoleId, userId];
    } else {
      sessionCheckQuery = `
        SELECT cs.id, cs.status as current_status, u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        WHERE cs.id = ? 
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
      `;
      queryParams = [sessionId, csrRoleId];
    }

    const sessionRows = await prisma.$queryRawUnsafe<any[]>(sessionCheckQuery, ...queryParams);

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found' 
      });
    }

    const currentSession = sessionRows[0];

    if (currentSession.current_status === 'COMPLETED') {
      return res.status(400).json({ 
        success: false, 
        message: 'Coaching session is already completed' 
      });
    }

    await prisma.$executeRaw(Prisma.sql`
      UPDATE coaching_sessions SET status = 'COMPLETED' WHERE id = ${sessionId}
    `);

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${userId}, 'COMPLETE', ${sessionId}, 'coaching_session', ${JSON.stringify({ csr_name: currentSession.csr_name })})
    `);

    const updatedSession = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        cs.id,
        cs.csr_id,
        u.username as csr_name,
        cs.session_date,
        cs.topic,
        cs.coaching_type,
        cs.notes,
        cs.status,
        cs.attachment_filename,
        cs.attachment_path,
        cs.attachment_size,
        cs.attachment_mime_type,
        cs.created_at,
        creator.username as created_by_name
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      WHERE cs.id = ${sessionId}
    `);

    res.json({
      success: true,
      data: updatedSession[0],
      message: 'Coaching session marked as completed successfully'
    });
  } catch (error) {
    console.error('Error completing coaching session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Re-open a completed coaching session (change status back to SCHEDULED)
 */
export const reopenManagerCoachingSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    const sessionId = parseInt(req.params.sessionId);

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    let sessionCheckQuery: string;
    let queryParams: any[];
    
    if (userRole === 'Manager') {
      sessionCheckQuery = `
        SELECT cs.id, cs.status as current_status, u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        JOIN department_managers dm ON d.id = dm.department_id
        WHERE cs.id = ? 
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
        AND dm.manager_id = ?
        AND dm.is_active = 1
      `;
      queryParams = [sessionId, csrRoleId, userId];
    } else {
      sessionCheckQuery = `
        SELECT cs.id, cs.status as current_status, u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        WHERE cs.id = ? 
        AND u.role_id = ?
        AND u.is_active = 1
        AND d.is_active = 1
      `;
      queryParams = [sessionId, csrRoleId];
    }

    const sessionRows = await prisma.$queryRawUnsafe<any[]>(sessionCheckQuery, ...queryParams);

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found' 
      });
    }

    const currentSession = sessionRows[0];

    if (currentSession.current_status !== 'COMPLETED') {
      return res.status(400).json({ 
        success: false, 
        message: 'Can only reopen completed coaching sessions' 
      });
    }

    await prisma.$executeRaw(Prisma.sql`
      UPDATE coaching_sessions SET status = 'SCHEDULED' WHERE id = ${sessionId}
    `);

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
      VALUES (${userId}, 'REOPEN', ${sessionId}, 'coaching_session', ${JSON.stringify({ csr_name: currentSession.csr_name })})
    `);

    const updatedSession = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        cs.id,
        cs.csr_id,
        u.username as csr_name,
        cs.session_date,
        cs.topic,
        cs.coaching_type,
        cs.notes,
        cs.status,
        cs.attachment_filename,
        cs.attachment_path,
        cs.attachment_size,
        cs.attachment_mime_type,
        cs.created_at
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      WHERE cs.id = ${sessionId}
    `);

    res.json({
      success: true,
      data: updatedSession[0],
      message: 'Coaching session reopened successfully'
    });
  } catch (error) {
    console.error('Error reopening coaching session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Download coaching session attachment
 */
export const downloadManagerCoachingSessionAttachment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!managerId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!sessionId || isNaN(sessionId)) {
      res.status(400).json({ success: false, message: 'Invalid session ID' });
      return;
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      res.status(500).json({ success: false, message: 'CSR role not found' });
      return;
    }

    const sessionRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        cs.id,
        cs.attachment_filename,
        cs.attachment_path,
        cs.attachment_mime_type,
        u.username as csr_name
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      WHERE cs.id = ${sessionId} 
      AND u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
      AND cs.attachment_path IS NOT NULL
    `);

    if (!sessionRows || sessionRows.length === 0) {
      res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found or no attachment' 
      });
      return;
    }

    const session = sessionRows[0];
    const filePath = path.join(process.cwd(), session.attachment_path);

    try {
      await fs.access(filePath);
    } catch (error) {
      res.status(404).json({ 
        success: false, 
        message: 'Attachment file not found on server' 
      });
      return;
    }

    const stats = await fs.stat(filePath);

    res.setHeader('Content-Type', session.attachment_mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(session.attachment_filename)}`);

    const fileStream = createReadStream(filePath);
    
    fileStream.on('error', (streamError: Error) => {
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          message: 'Error reading file' 
        });
      } else {
        console.error('File stream error after headers sent:', streamError);
        res.destroy();
      }
    });
    
    res.on('error', (responseError) => {
      console.error('Response error during file stream:', responseError);
      fileStream.destroy();
    });
    
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading coaching session attachment:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Resolve dispute with form edit
 * @route PUT /api/manager/disputes/:disputeId/resolve
 */
export const resolveDisputeWithFormEdit = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = req.user?.user_id;
    const disputeId = parseInt(req.params.disputeId);
    const { resolution_notes, updated_answers, resolution_action } = req.body;

    if (!managerId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!resolution_notes || !resolution_notes.trim()) {
      res.status(400).json({ success: false, message: 'Resolution notes are required' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const disputeRows = await tx.$queryRaw<any[]>(Prisma.sql`
        SELECT d.*, s.id as submission_id 
        FROM disputes d 
        JOIN submissions s ON d.submission_id = s.id
        WHERE d.id = ${disputeId}
      `);

      if (disputeRows.length === 0) {
        throw new Error('DISPUTE_NOT_FOUND');
      }

      const dispute = disputeRows[0];
      const submissionId = dispute.submission_id;

      const disputeStatus = resolution_action === 'REJECTED' ? 'REJECTED' : 'ADJUSTED';
      
      if (disputeStatus === 'ADJUSTED' && updated_answers && Object.keys(updated_answers).length > 0) {
        const answersArray = Object.entries(updated_answers).map(([questionId, answerData]) => {
          const typedAnswerData = answerData as {
            answer?: string;
            notes?: string;
            score?: number;
          };
          
          return {
            question_id: parseInt(questionId),
            answer: typedAnswerData.answer || '',
            notes: typedAnswerData.notes || ''
          };
        });

        const submissionRows = await tx.$queryRaw<any[]>(Prisma.sql`
          SELECT form_id, call_id FROM submissions WHERE id = ${submissionId}
        `);

        if (submissionRows.length === 0) {
          throw new Error('SUBMISSION_NOT_FOUND');
        }

        const metadataRows = await tx.$queryRaw<any[]>(Prisma.sql`
          SELECT field_id, value FROM submission_metadata WHERE submission_id = ${submissionId}
        `);

        const metadata = metadataRows.map((row: any) => ({
          field_id: row.field_id,
          value: row.value
        }));

        await tx.$executeRaw(Prisma.sql`
          UPDATE submissions SET status = 'FINALIZED' WHERE id = ${submissionId}
        `);

        await tx.$executeRaw(Prisma.sql`
          DELETE FROM submission_answers WHERE submission_id = ${submissionId}
        `);

        for (const answer of answersArray) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO submission_answers (
              submission_id, question_id, answer, notes
            ) VALUES (${submissionId}, ${answer.question_id}, ${answer.answer}, ${answer.notes || null})
          `);
        }

        await tx.$executeRaw(Prisma.sql`
          DELETE FROM submission_metadata WHERE submission_id = ${submissionId}
        `);

        for (const meta of metadata) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO submission_metadata (
              submission_id, field_id, value
            ) VALUES (${submissionId}, ${meta.field_id}, ${meta.value})
          `);
        }

        const { calculateFormScoreBySubmissionId } = require('../utils/scoringUtil');
        const scoreResult = await calculateFormScoreBySubmissionId(null, submissionId);

        await recordDisputeScore(null, {
          disputeId,
          submissionId,
          scoreType: 'ADJUSTED',
          score: Number(scoreResult.totalScore),
          recordedBy: managerId,
          notes: 'Score recalculated after dispute form edits'
        });
      } else if (disputeStatus === 'REJECTED') {
        await tx.$executeRaw(Prisma.sql`
          UPDATE submissions SET status = 'SUBMITTED' WHERE id = ${submissionId}
        `);
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE disputes 
        SET status = ${disputeStatus}, 
            resolution_notes = ${resolution_notes},
            resolved_at = NOW()
        WHERE id = ${disputeId}
      `);

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO audit_logs (user_id, action, target_id, target_type, details)
        VALUES (${managerId}, 'RESOLVE_DISPUTE', ${disputeId}, 'dispute', ${JSON.stringify({ 
          status: disputeStatus,
          updated_answers: disputeStatus === 'ADJUSTED' && updated_answers ? Object.keys(updated_answers) : [],
          resolution_notes,
          resolved_by: managerId
        })})
      `);
    });

    res.json({
      success: true,
      message: 'Dispute resolved successfully'
    });

  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'DISPUTE_NOT_FOUND') {
        res.status(404).json({ success: false, message: 'Dispute not found' });
        return;
      }
      if (error.message === 'SUBMISSION_NOT_FOUND') {
        res.status(404).json({ success: false, message: 'Submission not found' });
        return;
      }
    }
    console.error('Error resolving dispute:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to resolve dispute',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const getTeamFilterOptions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const managerId = req.user?.user_id;
    
    if (!managerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const departments = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DISTINCT d.id 
      FROM departments d
      JOIN department_managers dm ON d.id = dm.department_id
      WHERE dm.manager_id = ${managerId} AND dm.is_active = 1 AND d.is_active = 1
    `);

    if (!departments || departments.length === 0) {
      return res.json({
        success: true,
        data: {
          departments: [],
          managers: []
        }
      });
    }

    const departmentIds = departments.map((dept: any) => dept.id);

    const teamMembers = await prisma.$queryRawUnsafe<any[]>(
      `SELECT u.id, u.username as name, d.department_name as department
       FROM users u
       JOIN departments d ON u.department_id = d.id
       WHERE u.department_id IN (${departmentIds.map(() => '?').join(',')})
       AND u.role_id = ?
       AND u.is_active = 1
       ORDER BY u.username`,
      ...departmentIds, csrRoleId
    );

    res.json({
      success: true,
      data: {
        departments: departments,
        managers: teamMembers
      }
    });
  } catch (error) {
    console.error('Error fetching team filter options:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Generate team performance report
 * @route POST /api/manager/team/reports
 */
export const generateTeamReport = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!userId || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    const { reportType, startDate, endDate, departmentIds, csrIds } = req.body;

    console.log('[MANAGER CONTROLLER] Generating team report:', { reportType, startDate, endDate });

    const reportData = {
      id: Date.now(),
      reportType: reportType || 'PERFORMANCE_SUMMARY',
      generatedAt: new Date().toISOString(),
      generatedBy: userId,
      dateRange: {
        startDate: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: endDate || new Date().toISOString().split('T')[0]
      },
      summary: {
        totalAudits: 45,
        averageScore: 87.3,
        completedTraining: 23,
        pendingDisputes: 2,
        teamSize: 8
      },
      status: 'COMPLETED'
    };

    res.status(200).json({
      success: true,
      message: 'Team report generated successfully',
      data: reportData
    });
  } catch (error) {
    console.error('[MANAGER CONTROLLER] Error generating team report:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate team report' 
    });
  }
};

/**
 * Export team report
 * @route GET /api/manager/team/export/:reportId
 */
export const exportTeamReport = async (req: Request, res: Response) => {
  res.status(200).json({ message: 'Export functionality not implemented yet' });
};

// Dashboard Stats Interfaces
interface ManagerDashboardStats {
  reviewsCompleted: {
    thisWeek: number;
    thisMonth: number;
  };
  disputes: {
    thisWeek: number;
    thisMonth: number;
  };
  coachingSessions: {
    thisWeek: number;
    thisMonth: number;
  };
}

interface ManagerCSRActivityData {
  id: number;
  name: string;
  department: string;
  audits: number;
  disputes: number;
  coachingScheduled: number;
  coachingCompleted: number;
  audits_week: number;
  disputes_week: number;
  audits_month: number;
  disputes_month: number;
  coachingScheduled_week: number;
  coachingCompleted_week: number;
  coachingScheduled_month: number;
  coachingCompleted_month: number;
}

/**
 * Get manager dashboard statistics (filtered to manager's departments)
 * @route GET /api/manager/dashboard-stats
 */
export const getManagerDashboardStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const departments = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DISTINCT d.id FROM departments d 
      INNER JOIN department_managers dm ON d.id = dm.department_id 
      WHERE dm.manager_id = ${userId} AND dm.is_active = 1 AND d.is_active = 1
    `);

    if (!departments || departments.length === 0) {
      res.status(200).json({
        reviewsCompleted: { thisWeek: 0, thisMonth: 0 },
        disputes: { thisWeek: 0, thisMonth: 0 },
        coachingSessions: { thisWeek: 0, thisMonth: 0 }
      });
      return;
    }

    const departmentIds = departments.map((dept: any) => dept.id);
    const placeholders = departmentIds.map(() => '?').join(',');

    const reviewsCompleted = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        COUNT(CASE WHEN s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
        COUNT(CASE WHEN s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
      FROM submissions s
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users u ON u.id = CAST(sm.value AS UNSIGNED)
      JOIN roles r ON u.role_id = r.id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
      AND fmf.field_name = 'CSR'
      AND r.role_name = 'CSR'
      AND u.is_active = 1
      AND u.department_id IN (${placeholders})
    `, ...departmentIds);

    const disputes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
        COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
      FROM disputes d
      JOIN submissions s ON d.submission_id = s.id
      JOIN submission_metadata sm ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users u ON u.id = CAST(sm.value AS UNSIGNED)
      JOIN roles r ON u.role_id = r.id
      WHERE fmf.field_name = 'CSR'
      AND r.role_name = 'CSR'
      AND u.is_active = 1
      AND u.department_id IN (${placeholders})
    `, ...departmentIds);

    const coachingSessions = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        COUNT(CASE WHEN cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
        COUNT(CASE WHEN cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN roles r ON u.role_id = r.id
      WHERE cs.status IN ('SCHEDULED', 'COMPLETED')
      AND r.role_name = 'CSR'
      AND u.is_active = 1
      AND u.department_id IN (${placeholders})
    `, ...departmentIds);

    const stats: ManagerDashboardStats = {
      reviewsCompleted: {
        thisWeek: Number(reviewsCompleted[0]?.thisWeek || 0),
        thisMonth: Number(reviewsCompleted[0]?.thisMonth || 0)
      },
      disputes: {
        thisWeek: Number(disputes[0]?.thisWeek || 0),
        thisMonth: Number(disputes[0]?.thisMonth || 0)
      },
      coachingSessions: {
        thisWeek: Number(coachingSessions[0]?.thisWeek || 0),
        thisMonth: Number(coachingSessions[0]?.thisMonth || 0)
      }
    };

    res.status(200).json(stats);
  } catch (error) {
    console.error('Error fetching manager dashboard statistics:', error);
    res.status(500).json({ message: 'Failed to fetch manager dashboard statistics' });
  }
};

/**
 * Get CSR activity data for manager dashboard (filtered to manager's departments)
 * @route GET /api/manager/csr-activity
 */
export const getManagerCSRActivity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    let departments: any[];
    if (userRole === 'Manager') {
      departments = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT d.id FROM departments d 
        INNER JOIN department_managers dm ON d.id = dm.department_id 
        WHERE dm.manager_id = ${userId} AND dm.is_active = 1 AND d.is_active = 1
      `);
    } else {
      departments = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT d.id FROM departments d WHERE d.is_active = 1
      `);
    }

    if (!departments || departments.length === 0) {
      res.status(200).json([]);
      return;
    }

    const departmentIds = departments.map((dept: any) => dept.id);
    const placeholders = departmentIds.map(() => '?').join(',');

    const csrActivity = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        u.id,
        u.username as name,
        d.department_name as department,
        COALESCE(audit_counts.audits, 0) as audits,
        COALESCE(dispute_counts.disputes, 0) as disputes,
        COALESCE(coaching_scheduled.coachingScheduled, 0) as coachingScheduled,
        COALESCE(coaching_completed.coachingCompleted, 0) as coachingCompleted,
        COALESCE(audit_counts_week.audits_week, 0) as audits_week,
        COALESCE(dispute_counts_week.disputes_week, 0) as disputes_week,
        COALESCE(audit_counts_month.audits_month, 0) as audits_month,
        COALESCE(dispute_counts_month.disputes_month, 0) as disputes_month,
        COALESCE(coaching_scheduled_week.coachingScheduled_week, 0) as coachingScheduled_week,
        COALESCE(coaching_completed_week.coachingCompleted_week, 0) as coachingCompleted_week,
        COALESCE(coaching_scheduled_month.coachingScheduled_month, 0) as coachingScheduled_month,
        COALESCE(coaching_completed_month.coachingCompleted_month, 0) as coachingCompleted_month
      FROM users u
      JOIN roles r ON u.role_id = r.id
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        GROUP BY sm.value
      ) audit_counts ON u.id = audit_counts.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN disputes disp ON disp.submission_id = s.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        GROUP BY sm.value
      ) dispute_counts ON u.id = dispute_counts.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_week
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        GROUP BY sm.value
      ) audit_counts_week ON u.id = audit_counts_week.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_week
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN disputes disp ON disp.submission_id = s.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        GROUP BY sm.value
      ) dispute_counts_week ON u.id = dispute_counts_week.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_month
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        AND s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
        GROUP BY sm.value
      ) audit_counts_month ON u.id = audit_counts_month.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_month
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN disputes disp ON disp.submission_id = s.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR'
        AND active_csr.is_active = 1 AND active_csr.department_id IN (${placeholders})
        AND disp.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
        GROUP BY sm.value
      ) dispute_counts_month ON u.id = dispute_counts_month.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled
        FROM coaching_sessions cs
        JOIN users csr_user ON cs.csr_id = csr_user.id
        WHERE cs.status = 'SCHEDULED' AND csr_user.department_id IN (${placeholders})
        GROUP BY cs.csr_id
      ) coaching_scheduled ON u.id = coaching_scheduled.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted
        FROM coaching_sessions cs
        JOIN users csr_user ON cs.csr_id = csr_user.id
        WHERE cs.status = 'COMPLETED' AND csr_user.department_id IN (${placeholders})
        GROUP BY cs.csr_id
      ) coaching_completed ON u.id = coaching_completed.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_week
        FROM coaching_sessions cs
        JOIN users csr_user ON cs.csr_id = csr_user.id
        WHERE cs.status = 'SCHEDULED'
        AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        AND csr_user.department_id IN (${placeholders})
        GROUP BY cs.csr_id
      ) coaching_scheduled_week ON u.id = coaching_scheduled_week.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_week
        FROM coaching_sessions cs
        JOIN users csr_user ON cs.csr_id = csr_user.id
        WHERE cs.status = 'COMPLETED'
        AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        AND csr_user.department_id IN (${placeholders})
        GROUP BY cs.csr_id
      ) coaching_completed_week ON u.id = coaching_completed_week.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_month
        FROM coaching_sessions cs
        JOIN users csr_user ON cs.csr_id = csr_user.id
        WHERE cs.status = 'SCHEDULED'
        AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01')
        AND csr_user.department_id IN (${placeholders})
        GROUP BY cs.csr_id
      ) coaching_scheduled_month ON u.id = coaching_scheduled_month.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_month
        FROM coaching_sessions cs
        JOIN users csr_user ON cs.csr_id = csr_user.id
        WHERE cs.status = 'COMPLETED'
        AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01')
        AND csr_user.department_id IN (${placeholders})
        GROUP BY cs.csr_id
      ) coaching_completed_month ON u.id = coaching_completed_month.csr_id
      WHERE r.role_name = 'CSR' 
      AND u.is_active = 1
      AND u.department_id IN (${placeholders})
      ORDER BY u.username
    `, [
      ...departmentIds, // For audit_counts
      ...departmentIds, // For dispute_counts
      ...departmentIds, // For audit_counts_week
      ...departmentIds, // For dispute_counts_week
      ...departmentIds, // For audit_counts_month
      ...departmentIds, // For dispute_counts_month
      ...departmentIds, // For coaching_scheduled
      ...departmentIds, // For coaching_completed
      ...departmentIds, // For coaching_scheduled_week
      ...departmentIds, // For coaching_completed_week
      ...departmentIds, // For coaching_scheduled_month
      ...departmentIds, // For coaching_completed_month
      ...departmentIds  // For main WHERE clause
    ].flat());

    const formattedCSRActivity: ManagerCSRActivityData[] = csrActivity.map((row: any) => ({
      id: row.id,
      name: row.name,
      department: row.department || 'No Department',
      audits: Number(row.audits),
      disputes: Number(row.disputes),
      coachingScheduled: Number(row.coachingScheduled),
      coachingCompleted: Number(row.coachingCompleted),
      audits_week: Number(row.audits_week),
      disputes_week: Number(row.disputes_week),
      audits_month: Number(row.audits_month),
      disputes_month: Number(row.disputes_month),
      coachingScheduled_week: Number(row.coachingScheduled_week),
      coachingCompleted_week: Number(row.coachingCompleted_week),
      coachingScheduled_month: Number(row.coachingScheduled_month),
      coachingCompleted_month: Number(row.coachingCompleted_month)
    }));

    res.status(200).json(formattedCSRActivity);
  } catch (error) {
    console.error('Error fetching manager CSR activity data:', error);
    res.status(500).json({ message: 'Failed to fetch CSR activity data' });
  }
};
