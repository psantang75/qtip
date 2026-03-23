import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { 
  QAScoreRecord, 
  ReportFilters, 
  QAScoreTrendResponse, 
  GroupedScoreData,
  ScoreTrendDataPoint,
  ScoreDistributionResponse,
  ScoreDistribution,
  PerformanceGoalData
} from '../types/analytics.types';

// Extending the JwtPayload for our needs
interface UserJwtPayload {
  user_id: number;
  role?: string;  // Sometimes present in the req.user
  role_id?: number; // Sometimes present in the req.user
}

/**
 * Get available filter options for analytics reports
 * @route GET /api/analytics/filters
 */
export const getFilterOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    // Get user info from request
    const user = req.user as UserJwtPayload;
    
    // Get user role if not directly available
    let userRole: string | undefined = user.role;
    if (!userRole && user.role_id) {
      const roleRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT role_name FROM roles WHERE id = ${user.role_id}
      `);
      userRole = roleRows[0]?.role_name;
    } else if (!userRole) {
      const userRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user.user_id}
      `);
      userRole = userRows[0]?.role_name;
    }
    
    // Get departments based on user role
    let departments: any[];
    if (userRole === 'Manager') {
      departments = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT d.id, d.department_name 
        FROM departments d
        INNER JOIN department_managers dm ON d.id = dm.department_id
        WHERE dm.manager_id = ${user.user_id} AND dm.is_active = 1
        ORDER BY d.department_name
      `);
    } else {
      departments = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT id, department_name 
        FROM departments 
        ORDER BY department_name
      `);
    }
    
    // Get forms - include all forms (active and inactive) with user version info
    const forms = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DISTINCT id, form_name, user_version, user_version_date, is_active, version
      FROM forms 
      ORDER BY form_name, version DESC
    `);
    
    // Get CSRs - if manager, only their department
    let csrs: any[];
    if (userRole === 'Manager') {
      csrs = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT u.id, u.username 
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE r.role_name = 'CSR'
        AND u.department_id = (
          SELECT department_id FROM users WHERE id = ${user.user_id}
        )
        ORDER BY u.username
      `);
    } else {
      csrs = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT u.id, u.username 
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE r.role_name = 'CSR'
        ORDER BY u.username
      `);
    }
    
    // Get date range presets
    const datePresets = [
      { id: 'last7days', name: 'Last 7 Days' },
      { id: 'last30days', name: 'Last 30 Days' },
      { id: 'last90days', name: 'Last 90 Days' },
      { id: 'thisMonth', name: 'This Month' },
      { id: 'lastMonth', name: 'Last Month' },
      { id: 'thisQuarter', name: 'This Quarter' },
      { id: 'thisYear', name: 'This Year' }
    ];
    
    res.status(200).json({
      departments,
      forms,
      csrs,
      datePresets
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({ message: 'Failed to fetch filter options' });
  }
};

/**
 * Get QA score trends
 * @route POST /api/analytics/qa-score-trends
 */
export const getQAScoreTrends = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters: ReportFilters = req.body;
    const user = req.user as UserJwtPayload;
    
    // Get user role if not directly available
    let userRole: string | undefined = user.role;
    if (!userRole && user.role_id) {
      const roleRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT role_name FROM roles WHERE id = ${user.role_id}
      `);
      userRole = roleRows[0]?.role_name;
    } else if (!userRole) {
      const userRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user.user_id}
      `);
      userRole = userRows[0]?.role_name;
    }
    
    // Base query - always group by CSR (groupBy filter removed)
    let query = `
      SELECT 
        DATE(s.submitted_at) AS date,
        s.total_score,
        s.id AS submission_id,
        u.id AS group_id,
        u.username AS group_name
      FROM 
        submissions s
        JOIN calls c ON s.call_id = c.id
        JOIN users u ON c.csr_id = u.id
        JOIN forms f ON s.form_id = f.id
        LEFT JOIN departments d ON u.department_id = d.id
      WHERE 
        s.submitted_at BETWEEN ? AND ?
        AND s.status IN ('SUBMITTED', 'FINALIZED')
    `;
    
    // Add time to end date to include the full day
    const endDateWithTime = `${filters.end_date} 23:59:59`;
    const queryParams: any[] = [filters.start_date, endDateWithTime];
    
    // Additional filters
    if (filters.department_id) {
      query += ` AND u.department_id = ?`;
      queryParams.push(filters.department_id);
    } else if (userRole === 'Manager') {
      query += ` AND u.department_id = (SELECT department_id FROM users WHERE id = ?)`;
      queryParams.push(user.user_id);
    }
    
    if (filters.csrIds && filters.csrIds.length > 0) {
      query += ` AND c.csr_id IN (${filters.csrIds.map(() => '?').join(',')})`;
      queryParams.push(...filters.csrIds);
    }
    
    if (filters.form_id) {
      query += ` AND s.form_id = ?`;
      queryParams.push(filters.form_id);
    }
    
    // Group by date and CSR
    query += ` GROUP BY DATE(s.submitted_at), u.id
               ORDER BY DATE(s.submitted_at), u.username`;
    
    // Execute query
    const rows = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams);
    
    // Process the data for charting
    const groupedData = new Map<number, GroupedScoreData>();
    let total_score = 0;
    let totalCount = 0;
    
    rows.forEach(row => {
      const group_id = row.group_id;
      const date = new Date(row.date).toISOString().split('T')[0];
      const score = parseFloat(row.total_score);
      
      total_score += score;
      totalCount++;
      
      if (!groupedData.has(group_id)) {
        groupedData.set(group_id, {
          id: group_id,
          name: row.group_name,
          data: [],
          averageScore: 0
        });
      }
      
      const group = groupedData.get(group_id)!;
      
      // Find if we already have data for this date
      const existingDataPoint = group.data.find((dp: ScoreTrendDataPoint) => dp.date === date);
      
      if (existingDataPoint) {
        existingDataPoint.score = ((existingDataPoint.score * existingDataPoint.count) + score) / (existingDataPoint.count + 1);
        existingDataPoint.count++;
      } else {
        group.data.push({
          date,
          score,
          count: 1
        });
      }
    });
    
    // Calculate average scores for each group
    groupedData.forEach(group => {
      let groupTotal = 0;
      let groupCount = 0;
      
      group.data.forEach((dp: ScoreTrendDataPoint) => {
        groupTotal += dp.score * dp.count;
        groupCount += dp.count;
      });
      
      group.averageScore = groupCount > 0 ? groupTotal / groupCount : 0;
      
      // Sort data points by date
      group.data.sort((a: ScoreTrendDataPoint, b: ScoreTrendDataPoint) => new Date(a.date).getTime() - new Date(b.date).getTime());
    });
    
    const response: QAScoreTrendResponse = {
      trends: Array.from(groupedData.values()),
      overall: {
        averageScore: totalCount > 0 ? total_score / totalCount : 0,
        totalAudits: totalCount
      }
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching QA score trends:', error);
    res.status(500).json({ message: 'Failed to fetch QA score trends' });
  }
};

/**
 * Get QA score distribution
 * @route POST /api/analytics/qa-score-distribution
 */
export const getQAScoreDistribution = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters: ReportFilters = req.body;
    const user = req.user as UserJwtPayload;
    
    // Get user role if not directly available
    let userRole: string | undefined = user.role;
    if (!userRole && user.role_id) {
      const roleRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT role_name FROM roles WHERE id = ${user.role_id}
      `);
      userRole = roleRows[0]?.role_name;
    } else if (!userRole) {
      const userRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user.user_id}
      `);
      userRole = userRows[0]?.role_name;
    }
    
    // Base query
    let query = `
      SELECT 
        s.total_score
      FROM 
        submissions s
        JOIN calls c ON s.call_id = c.id
        JOIN users u ON c.csr_id = u.id
        JOIN forms f ON s.form_id = f.id
        LEFT JOIN departments d ON u.department_id = d.id
      WHERE 
        s.submitted_at BETWEEN ? AND ?
        AND s.status IN ('SUBMITTED', 'FINALIZED')
    `;
    
    // Add time to end date to include the full day
    const endDateWithTime = `${filters.end_date} 23:59:59`;
    const queryParams: any[] = [filters.start_date, endDateWithTime];
    
    // Additional filters
    if (filters.department_id) {
      query += ` AND u.department_id = ?`;
      queryParams.push(filters.department_id);
    } else if (userRole === 'Manager') {
      query += ` AND u.department_id = (SELECT department_id FROM users WHERE id = ?)`;
      queryParams.push(user.user_id);
    }
    
    if (filters.csrIds && filters.csrIds.length > 0) {
      query += ` AND c.csr_id IN (${filters.csrIds.map(() => '?').join(',')})`;
      queryParams.push(...filters.csrIds);
    }
    
    if (filters.form_id) {
      query += ` AND s.form_id = ?`;
      queryParams.push(filters.form_id);
    }
    
    // Execute query
    const rows = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams);
    
    // Define score ranges
    const scoreRanges = [
      { range: '90-100', min: 90, max: 100 },
      { range: '80-89', min: 80, max: 89.99 },
      { range: '70-79', min: 70, max: 79.99 },
      { range: '60-69', min: 60, max: 69.99 },
      { range: 'Below 60', min: 0, max: 59.99 }
    ];
    
    // Initialize distribution with zero counts
    const distribution: ScoreDistribution[] = scoreRanges.map(range => ({
      range: range.range,
      count: 0,
      percentage: 0
    }));
    
    // Count scores in each range
    const totalAudits = rows.length;
    rows.forEach(row => {
      const score = parseFloat(row.total_score);
      const rangeIndex = scoreRanges.findIndex(range => score >= range.min && score <= range.max);
      if (rangeIndex !== -1) {
        distribution[rangeIndex].count++;
      }
    });
    
    // Calculate percentages
    distribution.forEach(dist => {
      dist.percentage = totalAudits > 0 ? (dist.count / totalAudits) * 100 : 0;
    });
    
    const response: ScoreDistributionResponse = {
      distributions: distribution,
      totalAudits
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching QA score distribution:', error);
    res.status(500).json({ message: 'Failed to fetch QA score distribution' });
  }
};

/**
 * Get performance against goals
 * @route POST /api/analytics/performance-goals
 */
export const getPerformanceGoals = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters: ReportFilters = req.body;
    const user = req.user as UserJwtPayload;
    
    // Get user role if not directly available
    let userRole: string | undefined = user.role;
    if (!userRole && user.role_id) {
      const roleRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT role_name FROM roles WHERE id = ${user.role_id}
      `);
      userRole = roleRows[0]?.role_name;
    } else if (!userRole) {
      const userRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user.user_id}
      `);
      userRole = userRows[0]?.role_name;
    }
    
    // Get active goals
    let goalsQuery = `
      SELECT 
        pg.id,
        pg.goal_type,
        pg.target_value,
        pg.scope,
        pg.department_id
      FROM 
        performance_goals pg
      WHERE 
        pg.is_active = 1
    `;
    
    const goalsParams: any[] = [];
    
    // Filter by department if specified
    if (filters.department_id) {
      goalsQuery += ` AND (pg.scope = 'GLOBAL' OR (pg.scope = 'DEPARTMENT' AND pg.department_id = ?))`;
      goalsParams.push(filters.department_id);
    } else if (userRole === 'Manager') {
      goalsQuery += ` AND (pg.scope = 'GLOBAL' OR (pg.scope = 'DEPARTMENT' AND pg.department_id = (
        SELECT department_id FROM users WHERE id = ?
      )))`;
      goalsParams.push(user.user_id);
    }
    
    // Execute goals query
    const goalsRows = await prisma.$queryRawUnsafe<any[]>(goalsQuery, ...goalsParams);
    
    // Performance data
    const performanceData: PerformanceGoalData[] = [];
    
    // Process each goal
    for (const goal of goalsRows) {
      let actualValue = 0;
      
      if (goal.goal_type === 'QA_SCORE') {
        // Get average QA score
        let scoreQuery = `
          SELECT 
            AVG(s.total_score) AS avg_score
          FROM 
            submissions s
            JOIN calls c ON s.call_id = c.id
            JOIN users u ON c.csr_id = u.id
          WHERE 
            s.submitted_at BETWEEN ? AND ?
            AND s.status IN ('SUBMITTED', 'FINALIZED')
        `;
        
        const scoreParams: any[] = [filters.start_date, filters.end_date];
        
        if (goal.scope === 'DEPARTMENT' && goal.department_id) {
          scoreQuery += ` AND u.department_id = ?`;
          scoreParams.push(goal.department_id);
        } else if (userRole === 'Manager') {
          scoreQuery += ` AND u.department_id = (SELECT department_id FROM users WHERE id = ?)`;
          scoreParams.push(user.user_id);
        }
        
        // Add user filters if specified
        if (filters.csrIds && filters.csrIds.length > 0) {
          scoreQuery += ` AND c.csr_id IN (${filters.csrIds.map(() => '?').join(',')})`;
          scoreParams.push(...filters.csrIds);
        }
        
        const scoreRows = await prisma.$queryRawUnsafe<any[]>(scoreQuery, ...scoreParams);
        actualValue = scoreRows[0]?.avg_score || 0;
      } 
      else if (goal.goal_type === 'AUDIT_RATE') {
        // Calculate audit rate (audits per CSR per period)
        let auditQuery = `
          SELECT 
            COUNT(DISTINCT s.id) AS audit_count,
            COUNT(DISTINCT c.csr_id) AS csr_count
          FROM 
            submissions s
            JOIN calls c ON s.call_id = c.id
            JOIN users u ON c.csr_id = u.id
          WHERE 
            s.submitted_at BETWEEN ? AND ?
            AND s.status IN ('SUBMITTED', 'FINALIZED')
        `;
        
        const auditParams: any[] = [filters.start_date, filters.end_date];
        
        if (goal.scope === 'DEPARTMENT' && goal.department_id) {
          auditQuery += ` AND u.department_id = ?`;
          auditParams.push(goal.department_id);
        } else if (userRole === 'Manager') {
          auditQuery += ` AND u.department_id = (SELECT department_id FROM users WHERE id = ?)`;
          auditParams.push(user.user_id);
        }
        
        // Add user filters if specified
        if (filters.csrIds && filters.csrIds.length > 0) {
          auditQuery += ` AND c.csr_id IN (${filters.csrIds.map(() => '?').join(',')})`;
          auditParams.push(...filters.csrIds);
        }
        
        const auditRows = await prisma.$queryRawUnsafe<any[]>(auditQuery, ...auditParams);
        const auditCount = Number(auditRows[0]?.audit_count || 0);
        const csrCount = Number(auditRows[0]?.csr_count || 1); // Prevent division by zero
        
        // Calculate audits per CSR
        actualValue = auditCount / csrCount;
      }
      else if (goal.goal_type === 'DISPUTE_RATE') {
        // Calculate dispute rate (% of audits disputed)
        let disputeQuery = `
          SELECT 
            COUNT(DISTINCT s.id) AS audit_count,
            COUNT(DISTINCT d.id) AS dispute_count
          FROM 
            submissions s
            JOIN calls c ON s.call_id = c.id
            JOIN users u ON c.csr_id = u.id
            LEFT JOIN disputes d ON s.id = d.submission_id
          WHERE 
            s.submitted_at BETWEEN ? AND ?
            AND s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        `;
        
        const disputeParams: any[] = [filters.start_date, filters.end_date];
        
        if (goal.scope === 'DEPARTMENT' && goal.department_id) {
          disputeQuery += ` AND u.department_id = ?`;
          disputeParams.push(goal.department_id);
        } else if (userRole === 'Manager') {
          disputeQuery += ` AND u.department_id = (SELECT department_id FROM users WHERE id = ?)`;
          disputeParams.push(user.user_id);
        }
        
        // Add user filters if specified
        if (filters.csrIds && filters.csrIds.length > 0) {
          disputeQuery += ` AND c.csr_id IN (${filters.csrIds.map(() => '?').join(',')})`;
          disputeParams.push(...filters.csrIds);
        }
        
        const disputeRows = await prisma.$queryRawUnsafe<any[]>(disputeQuery, ...disputeParams);
        const auditCount = Number(disputeRows[0]?.audit_count || 0);
        const disputeCount = Number(disputeRows[0]?.dispute_count || 0);
        
        // Calculate dispute rate as percentage
        actualValue = auditCount > 0 ? (disputeCount / auditCount) * 100 : 0;
      }
      
      // Calculate percent complete
      const percentComplete = Math.min(100, Math.round((actualValue / goal.target_value) * 100));
      
      performanceData.push({
        goal_type: goal.goal_type,
        target_value: goal.target_value,
        actualValue,
        percentComplete
      });
    }
    
    res.status(200).json(performanceData);
  } catch (error) {
    console.error('Error fetching performance goals:', error);
    res.status(500).json({ message: 'Failed to fetch performance goals' });
  }
};

/**
 * Export QA score data
 * @route POST /api/analytics/export-qa-scores
 */
export const exportQAScores = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters: ReportFilters = req.body;
    const user = req.user as UserJwtPayload;
    
    // Get user role if not directly available
    let userRole: string | undefined = user.role;
    if (!userRole && user.role_id) {
      const roleRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT role_name FROM roles WHERE id = ${user.role_id}
      `);
      userRole = roleRows[0]?.role_name;
    } else if (!userRole) {
      const userRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user.user_id}
      `);
      userRole = userRows[0]?.role_name;
    }
    
    // Base query for all submissions
    let query = `
      SELECT 
        s.id AS submission_id,
        DATE(s.submitted_at) AS submission_date,
        s.total_score,
        s.status,
        f.id AS form_id,
        f.form_name,
        u.id AS csr_id,
        u.username AS csr_name,
        d.id AS department_id,
        d.department_name,
        qa.username AS qa_name
      FROM 
        submissions s
        JOIN calls c ON s.call_id = c.id
        JOIN users u ON c.csr_id = u.id
        JOIN forms f ON s.form_id = f.id
        JOIN users qa ON s.submitted_by = qa.id
        LEFT JOIN departments d ON u.department_id = d.id
      WHERE 
        s.submitted_at BETWEEN ? AND ?
        AND s.status IN ('SUBMITTED', 'FINALIZED')
    `;
    
    // Add time to end date to include the full day
    const endDateWithTime = `${filters.end_date} 23:59:59`;
    const queryParams: any[] = [filters.start_date, endDateWithTime];
    
    // Additional filters
    if (filters.department_id) {
      query += ` AND u.department_id = ?`;
      queryParams.push(filters.department_id);
    } else if (userRole === 'Manager') {
      query += ` AND u.department_id = (SELECT department_id FROM users WHERE id = ?)`;
      queryParams.push(user.user_id);
    }
    
    if (filters.csrIds && filters.csrIds.length > 0) {
      query += ` AND c.csr_id IN (${filters.csrIds.map(() => '?').join(',')})`;
      queryParams.push(...filters.csrIds);
    }
    
    if (filters.form_id) {
      query += ` AND s.form_id = ?`;
      queryParams.push(filters.form_id);
    }
    
    // Order by date
    query += ` ORDER BY s.submitted_at DESC`;
    
    // Execute query
    const rows = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams);
    
    // Format for CSV
    const csvData = rows.map(row => ({
      submission_id: row.submission_id,
      Date: new Date(row.submission_date).toISOString().split('T')[0],
      Score: row.total_score,
      Status: row.status,
      Form: row.form_name,
      CSR: row.csr_name,
      Department: row.department_name || 'N/A',
      QA: row.qa_name
    }));
    
    // Generate CSV content
    if (csvData.length === 0) {
      const headers = ['submission_id', 'Date', 'Score', 'Status', 'Form', 'CSR', 'Department', 'QA'];
      const csv = headers.join(',') + '\n';
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="qa_scores_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
      return;
    }
    
    const headers = Object.keys(csvData[0]);
    const csvRows = csvData.map(row => 
      headers.map(header => {
        const value = (row as any)[header] ?? '';
        const escapedValue = String(value).replace(/"/g, '""');
        return `"${escapedValue}"`;
      }).join(',')
    );
    
    const csv = [headers.join(','), ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="qa_scores_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting QA scores:', error);
    res.status(500).json({ message: 'Failed to export QA scores' });
  }
};
