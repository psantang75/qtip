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
        s.critical_fail_count,
        s.score_capped,
        s.submitted_at,
        s.status,
        f.form_name,
        sm.value as csr_id,
        qa.username as qa_analyst_name,
        (
          SELECT sm2.value
          FROM submission_metadata sm2
          JOIN form_metadata_fields fmf2 ON sm2.field_id = fmf2.id
          WHERE sm2.submission_id = s.id AND fmf2.field_name IN ('Interaction Date', 'Call Date')
          LIMIT 1
        ) as interaction_date
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
        critical_fail_count: Number(row.critical_fail_count ?? 0),
        score_capped: Boolean(row.score_capped),
        qa_analyst_name: row.qa_analyst_name,
        submitted_at: row.submitted_at,
        status: row.status,
        dispute_id: dispute.dispute_id,
        dispute_status: dispute.dispute_status,
        interaction_date: row.interaction_date ?? null
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

router.get('/forms', getFormsHandler as unknown as RequestHandler);
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
