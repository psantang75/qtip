# Performance Goals Enhancement Plan

## 📋 Overview

This document outlines the enhancement approach for the Performance Goals system in QTIP, expanding functionality to support individual CSR targeting, date ranges, and granular form/category/question-specific targeting.

## 🎯 Enhancement Goals

### Current Limitations
- Only supports GLOBAL and DEPARTMENT scope
- No individual CSR targeting
- No start/end date functionality
- No specific form/category/question targeting
- AUDIT_RATE and DISPUTE_RATE visible (need to hide for now)

### New Requirements
1. **Multi-Target Support**: Set goals for one or multiple CSRs, departments
2. **Date Range Support**: Start date, end date (null = infinite)  
3. **Granular Targeting**: All QA reviews, specific form, category within form, or question within form
4. **Hide Non-QA Goals**: Focus on QA_SCORE only, comment out AUDIT_RATE/DISPUTE_RATE for future
5. **Enhanced Reporting**: Track performance against enhanced goal criteria

## 🗄️ Database Schema Changes

### 1. Enhanced `performance_goals` Table
```sql
-- Modify existing performance_goals table
ALTER TABLE `performance_goals` 
ADD COLUMN `start_date` DATE NOT NULL DEFAULT (CURDATE()),
ADD COLUMN `end_date` DATE DEFAULT NULL,
ADD COLUMN `target_form_id` INT DEFAULT NULL,
ADD COLUMN `target_category_id` INT DEFAULT NULL, 
ADD COLUMN `target_question_id` INT DEFAULT NULL,
ADD COLUMN `target_scope` ENUM('ALL_QA', 'FORM', 'CATEGORY', 'QUESTION') NOT NULL DEFAULT 'ALL_QA',
ADD CONSTRAINT `fk_performance_goals_form` FOREIGN KEY (`target_form_id`) REFERENCES `forms` (`id`) ON DELETE SET NULL,
ADD CONSTRAINT `fk_performance_goals_category` FOREIGN KEY (`target_category_id`) REFERENCES `form_categories` (`id`) ON DELETE SET NULL,
ADD CONSTRAINT `fk_performance_goals_question` FOREIGN KEY (`target_question_id`) REFERENCES `form_questions` (`id`) ON DELETE SET NULL;

-- Update scope enum to include USER
ALTER TABLE `performance_goals` 
MODIFY COLUMN `scope` ENUM('GLOBAL','DEPARTMENT','USER','MULTI_USER','MULTI_DEPARTMENT') NOT NULL;

-- Add indexes for performance
CREATE INDEX `idx_performance_goals_dates` ON `performance_goals` (`start_date`, `end_date`);
CREATE INDEX `idx_performance_goals_target` ON `performance_goals` (`target_scope`, `target_form_id`, `target_category_id`, `target_question_id`);
```

### 2. New Junction Tables

#### Performance Goal Users (Many-to-Many)
```sql
CREATE TABLE `performance_goal_users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `goal_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `assigned_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `assigned_by` INT NOT NULL,
  `is_active` TINYINT(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_goal_user` (`goal_id`, `user_id`),
  KEY `idx_goal_id` (`goal_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_assigned_by` (`assigned_by`),
  CONSTRAINT `fk_goal_users_goal` FOREIGN KEY (`goal_id`) REFERENCES `performance_goals` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goal_users_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goal_users_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

#### Performance Goal Departments (Many-to-Many)  
```sql
CREATE TABLE `performance_goal_departments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `goal_id` INT NOT NULL,
  `department_id` INT NOT NULL,
  `assigned_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `assigned_by` INT NOT NULL,
  `is_active` TINYINT(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_goal_department` (`goal_id`, `department_id`),
  KEY `idx_goal_id` (`goal_id`),
  KEY `idx_department_id` (`department_id`), 
  KEY `idx_assigned_by` (`assigned_by`),
  CONSTRAINT `fk_goal_departments_goal` FOREIGN KEY (`goal_id`) REFERENCES `performance_goals` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goal_departments_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goal_departments_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

## 🏗️ Backend Architecture Changes

### 1. Updated Type Definitions

#### Enhanced Performance Goal Types
```typescript
// backend/src/types/performanceGoal.types.ts

export type GoalType = 'QA_SCORE'; // | 'AUDIT_RATE' | 'DISPUTE_RATE'; // Future enhancement

export type GoalScope = 'GLOBAL' | 'DEPARTMENT' | 'USER' | 'MULTI_USER' | 'MULTI_DEPARTMENT';

export type TargetScope = 'ALL_QA' | 'FORM' | 'CATEGORY' | 'QUESTION';

export interface PerformanceGoal extends RowDataPacket {
  id: number;
  goal_type: GoalType;
  target_value: number;
  scope: GoalScope;
  department_id: number | null; // Deprecated - use junction tables
  start_date: string;
  end_date: string | null;
  target_scope: TargetScope;
  target_form_id: number | null;
  target_category_id: number | null;
  target_question_id: number | null;
  description: string | null;
  created_at: string;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  updated_at: string | null;
}

export interface PerformanceGoalUser {
  id: number;
  goal_id: number;
  user_id: number;
  user_name?: string;
  user_email?: string;
  assigned_at: string;
  assigned_by: number;
  is_active: boolean;
}

export interface PerformanceGoalDepartment {
  id: number;
  goal_id: number;
  department_id: number;
  department_name?: string;
  assigned_at: string;
  assigned_by: number;
  is_active: boolean;
}

export interface EnhancedPerformanceGoal extends PerformanceGoal {
  assigned_users?: PerformanceGoalUser[];
  assigned_departments?: PerformanceGoalDepartment[];
  target_form_name?: string;
  target_category_name?: string;
  target_question_text?: string;
}

export interface CreatePerformanceGoalData {
  goal_type: GoalType;
  target_value: number;
  scope: GoalScope;
  start_date: string;
  end_date?: string | null;
  target_scope: TargetScope;
  target_form_id?: number | null;
  target_category_id?: number | null;
  target_question_id?: number | null;
  description?: string | null;
  user_ids?: number[]; // For USER/MULTI_USER scope
  department_ids?: number[]; // For DEPARTMENT/MULTI_DEPARTMENT scope
}

export interface PerformanceGoalFilters {
  goal_type?: GoalType;
  scope?: GoalScope;
  target_scope?: TargetScope;
  is_active?: boolean;
  start_date?: string;
  end_date?: string;
  user_id?: number;
  department_id?: number;
  form_id?: number;
}
```

### 2. Enhanced Repository Pattern

#### Updated MySQLPerformanceGoalRepository
```typescript
// backend/src/repositories/MySQLPerformanceGoalRepository.ts

export class MySQLPerformanceGoalRepository {
  
  /**
   * Create performance goal with enhanced targeting
   */
  async create(goalData: CreatePerformanceGoalData, createdBy: number): Promise<EnhancedPerformanceGoal> {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // 1. Create main performance goal
      const [result] = await connection.execute<ResultSetHeader>(`
        INSERT INTO performance_goals (
          goal_type, target_value, scope, start_date, end_date,
          target_scope, target_form_id, target_category_id, target_question_id,
          description, created_by, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        goalData.goal_type,
        goalData.target_value,
        goalData.scope,
        goalData.start_date,
        goalData.end_date,
        goalData.target_scope,
        goalData.target_form_id,
        goalData.target_category_id,
        goalData.target_question_id,
        goalData.description,
        createdBy
      ]);
      
      const goalId = result.insertId;
      
      // 2. Create user assignments if applicable
      if (goalData.user_ids && goalData.user_ids.length > 0) {
        const userValues = goalData.user_ids.map(userId => [goalId, userId, createdBy]);
        await connection.query(`
          INSERT INTO performance_goal_users (goal_id, user_id, assigned_by)
          VALUES ?
        `, [userValues]);
      }
      
      // 3. Create department assignments if applicable
      if (goalData.department_ids && goalData.department_ids.length > 0) {
        const deptValues = goalData.department_ids.map(deptId => [goalId, deptId, createdBy]);
        await connection.query(`
          INSERT INTO performance_goal_departments (goal_id, department_id, assigned_by)
          VALUES ?
        `, [deptValues]);
      }
      
      await connection.commit();
      
      // Return the created goal with full details
      return await this.findById(goalId);
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  
  /**
   * Find goal by ID with all related data
   */
  async findById(id: number): Promise<EnhancedPerformanceGoal | null> {
    const [goalRows] = await pool.execute<RowDataPacket[]>(`
      SELECT 
        pg.*,
        f.form_name as target_form_name,
        fc.category_name as target_category_name,
        fq.question_text as target_question_text
      FROM performance_goals pg
      LEFT JOIN forms f ON pg.target_form_id = f.id
      LEFT JOIN form_categories fc ON pg.target_category_id = fc.id
      LEFT JOIN form_questions fq ON pg.target_question_id = fq.id
      WHERE pg.id = ?
    `, [id]);
    
    if (goalRows.length === 0) return null;
    
    const goal = goalRows[0] as EnhancedPerformanceGoal;
    
    // Get assigned users
    const [userRows] = await pool.execute<RowDataPacket[]>(`
      SELECT pgu.*, u.username as user_name, u.email as user_email
      FROM performance_goal_users pgu
      JOIN users u ON pgu.user_id = u.id
      WHERE pgu.goal_id = ? AND pgu.is_active = 1
    `, [id]);
    goal.assigned_users = userRows as PerformanceGoalUser[];
    
    // Get assigned departments
    const [deptRows] = await pool.execute<RowDataPacket[]>(`
      SELECT pgd.*, d.department_name
      FROM performance_goal_departments pgd
      JOIN departments d ON pgd.department_id = d.id
      WHERE pgd.goal_id = ? AND pgd.is_active = 1
    `, [id]);
    goal.assigned_departments = deptRows as PerformanceGoalDepartment[];
    
    return goal;
  }
  
  /**
   * Find goals with enhanced filtering and pagination
   */
  async findAll(
    page: number = 1,
    pageSize: number = 10,
    filters?: PerformanceGoalFilters
  ): Promise<{ data: EnhancedPerformanceGoal[]; total: number; pages: number }> {
    
    // Build dynamic query with filters
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    
    if (filters?.goal_type) {
      whereClause += ' AND pg.goal_type = ?';
      params.push(filters.goal_type);
    }
    
    if (filters?.scope) {
      whereClause += ' AND pg.scope = ?';
      params.push(filters.scope);
    }
    
    if (filters?.target_scope) {
      whereClause += ' AND pg.target_scope = ?';
      params.push(filters.target_scope);
    }
    
    if (filters?.is_active !== undefined) {
      whereClause += ' AND pg.is_active = ?';
      params.push(filters.is_active ? 1 : 0);
    }
    
    // Date range filtering
    if (filters?.start_date) {
      whereClause += ' AND pg.start_date >= ?';
      params.push(filters.start_date);
    }
    
    if (filters?.end_date) {
      whereClause += ' AND (pg.end_date IS NULL OR pg.end_date <= ?)';
      params.push(filters.end_date);
    }
    
    // User/Department filtering
    if (filters?.user_id) {
      whereClause += ` AND (
        pg.scope IN ('GLOBAL') OR 
        EXISTS (SELECT 1 FROM performance_goal_users pgu WHERE pgu.goal_id = pg.id AND pgu.user_id = ? AND pgu.is_active = 1)
      )`;
      params.push(filters.user_id);
    }
    
    if (filters?.department_id) {
      whereClause += ` AND (
        pg.scope IN ('GLOBAL') OR 
        EXISTS (SELECT 1 FROM performance_goal_departments pgd WHERE pgd.goal_id = pg.id AND pgd.department_id = ? AND pgd.is_active = 1)
      )`;
      params.push(filters.department_id);
    }
    
    // Get total count
    const [countRows] = await pool.execute<RowDataPacket[]>(`
      SELECT COUNT(DISTINCT pg.id) as total
      FROM performance_goals pg
      LEFT JOIN performance_goal_users pgu ON pg.id = pgu.goal_id AND pgu.is_active = 1
      LEFT JOIN performance_goal_departments pgd ON pg.id = pgd.goal_id AND pgd.is_active = 1
      ${whereClause}
    `, params);
    
    const total = countRows[0].total;
    const pages = Math.ceil(total / pageSize);
    
    // Get paginated results
    const offset = (page - 1) * pageSize;
    const [goalRows] = await pool.execute<RowDataPacket[]>(`
      SELECT DISTINCT
        pg.*,
        f.form_name as target_form_name,
        fc.category_name as target_category_name,
        fq.question_text as target_question_text
      FROM performance_goals pg
      LEFT JOIN forms f ON pg.target_form_id = f.id
      LEFT JOIN form_categories fc ON pg.target_category_id = fc.id
      LEFT JOIN form_questions fq ON pg.target_question_id = fq.id
      LEFT JOIN performance_goal_users pgu ON pg.id = pgu.goal_id AND pgu.is_active = 1
      LEFT JOIN performance_goal_departments pgd ON pg.id = pgd.goal_id AND pgd.is_active = 1
      ${whereClause}
      ORDER BY pg.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);
    
    // Enhance each goal with assignments
    const enhancedGoals: EnhancedPerformanceGoal[] = [];
    for (const goalRow of goalRows) {
      const enhancedGoal = await this.findById(goalRow.id);
      if (enhancedGoal) enhancedGoals.push(enhancedGoal);
    }
    
    return { data: enhancedGoals, total, pages };
  }
  
  /**
   * Calculate performance for enhanced goals
   */
  async calculatePerformance(
    goal: EnhancedPerformanceGoal,
    dateRange: { start: string; end: string }
  ): Promise<number> {
    
    // Build query based on target scope
    let query = '';
    const params: any[] = [];
    
    switch (goal.target_scope) {
      case 'ALL_QA':
        query = `
          SELECT AVG(s.total_score) as avg_score
          FROM submissions s
          WHERE s.status = 'SUBMITTED' 
            AND s.total_score IS NOT NULL
            AND DATE(s.submitted_at) BETWEEN ? AND ?
        `;
        params.push(dateRange.start, dateRange.end);
        break;
        
      case 'FORM':
        query = `
          SELECT AVG(s.total_score) as avg_score
          FROM submissions s
          WHERE s.form_id = ?
            AND s.status = 'SUBMITTED'
            AND s.total_score IS NOT NULL
            AND DATE(s.submitted_at) BETWEEN ? AND ?
        `;
        params.push(goal.target_form_id, dateRange.start, dateRange.end);
        break;
        
      case 'CATEGORY':
        query = `
          SELECT AVG(
            (sa.answer_score / fq.weight) * fc.weight * 100
          ) as avg_score
          FROM submission_answers sa
          JOIN form_questions fq ON sa.question_id = fq.id
          JOIN form_categories fc ON fq.category_id = fc.id
          JOIN submissions s ON sa.submission_id = s.id
          WHERE fc.id = ?
            AND s.status = 'SUBMITTED'
            AND DATE(s.submitted_at) BETWEEN ? AND ?
        `;
        params.push(goal.target_category_id, dateRange.start, dateRange.end);
        break;
        
      case 'QUESTION':
        query = `
          SELECT AVG(
            CASE 
              WHEN sa.answer = 'yes' THEN fq.yes_value
              WHEN sa.answer = 'no' THEN fq.no_value
              WHEN sa.answer = 'n/a' THEN fq.na_value
              ELSE 0
            END
          ) as avg_score
          FROM submission_answers sa
          JOIN form_questions fq ON sa.question_id = fq.id
          JOIN submissions s ON sa.submission_id = s.id
          WHERE fq.id = ?
            AND s.status = 'SUBMITTED'
            AND DATE(s.submitted_at) BETWEEN ? AND ?
        `;
        params.push(goal.target_question_id, dateRange.start, dateRange.end);
        break;
        
      default:
        return 0;
    }
    
    // Add user/department filtering
    if (goal.scope !== 'GLOBAL') {
      // Add additional WHERE clauses for assigned users/departments
      // Implementation depends on how submissions are linked to users
    }
    
    const [rows] = await pool.execute<RowDataPacket[]>(query, params);
    return rows[0]?.avg_score || 0;
  }
}
```

### 3. Enhanced Service Layer

#### Updated PerformanceGoalService
```typescript
// backend/src/services/PerformanceGoalService.ts

export class PerformanceGoalService {
  
  /**
   * Create performance goal with enhanced validation
   */
  async createPerformanceGoal(
    goalData: CreatePerformanceGoalData,
    createdBy: number
  ): Promise<EnhancedPerformanceGoal> {
    
    // Validation
    this.validateGoalData(goalData);
    await this.validateTargetReferences(goalData);
    
    // Business logic validation
    if (goalData.scope.includes('USER') && (!goalData.user_ids || goalData.user_ids.length === 0)) {
      throw new PerformanceGoalServiceError('User IDs required for user-scoped goals', 'MISSING_USERS', 400);
    }
    
    if (goalData.scope.includes('DEPARTMENT') && (!goalData.department_ids || goalData.department_ids.length === 0)) {
      throw new PerformanceGoalServiceError('Department IDs required for department-scoped goals', 'MISSING_DEPARTMENTS', 400);
    }
    
    // Create goal
    const createdGoal = await this.repository.create(goalData, createdBy);
    
    // Log audit event
    await this.auditLogger.log({
      userId: createdBy,
      action: 'CREATE_ENHANCED_PERFORMANCE_GOAL',
      targetId: createdGoal.id,
      targetType: 'PERFORMANCE_GOAL',
      details: {
        goal_type: goalData.goal_type,
        scope: goalData.scope,
        target_scope: goalData.target_scope,
        user_count: goalData.user_ids?.length || 0,
        department_count: goalData.department_ids?.length || 0
      }
    });
    
    return createdGoal;
  }
  
  /**
   * Get active goals for user with date filtering
   */
  async getActiveGoalsForUser(
    userId: number,
    asOfDate: string = new Date().toISOString().split('T')[0]
  ): Promise<EnhancedPerformanceGoal[]> {
    
    const filters: PerformanceGoalFilters = {
      is_active: true,
      user_id: userId,
      start_date: asOfDate,
      end_date: asOfDate
    };
    
    const result = await this.repository.findAll(1, 1000, filters);
    return result.data;
  }
  
  /**
   * Calculate performance against enhanced goals
   */
  async calculatePerformanceReport(
    filters: {
      user_id?: number;
      department_id?: number;
      start_date: string;
      end_date: string;
    }
  ): Promise<PerformanceGoalReport[]> {
    
    // Get applicable goals
    const goalFilters: PerformanceGoalFilters = {
      is_active: true,
      start_date: filters.start_date,
      end_date: filters.end_date
    };
    
    if (filters.user_id) goalFilters.user_id = filters.user_id;
    if (filters.department_id) goalFilters.department_id = filters.department_id;
    
    const goalsResult = await this.repository.findAll(1, 1000, goalFilters);
    const goals = goalsResult.data;
    
    const reports: PerformanceGoalReport[] = [];
    
    for (const goal of goals) {
      const actualValue = await this.repository.calculatePerformance(goal, {
        start: filters.start_date,
        end: filters.end_date
      });
      
      const percentComplete = (actualValue / goal.target_value) * 100;
      
      reports.push({
        goal,
        actualValue,
        targetValue: goal.target_value,
        percentComplete,
        isOnTrack: actualValue >= goal.target_value,
        dateRange: {
          start: filters.start_date,
          end: filters.end_date
        }
      });
    }
    
    return reports;
  }
  
  private validateGoalData(goalData: CreatePerformanceGoalData): void {
    // Date validation
    if (goalData.end_date && goalData.start_date >= goalData.end_date) {
      throw new PerformanceGoalServiceError('End date must be after start date', 'INVALID_DATE_RANGE', 400);
    }
    
    // Target scope validation
    if (goalData.target_scope !== 'ALL_QA') {
      if (goalData.target_scope === 'FORM' && !goalData.target_form_id) {
        throw new PerformanceGoalServiceError('Form ID required for FORM target scope', 'MISSING_FORM_ID', 400);
      }
      if (goalData.target_scope === 'CATEGORY' && !goalData.target_category_id) {
        throw new PerformanceGoalServiceError('Category ID required for CATEGORY target scope', 'MISSING_CATEGORY_ID', 400);
      }
      if (goalData.target_scope === 'QUESTION' && !goalData.target_question_id) {
        throw new PerformanceGoalServiceError('Question ID required for QUESTION target scope', 'MISSING_QUESTION_ID', 400);
      }
    }
  }
  
  private async validateTargetReferences(goalData: CreatePerformanceGoalData): Promise<void> {
    // Validate form exists
    if (goalData.target_form_id) {
      const formExists = await this.validateFormExists(goalData.target_form_id);
      if (!formExists) {
        throw new PerformanceGoalServiceError('Invalid form ID', 'INVALID_FORM_ID', 400);
      }
    }
    
    // Validate category exists and belongs to form
    if (goalData.target_category_id) {
      const categoryValid = await this.validateCategoryExists(goalData.target_category_id, goalData.target_form_id);
      if (!categoryValid) {
        throw new PerformanceGoalServiceError('Invalid category ID or category does not belong to specified form', 'INVALID_CATEGORY_ID', 400);
      }
    }
    
    // Validate question exists and belongs to category
    if (goalData.target_question_id) {
      const questionValid = await this.validateQuestionExists(goalData.target_question_id, goalData.target_category_id);
      if (!questionValid) {
        throw new PerformanceGoalServiceError('Invalid question ID or question does not belong to specified category', 'INVALID_QUESTION_ID', 400);
      }
    }
  }
}
```

## 🎨 Frontend Architecture Changes

### 1. Enhanced Type Definitions

#### Updated Frontend Types
```typescript
// frontend/src/types/performance.types.ts

export type GoalType = 'QA_SCORE'; // | 'AUDIT_RATE' | 'DISPUTE_RATE'; // Future enhancement

export type GoalScope = 'GLOBAL' | 'DEPARTMENT' | 'USER' | 'MULTI_USER' | 'MULTI_DEPARTMENT';

export type TargetScope = 'ALL_QA' | 'FORM' | 'CATEGORY' | 'QUESTION';

export interface PerformanceGoal {
  id?: number;
  goal_type: GoalType;
  target_value: number;
  scope: GoalScope;
  start_date: string;
  end_date?: string | null;
  target_scope: TargetScope;
  target_form_id?: number | null;
  target_category_id?: number | null;
  target_question_id?: number | null;
  description?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EnhancedPerformanceGoal extends PerformanceGoal {
  assigned_users?: PerformanceGoalUser[];
  assigned_departments?: PerformanceGoalDepartment[];
  target_form_name?: string;
  target_category_name?: string;
  target_question_text?: string;
}

export interface PerformanceGoalUser {
  id: number;
  goal_id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  assigned_at: string;
  is_active: boolean;
}

export interface PerformanceGoalDepartment {
  id: number;
  goal_id: number;
  department_id: number;
  department_name: string;
  assigned_at: string;
  is_active: boolean;
}

export interface PerformanceGoalFormData {
  goal_type: GoalType;
  target_value: number;
  scope: GoalScope;
  start_date: string;
  end_date?: string | null;
  target_scope: TargetScope;
  target_form_id?: number | null;
  target_category_id?: number | null;
  target_question_id?: number | null;
  description?: string | null;
  user_ids?: number[];
  department_ids?: number[];
}

export interface FormOption {
  id: number;
  form_name: string;
  categories?: CategoryOption[];
}

export interface CategoryOption {
  id: number;
  category_name: string;
  questions?: QuestionOption[];
}

export interface QuestionOption {
  id: number;
  question_text: string;
}
```

### 2. Enhanced Form Component

#### Updated PerformanceGoals Component Architecture
```typescript
// frontend/src/components/PerformanceGoals/PerformanceGoals.tsx

const PerformanceGoals: React.FC = () => {
  // ... existing state ...
  
  // New state for enhanced features
  const [formOptions, setFormOptions] = useState<FormOption[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<Department[]>([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  
  // Enhanced form data
  const [formData, setFormData] = useState<PerformanceGoalFormData>({
    goal_type: 'QA_SCORE',
    target_value: 0,
    scope: 'GLOBAL',
    start_date: new Date().toISOString().split('T')[0],
    end_date: null,
    target_scope: 'ALL_QA',
    target_form_id: null,
    target_category_id: null,
    target_question_id: null,
    description: '',
    user_ids: [],
    department_ids: []
  });
  
  // Component structure:
  // 1. Enhanced Filters Section
  // 2. Goals Table with new columns
  // 3. Enhanced Add/Edit Modal
  // 4. User/Department Selection Components
  // 5. Form/Category/Question Cascade Selectors
  
  return (
    <div className="container p-6 mx-auto">
      <h1 className="mb-8 text-2xl font-bold">Performance Goals</h1>
      
      {/* Enhanced Filters */}
      <EnhancedFilters />
      
      {/* Goals Table */}
      <EnhancedGoalsTable />
      
      {/* Enhanced Modal */}
      {showModal && <EnhancedGoalModal />}
    </div>
  );
};
```

#### Enhanced Goal Modal Component
```typescript
// frontend/src/components/PerformanceGoals/EnhancedGoalModal.tsx

const EnhancedGoalModal: React.FC<Props> = ({ /* props */ }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-semibold mb-6">
            {currentGoal ? 'Edit Performance Goal' : 'Create Performance Goal'}
          </h2>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Information Section */}
            <BasicInformationSection />
            
            {/* Date Range Section */}
            <DateRangeSection />
            
            {/* Scope Selection Section */}
            <ScopeSelectionSection />
            
            {/* Target Scope Section */}
            <TargetScopeSection />
            
            {/* Assignment Section */}
            <AssignmentSection />
            
            {/* Action Buttons */}
            <ActionButtons />
          </form>
        </div>
      </div>
    </div>
  );
};
```

## 📊 Migration Strategy

### 1. Database Migration Script
```sql
-- Migration: Enhanced Performance Goals
-- Version: 2.0.0
-- Date: 2025-01-15

-- Step 1: Add new columns to performance_goals table
ALTER TABLE `performance_goals` 
ADD COLUMN `start_date` DATE NOT NULL DEFAULT (CURDATE()),
ADD COLUMN `end_date` DATE DEFAULT NULL,
ADD COLUMN `target_form_id` INT DEFAULT NULL,
ADD COLUMN `target_category_id` INT DEFAULT NULL,
ADD COLUMN `target_question_id` INT DEFAULT NULL,
ADD COLUMN `target_scope` ENUM('ALL_QA', 'FORM', 'CATEGORY', 'QUESTION') NOT NULL DEFAULT 'ALL_QA';

-- Step 2: Update scope enum
ALTER TABLE `performance_goals` 
MODIFY COLUMN `scope` ENUM('GLOBAL','DEPARTMENT','USER','MULTI_USER','MULTI_DEPARTMENT') NOT NULL;

-- Step 3: Add foreign key constraints
ALTER TABLE `performance_goals`
ADD CONSTRAINT `fk_performance_goals_form` FOREIGN KEY (`target_form_id`) REFERENCES `forms` (`id`) ON DELETE SET NULL,
ADD CONSTRAINT `fk_performance_goals_category` FOREIGN KEY (`target_category_id`) REFERENCES `form_categories` (`id`) ON DELETE SET NULL,
ADD CONSTRAINT `fk_performance_goals_question` FOREIGN KEY (`target_question_id`) REFERENCES `form_questions` (`id`) ON DELETE SET NULL;

-- Step 4: Create junction tables
CREATE TABLE `performance_goal_users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `goal_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `assigned_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `assigned_by` INT NOT NULL,
  `is_active` TINYINT(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_goal_user` (`goal_id`, `user_id`),
  CONSTRAINT `fk_goal_users_goal` FOREIGN KEY (`goal_id`) REFERENCES `performance_goals` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goal_users_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goal_users_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `performance_goal_departments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `goal_id` INT NOT NULL,
  `department_id` INT NOT NULL,
  `assigned_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `assigned_by` INT NOT NULL,
  `is_active` TINYINT(1) DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_goal_department` (`goal_id`, `department_id`),
  CONSTRAINT `fk_goal_departments_goal` FOREIGN KEY (`goal_id`) REFERENCES `performance_goals` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goal_departments_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_goal_departments_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- Step 5: Add indexes for performance
CREATE INDEX `idx_performance_goals_dates` ON `performance_goals` (`start_date`, `end_date`);
CREATE INDEX `idx_performance_goals_target` ON `performance_goals` (`target_scope`, `target_form_id`, `target_category_id`, `target_question_id`);

-- Step 6: Migrate existing data
-- Convert existing department-scoped goals to new structure
INSERT INTO performance_goal_departments (goal_id, department_id, assigned_by, assigned_at)
SELECT id, department_id, created_by, created_at
FROM performance_goals 
WHERE scope = 'DEPARTMENT' AND department_id IS NOT NULL;

-- Update existing goals to new scope values
UPDATE performance_goals SET scope = 'MULTI_DEPARTMENT' WHERE scope = 'DEPARTMENT' AND department_id IS NOT NULL;

-- Step 7: Create view for backward compatibility
CREATE VIEW performance_goals_legacy AS
SELECT 
  pg.*,
  CASE 
    WHEN pg.scope IN ('DEPARTMENT', 'MULTI_DEPARTMENT') THEN 
      (SELECT pgd.department_id FROM performance_goal_departments pgd WHERE pgd.goal_id = pg.id LIMIT 1)
    ELSE NULL 
  END as department_id
FROM performance_goals pg;
```

### 2. Data Migration Approach

#### Phase 1: Database Schema (Week 1)
1. **Backup existing database**
2. **Add new columns with default values**
3. **Create junction tables**
4. **Migrate existing department goals to junction table**
5. **Test data integrity**

#### Phase 2: Backend Implementation (Week 2-3)
1. **Update type definitions**
2. **Enhance repository layer**
3. **Update service layer with new logic**
4. **Add new API endpoints**
5. **Maintain backward compatibility**

#### Phase 3: Frontend Implementation (Week 4-5)  
1. **Update React components**
2. **Enhance forms with new fields**
3. **Add cascading selectors**
4. **Update services and API calls**
5. **Add enhanced filtering**

#### Phase 4: Testing & Deployment (Week 6)
1. **Unit and integration testing**
2. **End-to-end testing**
3. **Performance testing**
4. **User acceptance testing**
5. **Production deployment**

## 🚀 Implementation Phases

### Phase 1: Foundation (Immediate)
- [ ] Database schema changes
- [ ] Basic type definitions
- [ ] Updated repository methods
- [ ] Migration scripts

### Phase 2: Core Functionality (Week 1-2)
- [ ] Enhanced service layer
- [ ] New API endpoints
- [ ] Basic frontend forms
- [ ] User/Department selection

### Phase 3: Advanced Features (Week 3-4)
- [ ] Form/Category/Question targeting
- [ ] Cascading selectors  
- [ ] Enhanced filtering
- [ ] Performance calculations

### Phase 4: Polish & Optimization (Week 5-6)
- [ ] UI/UX improvements
- [ ] Performance optimization
- [ ] Comprehensive testing
- [ ] Documentation updates

## 🎯 Success Criteria

### Functional Requirements
✅ **Individual CSR targeting**: Ability to assign goals to specific CSRs  
✅ **Multi-target support**: Assign goals to multiple users/departments  
✅ **Date range support**: Start/end dates with infinite option  
✅ **Granular targeting**: Form/category/question-specific goals  
✅ **Enhanced reporting**: Performance tracking against detailed criteria  

### Technical Requirements
✅ **Performance**: Sub-200ms response times for goal queries  
✅ **Scalability**: Support 1000+ concurrent goals  
✅ **Data integrity**: Referential integrity maintained  
✅ **Backward compatibility**: Existing functionality preserved  

### User Experience Requirements
✅ **Intuitive forms**: Easy goal creation and management  
✅ **Clear visualization**: Goal status and progress display  
✅ **Responsive design**: Works on all device sizes  
✅ **Accessibility**: WCAG 2.1 AA compliance  

## 📋 Notes & Considerations

### Future Enhancements (Commented Out)
- **AUDIT_RATE goals**: Frequency-based performance targets
- **DISPUTE_RATE goals**: Quality dispute tracking  
- **Weighted goals**: Multiple goals with different priorities
- **Goal templates**: Pre-defined goal configurations
- **Goal hierarchies**: Parent-child goal relationships

### Performance Considerations
- **Indexing strategy**: Optimized for date range and user queries
- **Caching layer**: Redis caching for frequently accessed goals
- **Query optimization**: Efficient joins for goal assignments
- **Background processing**: Async performance calculations

### Security Considerations
- **Role-based access**: Admins can manage all goals, Managers can view department goals
- **Data validation**: Comprehensive input validation and sanitization  
- **Audit logging**: All goal changes tracked in audit_logs
- **Authorization**: User can only view assigned goals

---

**Next Steps**: Review and approve this enhancement plan, then proceed with Phase 1 implementation starting with database schema changes. 