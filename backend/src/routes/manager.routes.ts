import express, { Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { authenticate, authorizeManager } from '../middleware/auth';
import { AnalyticsService } from '../services/AnalyticsService';
import { MySQLAnalyticsRepository } from '../repositories/MySQLAnalyticsRepository';
import cacheService from '../services/CacheService';
// PerformanceGoal repository temporarily disabled due to type issues
import { UserService, UserServiceError } from '../services/UserService';
import { MySQLUserRepository } from '../repositories/UserRepository';
import { 
  getManagerTeamDisputes, 
  exportManagerTeamDisputes,
  resolveManagerDispute, 
  getManagerDisputeDetails, 
  resolveDisputeWithFormEdit, 
  generateTeamReport, 
  exportTeamReport,
  getManagerCoachingSessions,
  exportManagerCoachingSessions,
  getManagerCoachingSessionDetails,
  createManagerCoachingSession,
  updateManagerCoachingSession,
  completeManagerCoachingSession,
  reopenManagerCoachingSession,
  downloadManagerCoachingSessionAttachment,
  getManagerDashboardStats,
  getManagerCSRActivity
} from '../controllers/manager.controller';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { 
  getManagerTeamAuditDetails
} from '../controllers/manager.controller';

const router = express.Router();

// Configure multer for coaching file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allow common document and image types
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, Word, Excel, text, and image files are allowed.'));
    }
  }
});

// Apply authentication and manager authorization to all manager routes
router.use(authenticate as unknown as RequestHandler);
router.use(authorizeManager as unknown as RequestHandler);

// Initialize services
const analyticsRepository = new MySQLAnalyticsRepository();
const analyticsService = new AnalyticsService(analyticsRepository, cacheService);

// Performance goal service temporarily disabled

const userRepository = new MySQLUserRepository();
const userService = new UserService(userRepository);



const getTeamGoalsHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    // Temporarily return placeholder data while performance goal service is being fixed
    const placeholderGoals = [
      {
        goal_type: 'QA_SCORE',
        target_value: 90,
        actualValue: 87,
        percentComplete: 97
      },
      {
        goal_type: 'AUDIT_RATE',
        target_value: 15,
        actualValue: 12,
        percentComplete: 80
      }
    ];
    
    res.status(200).json(placeholderGoals);
  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting team goals:', error);
    res.status(500).json({ message: 'Failed to fetch team goals' });
  }
};

const getTeamCSRsHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    console.log('[MANAGER ROUTE] Getting team CSRs for manager:', user_id);

    // Get departments where this user is the manager
    const departmentResult = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT d.id, d.department_name 
      FROM departments d
      INNER JOIN department_managers dm ON d.id = dm.department_id
      WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
    `);

    if (departmentResult.length === 0) {
      return res.status(403).json({ message: 'No departments assigned to this manager' });
    }

    const managedDepartmentIds = departmentResult.map(dept => dept.id);
    console.log('[MANAGER ROUTE] Manager oversees departments:', managedDepartmentIds);

    // Get CSRs in the manager's departments
    const csrResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT u.id, u.username, u.email, d.department_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN departments d ON u.department_id = d.id
       WHERE u.department_id IN (${managedDepartmentIds.map(() => '?').join(',')})
       AND r.role_name = 'CSR' 
       AND u.is_active = 1
       ORDER BY u.username ASC`,
      ...managedDepartmentIds
    );

    console.log('[MANAGER ROUTE] Found CSRs:', csrResult.length);
    res.json({ data: csrResult, total: csrResult.length });

  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting team CSRs:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getCoursesHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    console.log('[MANAGER ROUTE] Getting courses and training paths for manager:', user_id);

    // Get published courses (courses with pages that are not drafts, similar to trainer query)
    const coursesResult = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT c.id, c.course_name, c.description, c.created_at,
       u.username as creator_name, COUNT(cp.id) as page_count,
       'COURSE' as type
       FROM courses c
       JOIN users u ON c.created_by = u.id
       JOIN course_pages cp ON c.id = cp.course_id
       WHERE c.is_draft = 0
       GROUP BY c.id
       HAVING page_count > 0
       ORDER BY c.course_name ASC
    `);

    // Get training paths (paths with courses, similar to trainer query)
    const pathsResult = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT tp.id, tp.path_name as course_name, '' as description, tp.created_at,
       u.username as creator_name, COUNT(tpc.id) as course_count,
       'PATH' as type
       FROM training_paths tp
       JOIN users u ON tp.created_by = u.id
       JOIN training_path_courses tpc ON tp.id = tpc.path_id
       GROUP BY tp.id
       HAVING course_count > 0
       ORDER BY tp.path_name ASC
    `);

    // Combine courses and training paths
    const combinedResults = [
      ...coursesResult.map((course: any) => ({
        id: course.id,
        course_name: course.course_name,
        description: course.description,
        type: course.type
      })),
      ...pathsResult.map((path: any) => ({
        id: path.id,
        course_name: path.course_name,
        description: `Training Path (${Number(path.course_count)} courses)`,
        type: path.type
      }))
    ].sort((a, b) => a.course_name.localeCompare(b.course_name));

    console.log('[MANAGER ROUTE] Found courses:', coursesResult.length);
    console.log('[MANAGER ROUTE] Found training paths:', pathsResult.length);
    console.log('[MANAGER ROUTE] Total combined:', combinedResults.length);

    res.json({ data: combinedResults, total: combinedResults.length });

  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting courses and training paths:', error);
    res.status(500).json({ message: 'Failed to fetch courses and training paths' });
  }
};

const getFormsHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    console.log('[MANAGER ROUTE] Forms request - user_id:', user_id, 'userRole:', userRole);
    
    if (!user_id || userRole !== 'Manager') {
      console.log('[MANAGER ROUTE] Access denied for forms request');
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    console.log('[MANAGER ROUTE] Getting forms for manager:', user_id);

    // First get the manager's department
    const managerResult = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT department_id FROM users WHERE id = ${user_id}
    `);

    console.log('[MANAGER ROUTE] Manager result:', managerResult);

    if (managerResult.length === 0) {
      console.log('[MANAGER ROUTE] Manager not found');
      return res.status(404).json({ message: 'Manager not found' });
    }

    console.log('[MANAGER ROUTE] Manager department:', managerResult[0].department_id);

    // Get all active forms - removed description column
    const formsResult = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id, form_name, version, interaction_type, created_at
       FROM forms 
       WHERE is_active = 1
       ORDER BY form_name ASC
    `);

    console.log('[MANAGER ROUTE] Forms query result:', formsResult);
    console.log('[MANAGER ROUTE] Found forms:', formsResult.length);
    
    res.json(formsResult);

  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting forms:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getEnrollmentsHandler = async (req: Request, res: Response) => {
  try {
    console.log('[MANAGER ROUTE] === ENROLLMENTS REQUEST START ===');
    console.log('[MANAGER ROUTE] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[MANAGER ROUTE] User from request:', req.user);
    
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    console.log('[MANAGER ROUTE] Extracted user_id:', user_id);
    console.log('[MANAGER ROUTE] Extracted userRole:', userRole);
    
    if (!user_id || userRole !== 'Manager') {
      console.log('[MANAGER ROUTE] Access denied - missing user or wrong role');
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    // Add extensive debugging for the database state
    console.log('[MANAGER ROUTE] === DATABASE DEBUG START ===');
    
    // Check total counts in key tables
    const enrollmentCount = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT COUNT(*) as count FROM enrollments`);
    const userCount = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT COUNT(*) as count FROM users WHERE is_active = 1`);
    const deptCount = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT COUNT(*) as count FROM departments WHERE is_active = 1`);
    const managerUsers = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id, username FROM users WHERE role_id = 5 AND is_active = 1`);
    
    console.log('[MANAGER ROUTE] Total enrollments in database:', Number(enrollmentCount[0].count));
    console.log('[MANAGER ROUTE] Total active users:', Number(userCount[0].count));
    console.log('[MANAGER ROUTE] Total active departments:', Number(deptCount[0].count));
    console.log('[MANAGER ROUTE] All manager users:', managerUsers);
    
    // Check if this specific user is actually a manager with departments
    const userCheck = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT u.id, u.username, r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user_id}
    `);
    console.log('[MANAGER ROUTE] Current user details:', userCheck[0]);
    
    console.log('[MANAGER ROUTE] === DATABASE DEBUG END ===');

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;
    const search = req.query.search as string;
    const csr_id = req.query.csr_id as string;
    const course_id = req.query.course_id as string;
    const status = req.query.status as string;

    console.log('[MANAGER ROUTE] Getting team enrollments for manager:', user_id);
    console.log('[MANAGER ROUTE] Filters:', { search, csr_id, course_id, status });

    // Step 1: Get departments where this user is the manager (via department_managers table)
    const departmentResult = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DISTINCT d.id FROM departments d 
      INNER JOIN department_managers dm ON d.id = dm.department_id 
      WHERE dm.manager_id = ${user_id} AND dm.is_active = 1 AND d.is_active = 1
    `);

    if (departmentResult.length === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        page,
        limit: pageSize
      });
    }

    const departmentIds = departmentResult.map((dept: any) => dept.id);
    console.log('[MANAGER ROUTE] Manager oversees departments:', departmentIds);

    // Step 2: Get CSR role ID 
    const csrRoleResult = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT id FROM roles WHERE role_name = 'CSR'
    `);

    if (csrRoleResult.length === 0) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const csrRoleId = csrRoleResult[0].id;

    // Step 3: Get all CSRs in the managed departments
    const csrResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, username FROM users 
       WHERE department_id IN (${departmentIds.map(() => '?').join(',')}) 
       AND role_id = ? 
       AND is_active = 1`,
      ...departmentIds, csrRoleId
    );

    if (csrResult.length === 0) {
      console.log('[MANAGER ROUTE] No CSRs found in managed departments');
      return res.json({
        success: true,
        data: [],
        total: 0,
        page,
        limit: pageSize
      });
    }

    const csrIds = csrResult.map((csr: any) => csr.id);
    const csrMap = csrResult.reduce((map: any, csr: any) => {
      map[csr.id] = csr.username;
      return map;
    }, {});

    console.log('[MANAGER ROUTE] Found CSRs:', csrIds);

    // Step 4: Get all enrollments for these CSRs (simplified query first)
    const baseQuery = `
      SELECT 
        e.id,
        e.user_id,
        e.course_id,
        e.path_id,
        e.progress,
        e.status,
        e.created_at as enrolled_date,
        COALESCE(c.course_name, tp.path_name) as course_name,
        COALESCE(c.description, 'Training Path') as course_description,
        CASE
          WHEN e.course_id IS NOT NULL THEN 
            COALESCE((SELECT COUNT(*) FROM course_pages cp WHERE cp.course_id = c.id), 0)
          ELSE 10
        END as total_pages,
        CASE
          WHEN e.course_id IS NOT NULL THEN 
            CASE WHEN e.status = 'COMPLETED' THEN 
              COALESCE((SELECT COUNT(*) FROM course_pages cp WHERE cp.course_id = c.id), 0)
            ELSE 0 END
          ELSE 0
        END as completed_pages,
        CASE
          WHEN e.course_id IS NOT NULL THEN 'COURSE'
          WHEN e.path_id IS NOT NULL THEN 'PATH'
          ELSE 'UNKNOWN'
        END as enrollment_type
      FROM enrollments e
      LEFT JOIN courses c ON e.course_id = c.id
      LEFT JOIN training_paths tp ON e.path_id = tp.id
      WHERE e.user_id IN (${csrIds.map(() => '?').join(',')})
      ORDER BY e.created_at DESC
    `;

    console.log('[MANAGER ROUTE] Base query:', baseQuery);
    console.log('[MANAGER ROUTE] Query params:', csrIds);

    const allEnrollmentsResult = await prisma.$queryRawUnsafe<any[]>(baseQuery, ...csrIds);
    console.log('[MANAGER ROUTE] Found total enrollments before filtering:', allEnrollmentsResult.length);

    // Apply filters in memory
    let filteredEnrollments = allEnrollmentsResult;

    // Apply CSR filter
    if (csr_id && csr_id.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by CSR ID:', csr_id);
      filteredEnrollments = filteredEnrollments.filter((enrollment: any) => 
        enrollment.user_id.toString() === csr_id
      );
    }

    // Apply course/path filter
    if (course_id && course_id.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by course/path ID:', course_id);
      const courseIdInt = parseInt(course_id);
      filteredEnrollments = filteredEnrollments.filter((enrollment: any) => 
        enrollment.course_id === courseIdInt || enrollment.path_id === courseIdInt
      );
    }

    // Apply status filter
    if (status && status.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by status:', status);
      filteredEnrollments = filteredEnrollments.filter((enrollment: any) => 
        enrollment.status === status
      );
    }

    // Apply search filter
    if (search && search.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by search term:', search);
      const searchTerm = search.trim().toLowerCase();
      filteredEnrollments = filteredEnrollments.filter((enrollment: any) => 
        csrMap[enrollment.user_id]?.toLowerCase().includes(searchTerm) ||
        enrollment.course_name?.toLowerCase().includes(searchTerm)
      );
    }

    console.log('[MANAGER ROUTE] Enrollments after memory filtering:', filteredEnrollments.length);

    // Apply pagination
    const total = filteredEnrollments.length;
    const paginatedEnrollments = filteredEnrollments.slice(offset, offset + pageSize);

    console.log('[MANAGER ROUTE] Final enrollments after pagination:', paginatedEnrollments.length, 'of', total);

    // Format the final response
    const formattedEnrollments = paginatedEnrollments.map((enrollment: any) => ({
      id: enrollment.id,
      user_id: enrollment.user_id,
      csr_name: csrMap[enrollment.user_id] || 'Unknown',
      csr_email: '', // Not available in this query
      course_id: enrollment.course_id || enrollment.path_id, // Use course_id or path_id
      course_name: enrollment.course_name,
      course_description: enrollment.course_description || '',
      progress: enrollment.progress || 0,
      status: enrollment.status,
      enrolled_date: enrollment.enrolled_date,
      due_date: '', // Calculate if needed
      display_status: enrollment.status === 'COMPLETED' ? 'Completed' : 'In Progress',
      total_pages: Number(enrollment.total_pages) || 0,
      completed_pages: Number(enrollment.completed_pages) || 0,
      progressText: `${Number(enrollment.completed_pages) || 0}/${Number(enrollment.total_pages) || 0} pages`,
      progressPercentage: Number(enrollment.total_pages) > 0 ? 
        Math.round(((Number(enrollment.completed_pages) || 0) / Number(enrollment.total_pages)) * 100) : 0,
      enrollment_type: enrollment.enrollment_type || 'COURSE'
    }));

    res.json({
      success: true,
      data: formattedEnrollments,
      total,
      page,
      limit: pageSize
    });

  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting enrollments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch training data' });
  }
};

// All manager routes require authentication
router.use(authenticate as unknown as RequestHandler);

// Manager role authorization is now handled by the centralized authorizeManager middleware

// GET /api/manager/stats - Get manager dashboard statistics  
router.get('/stats', getManagerDashboardStats as unknown as RequestHandler);

// GET /api/manager/dashboard-stats - Get manager dashboard statistics (new format)
router.get('/dashboard-stats', getManagerDashboardStats as unknown as RequestHandler);

// GET /api/manager/csr-activity - Get manager CSR activity data
router.get('/csr-activity', getManagerCSRActivity as unknown as RequestHandler);

// GET /api/manager/audits - Get team audits with pagination
const getTeamAuditsHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    // Return placeholder audit data for now
    const audits = [
      {
        id: 1,
        call_id: 101,
        call_external_id: "CALL-101",
        form_name: "Customer Service QA",
        csr_name: "John Doe",
        qa_name: "Jane Smith",
        submitted_at: "2024-01-15T10:30:00Z",
        total_score: 87.5,
        status: "FINALIZED"
      },
      {
        id: 2,
        call_id: 102,
        call_external_id: "CALL-102",
        form_name: "Technical Support QA",
        csr_name: "Bob Wilson",
        qa_name: "Alice Brown",
        submitted_at: "2024-01-14T14:15:00Z",
        total_score: 92.0,
        status: "SUBMITTED"
      }
    ];

    res.status(200).json({
      data: audits,
      pagination: {
        page,
        limit,
        total: audits.length,
        totalPages: Math.ceil(audits.length / limit)
      }
    });
  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting team audits:', error);
    res.status(500).json({ message: 'Failed to fetch team audits' });
  }
};

// GET /api/manager/team-audits - Get team audits with filtering and pagination
const getTeamAuditsWithFiltersHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const csr_id = req.query.csr_id as string;
    const form_id_search = req.query.form_id_search as string;
    const form_id = req.query.form_id as string;
    const form_name = req.query.form_name as string;  // Add form_name support like CSR
    const status = req.query.status as string;
    const dispute_status = req.query.dispute_status as string;
    const start_date = req.query.start_date as string;
    const end_date = req.query.end_date as string;
    
    // Use form_id_search if provided, otherwise use form_id
    const effectiveFormId = form_id_search && form_id_search.trim() !== '' ? form_id_search : form_id;

    console.log('[MANAGER ROUTE] Getting team audits for manager:', user_id);
    console.log('[MANAGER ROUTE] Filters:', { search, csr_id, form_id: effectiveFormId, form_name, status, dispute_status, start_date, end_date });

    // Step 1: Get departments where this user is the manager
    const departmentResult = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT d.id, d.department_name 
      FROM departments d
      INNER JOIN department_managers dm ON d.id = dm.department_id
      WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
    `);

    if (departmentResult.length === 0) {
      return res.status(403).json({ message: 'No departments assigned to this manager' });
    }

    const managedDepartmentIds = departmentResult.map(dept => dept.id);
    console.log('[MANAGER ROUTE] Manager oversees departments:', managedDepartmentIds);

    // Step 2: Get CSR IDs from metadata for the managed departments
    const csrMetadataResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT DISTINCT sm.value as csr_id, u.username as csr_name
       FROM submission_metadata sm
       JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
       JOIN users u ON CAST(sm.value AS UNSIGNED) = u.id
       JOIN departments d ON u.department_id = d.id
       WHERE fmf.field_name = 'CSR' 
       AND d.id IN (${managedDepartmentIds.map(() => '?').join(',')})
       AND u.is_active = 1`,
      ...managedDepartmentIds
    );

    if (csrMetadataResult.length === 0) {
      console.log('[MANAGER ROUTE] No CSRs found in metadata for managed departments');
      return res.json({
        audits: [],
        totalCount: 0,
        page,
        limit
      });
    }

    console.log('[MANAGER ROUTE] Found CSRs in metadata:', csrMetadataResult.map((csr: any) => `${csr.csr_id}:${csr.csr_name}`));

    // Create CSR map for names
    const csrMap = csrMetadataResult.reduce((map: any, csr: any) => {
      map[csr.csr_id] = csr.csr_name;
      return map;
    }, {});

    // Step 3: Simplified approach - get all audits for these CSRs first, then filter in memory
    const csrIds = csrMetadataResult.map((csr: any) => csr.csr_id);
    console.log('[MANAGER ROUTE] Found CSR IDs for query:', csrIds);

    const baseQuery = `
      SELECT DISTINCT
        s.id,
        s.form_id,
        s.total_score,
        s.submitted_at,
        s.status,
        f.form_name,
        sm.value as csr_id,
        qa.username as qa_analyst_name
      FROM submissions s
      JOIN forms f ON s.form_id = f.id
      JOIN submission_metadata sm ON sm.submission_id = s.id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users qa ON s.submitted_by = qa.id
      WHERE fmf.field_name = 'CSR' AND sm.value IN (${csrIds.map(() => '?').join(',')})
      ORDER BY s.submitted_at DESC
    `;

    console.log('[MANAGER ROUTE] Base query:', baseQuery);
    console.log('[MANAGER ROUTE] Query params:', csrIds);

    const allAuditsResult = await prisma.$queryRawUnsafe<any[]>(baseQuery, ...csrIds);
    console.log('[MANAGER ROUTE] Found total audits before filtering:', allAuditsResult.length);

    // Apply filters in memory
    let filteredAudits = allAuditsResult;

    // Apply status filter
    if (status && status.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by status:', status);
      filteredAudits = filteredAudits.filter((audit: any) => audit.status === status);
    }

    // Apply CSR filter
    if (csr_id && csr_id.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by CSR ID:', csr_id);
      filteredAudits = filteredAudits.filter((audit: any) => audit.csr_id === csr_id);
    }

    // Apply form filter (EXACT COPY FROM CSR MY AUDITS)
    if (form_name && form_name.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by form name:', form_name);
      filteredAudits = filteredAudits.filter((audit: any) => 
        audit.form_name && audit.form_name.toLowerCase().includes(form_name.toLowerCase())
      );
    }
    
    // Apply form filter by ID (supports both form_id_search and legacy form_id)
    if (effectiveFormId && effectiveFormId.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by form ID:', effectiveFormId);
      const formIdInt = parseInt(effectiveFormId);
      filteredAudits = filteredAudits.filter((audit: any) => audit.form_id === formIdInt);
    }

    // Apply date filters
    if (start_date && start_date.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by start date:', start_date);
      filteredAudits = filteredAudits.filter((audit: any) => {
        const auditDate = new Date(audit.submitted_at).toISOString().split('T')[0];
        return auditDate >= start_date;
      });
    }

    if (end_date && end_date.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by end date:', end_date);
      filteredAudits = filteredAudits.filter((audit: any) => {
        const auditDate = new Date(audit.submitted_at).toISOString().split('T')[0];
        return auditDate <= end_date;
      });
    }

    // Apply search filter (improved to include CSR names)
    if (search && search.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by search term:', search);
      const searchTerm = search.trim().toLowerCase();
      filteredAudits = filteredAudits.filter((audit: any) => {
        const csrName = csrMap[audit.csr_id] || '';
        return audit.form_name.toLowerCase().includes(searchTerm) ||
               audit.id.toString().includes(searchTerm) ||
               csrName.toLowerCase().includes(searchTerm);
      });
    }

    console.log('[MANAGER ROUTE] Audits after memory filtering:', filteredAudits.length);

    // Get dispute information for all filtered audits before pagination
    const auditIds = filteredAudits.map((audit: any) => audit.id);
    let disputeMap: any = {};
    
    if (auditIds.length > 0) {
      const disputeResults = await prisma.$queryRawUnsafe<any[]>(
        `SELECT 
          submission_id,
          status as dispute_status,
          id as dispute_id
        FROM disputes 
        WHERE submission_id IN (${auditIds.map(() => '?').join(',')})`,
        ...auditIds
      );
      
      disputeMap = disputeResults.reduce((map: any, dispute: any) => {
        map[dispute.submission_id] = {
          dispute_status: dispute.dispute_status || 'None',
          dispute_id: dispute.dispute_id
        };
        return map;
      }, {});
    }

    // Apply dispute status filter if needed
    if (dispute_status && dispute_status.trim() !== '') {
      console.log('[MANAGER ROUTE] Filtering by dispute status:', dispute_status);
      filteredAudits = filteredAudits.filter((audit: any) => {
        const dispute = disputeMap[audit.id] || { dispute_status: 'None' };
        if (dispute_status === 'None') {
          return dispute.dispute_status === 'None';
        } else if (dispute_status === 'Pending') {
          return dispute.dispute_status === 'OPEN';
        } else if (dispute_status === 'Resolved') {
          return ['UPHELD', 'REJECTED', 'ADJUSTED'].includes(dispute.dispute_status);
        }
        return false;
      });
    }

    // Apply pagination
    const total = filteredAudits.length;
    const paginatedAudits = filteredAudits.slice(offset, offset + limit);

    console.log('[MANAGER ROUTE] Final audits after all filtering and pagination:', paginatedAudits.length, 'of', total);

    // Format the final response
    const finalAudits = paginatedAudits.map((row: any) => {
      const dispute = disputeMap[row.id] || { dispute_status: 'None', dispute_id: null };
      
      return {
        id: row.id,
        csr_id: parseInt(row.csr_id),
        csr_name: csrMap[row.csr_id] || 'Unknown',
        form_id: row.form_id,
        form_name: row.form_name,
        total_score: parseFloat(row.total_score) || 0,
        qa_analyst_name: row.qa_analyst_name,
        submitted_at: row.submitted_at,
        status: row.status,
        dispute_id: dispute.dispute_id,
        dispute_status: dispute.dispute_status
      };
    });

    res.status(200).json({
      audits: finalAudits,
      totalCount: total,
      page,
      limit
    });

  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting filtered team audits:', error);
    res.status(500).json({ message: 'Failed to fetch filtered team audits' });
  }
};

// GET /api/manager/team-audits/:id - Get detailed audit information
router.get('/team-audits/:id', getManagerTeamAuditDetails as unknown as RequestHandler);

// GET /api/manager/team-csrs - Get CSRs in manager's team
router.get('/team-csrs', getTeamCSRsHandler as unknown as RequestHandler);

// GET /api/manager/enrollments/:enrollment_id - Get detailed training enrollment information
const getEnrollmentDetailsHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    const enrollment_id = parseInt(req.params.enrollment_id);
    
    if (!enrollment_id || isNaN(enrollment_id)) {
      return res.status(400).json({ success: false, message: 'Invalid enrollment ID' });
    }

    console.log('[MANAGER ROUTE] Getting enrollment details for:', enrollment_id);

    // First verify this manager has permission by checking if the CSR is under their management
    const verifyRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT e.id
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      JOIN departments d ON u.department_id = d.id
      JOIN department_managers dm ON d.id = dm.department_id
      WHERE e.id = ${enrollment_id} 
      AND dm.manager_id = ${user_id}
      AND dm.is_active = 1
      AND u.is_active = 1
      AND d.is_active = 1
    `);
    
    if (verifyRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Training enrollment not found or you do not have permission to view it' });
    }

    // Get enrollment details (supporting both courses and training paths)
    const enrollmentRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        e.id,
        e.course_id,
        e.path_id,
        e.user_id,
        e.status,
        e.progress,
        e.created_at as enrolled_date,
        u.username as csr_name,
        u.email as csr_email,
        COALESCE(c.course_name, tp.path_name) as course_name,
        COALESCE(c.description, CONCAT('Training Path with ', 
          (SELECT COUNT(*) FROM training_path_courses tpc WHERE tpc.path_id = tp.id), 
          ' courses')) as course_description,
        d.department_name as csr_department,
        CASE
          WHEN e.course_id IS NOT NULL THEN 
            (SELECT COUNT(*) FROM course_pages cp WHERE cp.course_id = c.id)
          WHEN e.path_id IS NOT NULL THEN
            (SELECT SUM(page_count.total) FROM (
              SELECT COUNT(cp.id) as total
              FROM training_path_courses tpc
              JOIN course_pages cp ON tpc.course_id = cp.course_id
              WHERE tpc.path_id = tp.id
              GROUP BY tpc.course_id
            ) as page_count)
          ELSE 0
        END as total_pages,
        CASE
          WHEN e.course_id IS NOT NULL THEN 
            (SELECT COUNT(*) FROM training_logs tl 
             WHERE tl.user_id = e.user_id 
             AND tl.course_id = e.course_id 
             AND tl.action = 'PAGE_COMPLETED')
          WHEN e.path_id IS NOT NULL THEN
            (SELECT COUNT(*) FROM training_logs tl 
             JOIN training_path_courses tpc ON tl.course_id = tpc.course_id
             WHERE tl.user_id = e.user_id 
             AND tpc.path_id = e.path_id
             AND tl.action = 'PAGE_COMPLETED')
          ELSE 0
        END as completed_pages,
        CASE
          WHEN e.course_id IS NOT NULL THEN 'COURSE'
          WHEN e.path_id IS NOT NULL THEN 'PATH'
          ELSE 'UNKNOWN'
        END as enrollment_type
      FROM enrollments e
      JOIN users u ON e.user_id = u.id
      LEFT JOIN courses c ON e.course_id = c.id
      LEFT JOIN training_paths tp ON e.path_id = tp.id
      JOIN departments d ON u.department_id = d.id
      WHERE e.id = ${enrollment_id}
    `);
    
    if (enrollmentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }
    
    const enrollment = enrollmentRows[0];

    // Get course pages with completion status (supporting both courses and training paths)
    let coursePagesRows: any[] = [];
    
    if (enrollment.course_id) {
      // Single course enrollment
      coursePagesRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          cp.id,
          cp.page_title,
          cp.content_type,
          cp.page_order,
          c.course_name,
          CASE 
            WHEN e.status = 'COMPLETED' THEN 'COMPLETED'
            ELSE 'NOT_STARTED'
          END as completion_status
        FROM course_pages cp
        JOIN courses c ON cp.course_id = c.id
        JOIN enrollments e ON e.course_id = c.id AND e.user_id = ${enrollment.user_id}
        WHERE cp.course_id = ${enrollment.course_id}
        ORDER BY cp.page_order ASC
      `);
    } else if (enrollment.path_id) {
      // Training path enrollment - get pages from all courses in the path
      coursePagesRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          cp.id,
          cp.page_title,
          cp.content_type,
          cp.page_order + (tpc.course_order * 1000) as page_order,
          c.course_name,
          CASE 
            WHEN e.status = 'COMPLETED' THEN 'COMPLETED'
            ELSE 'NOT_STARTED'
          END as completion_status
        FROM training_path_courses tpc
        JOIN courses c ON tpc.course_id = c.id
        JOIN course_pages cp ON c.id = cp.course_id
        JOIN enrollments e ON e.path_id = ${enrollment.path_id} AND e.user_id = ${enrollment.user_id}
        WHERE tpc.path_id = ${enrollment.path_id}
        ORDER BY tpc.course_order ASC, cp.page_order ASC
      `);
    }

    // Format the response
    const formattedEnrollment = {
      enrollment: {
        id: enrollment.id,
        csrName: enrollment.csr_name,
        csrEmail: enrollment.csr_email,
        csrDepartment: enrollment.csr_department,
        course_name: enrollment.course_name,
        courseDescription: enrollment.course_description || '',
        progress: enrollment.progress || 0,
        progressText: `${Number(enrollment.completed_pages) || 0}/${Number(enrollment.total_pages) || 0} pages`,
        status: enrollment.status,
        enrolledDate: enrollment.enrolled_date,
        dueDate: null // Calculate if needed
      },
      coursePages: coursePagesRows,
      quizResults: [], // Could be implemented if quiz data exists
      certificate: null // Could be implemented if certificate data exists
    };

    res.json({
      success: true,
      data: formattedEnrollment
    });

  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting enrollment details:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch enrollment details' });
  }
};

router.get('/enrollments/:enrollment_id', getEnrollmentDetailsHandler as unknown as RequestHandler);

// GET /api/manager/disputes - Get team disputes with pagination and filters
const getTeamDisputesHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    // Return placeholder disputes data
    const disputes = [
      {
        id: 1,
        submission_id: 25,
        call_external_id: "CALL-105",
        csr_name: "John Doe",
        disputed_by_name: "John Doe",
        reason: "Disagree with scoring on greeting category",
        status: "PENDING",
        created_at: "2024-01-16T11:20:00Z",
        original_score: 82.5,
        form_name: "Customer Service QA"
      },
      {
        id: 2,
        submission_id: 28,
        call_external_id: "CALL-108",
        csr_name: "Sarah Johnson",
        disputed_by_name: "Sarah Johnson",
        reason: "Technical issue during call not considered",
        status: "UNDER_REVIEW",
        created_at: "2024-01-15T16:45:00Z",
        original_score: 75.0,
        form_name: "Technical Support QA"
      }
    ].filter(dispute => !status || dispute.status === status);

    res.status(200).json({
      data: disputes,
      pagination: {
        page,
        limit,
        total: disputes.length,
        totalPages: Math.ceil(disputes.length / limit)
      }
    });
  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting team disputes:', error);
    res.status(500).json({ message: 'Failed to fetch team disputes' });
  }
};

// =====================
// COACHING SESSIONS ROUTES
// =====================

router.get('/coaching-sessions', getManagerCoachingSessions as unknown as RequestHandler);
router.get('/coaching-sessions/export', exportManagerCoachingSessions as unknown as RequestHandler);
router.get('/coaching-sessions/:sessionId', getManagerCoachingSessionDetails as unknown as RequestHandler);
router.get('/coaching-sessions/:sessionId/attachment', downloadManagerCoachingSessionAttachment as unknown as RequestHandler);
router.post('/coaching-sessions', upload.single('attachment'), createManagerCoachingSession as unknown as RequestHandler);
router.put('/coaching-sessions/:sessionId', upload.single('attachment'), updateManagerCoachingSession as unknown as RequestHandler);
router.patch('/coaching-sessions/:sessionId/complete', completeManagerCoachingSession as unknown as RequestHandler);
router.patch('/coaching-sessions/:sessionId/reopen', reopenManagerCoachingSession as unknown as RequestHandler);

// =====================
// TEAM PERFORMANCE & GOALS ROUTES
// =====================

// GET /api/manager/team/filters - Get filter options for team reports
const getTeamFiltersHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    // Use analytics service to get filter options
    const filters = await analyticsService.getFilterOptions(user_id, userRole);
    
    // Add manager-specific filters
    const managerFilters = {
      ...filters,
      auditStatuses: [
        { id: 'DRAFT', name: 'Draft' },
        { id: 'SUBMITTED', name: 'Submitted' },
        { id: 'FINALIZED', name: 'Finalized' },
        { id: 'DISPUTED', name: 'Disputed' }
      ],
      disputeStatuses: [
        { id: 'PENDING', name: 'Pending Review' },
        { id: 'UNDER_REVIEW', name: 'Under Review' },
        { id: 'RESOLVED', name: 'Resolved' },
        { id: 'REJECTED', name: 'Rejected' }
      ]
    };

    res.status(200).json(managerFilters);
  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting team filters:', error);
    res.status(500).json({ message: 'Failed to fetch team filters' });
  }
};

// POST /api/manager/team/reports - Generate team performance report
router.post('/team/reports', generateTeamReport as unknown as RequestHandler);

// GET /api/manager/team/goals - Get team performance goals
router.get('/team/goals', getTeamGoalsHandler as unknown as RequestHandler);

// GET /api/manager/team/export/:reportId - Export team report
router.get('/team/export/:reportId', exportTeamReport as unknown as RequestHandler);

// Test endpoint for debugging
const testEnrollmentsHandler = async (req: Request, res: Response) => {
  console.log('[MANAGER ROUTE] TEST ENDPOINT CALLED');
  console.log('[MANAGER ROUTE] User:', req.user);
  
  res.json({
    success: true,
    data: [
      {
        id: 1,
        user_id: 1,
        csr_name: 'Test CSR',
        csr_email: 'test@example.com',
        course_id: 1,
        course_name: 'Test Course',
        course_description: 'Test Description',
        progress: 50,
        status: 'IN_PROGRESS',
        enrolled_date: '2024-01-01',
        due_date: '',
        display_status: 'In Progress',
        total_pages: 10,
        completed_pages: 5,
        progressText: '5/10 pages',
        progressPercentage: 50,
        enrollment_type: 'COURSE'
      }
    ],
    total: 1,
    page: 1,
    limit: 20
  });
};

// Newly implemented endpoints
router.get('/courses', getCoursesHandler as unknown as RequestHandler);
router.get('/forms', getFormsHandler as unknown as RequestHandler);
router.get('/enrollments', getEnrollmentsHandler as unknown as RequestHandler);
router.get('/enrollments-test', testEnrollmentsHandler as unknown as RequestHandler);

router.get('/audits', getTeamAuditsHandler as unknown as RequestHandler);

// GET /api/manager/team-audits - Get team audits with filtering and pagination
router.get('/team-audits', getTeamAuditsWithFiltersHandler as unknown as RequestHandler);

// GET /api/manager/team/filters - Get filter options for team reports
router.get('/team/filters', getTeamFiltersHandler as unknown as RequestHandler);

// Dispute management handlers
const resolveDisputeHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    const disputeId = req.params.disputeId;
    const { resolution, notes } = req.body;

    // Placeholder dispute resolution logic
    const resolvedDispute = {
      id: parseInt(disputeId),
      status: 'RESOLVED',
      resolved_by: user_id,
      resolved_at: new Date().toISOString(),
      resolution: resolution || 'Dispute resolved by manager',
      notes: notes || 'No additional notes'
    };

    res.status(200).json({
      message: 'Dispute resolved successfully',
      dispute: resolvedDispute
    });
  } catch (error) {
    console.error('[MANAGER ROUTE] Error resolving dispute:', error);
    res.status(500).json({ message: 'Failed to resolve dispute' });
  }
};

const getDisputeDetailsHandler = async (req: Request, res: Response) => {
  try {
    const user_id = req.user?.user_id;
    const userRole = req.user?.role;
    
    if (!user_id || userRole !== 'Manager') {
      return res.status(403).json({ message: 'Access denied. Manager role required' });
    }

    const disputeId = req.params.disputeId;

    // Return detailed dispute information (placeholder)
    const disputeDetails = {
      id: parseInt(disputeId),
      submission_id: 25,
      call_external_id: "CALL-105",
      csr_name: "John Doe",
      disputed_by_name: "John Doe",
      reason: "Disagree with scoring on greeting category",
      detailed_reason: "The greeting was appropriate given the context of the call. Customer was already agitated and a more formal greeting would have escalated the situation.",
      status: "PENDING",
      created_at: "2024-01-16T11:20:00Z",
      original_score: 82.5,
      form_name: "Customer Service QA",
      original_submission: {
        categories: [
          {
            name: "Greeting & Opening",
            original_score: 75,
            disputed: true,
            dispute_reason: "Score too low for appropriate greeting"
          },
          {
            name: "Problem Resolution",
            original_score: 90,
            disputed: false
          }
        ]
      },
      history: [
        {
          action: "CREATED",
          by: "John Doe",
          at: "2024-01-16T11:20:00Z",
          notes: "Initial dispute submission"
        }
      ]
    };

    res.status(200).json(disputeDetails);
  } catch (error) {
    console.error('[MANAGER ROUTE] Error getting dispute details:', error);
    res.status(500).json({ message: 'Failed to fetch dispute details' });
  }
};

// Add dispute routes
router.get('/disputes', getManagerTeamDisputes as unknown as RequestHandler);
router.get('/disputes/export', exportManagerTeamDisputes as unknown as RequestHandler);
router.post('/disputes/:disputeId/resolve', resolveManagerDispute as unknown as RequestHandler);
router.put('/disputes/:disputeId/resolve', resolveDisputeWithFormEdit as unknown as RequestHandler);
router.get('/disputes/:disputeId', getManagerDisputeDetails as unknown as RequestHandler);

export default router;
