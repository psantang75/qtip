import axios from 'axios';

const API_BASE_URL = '/api/enhanced-performance-goals';

// Create API instance with authentication
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Add authorization header to requests if token exists
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Handle token expiration
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export interface EnhancedPerformanceGoal {
  id: number;
  goal_type: 'QA_SCORE';
  target_value: number;
  scope: 'GLOBAL' | 'DEPARTMENT' | 'USER' | 'MULTI_USER' | 'MULTI_DEPARTMENT';
  start_date: string;
  end_date: string | null;
  target_scope: 'ALL_QA' | 'FORM' | 'CATEGORY' | 'QUESTION';
  target_form_id: number | null;
  target_category_id: number | null;
  target_question_id: number | null;
  target_form_name?: string;
  target_category_name?: string;
  target_question_text?: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  assigned_users?: Array<{
    id: number;
    user_id: number;
    user_name: string;
    user_email: string;
  }>;
  assigned_departments?: Array<{
    id: number;
    department_id: number;
    department_name: string;
  }>;
}

export interface CreatePerformanceGoalData {
  goal_type: 'QA_SCORE';
  target_value: number;
  scope: 'GLOBAL' | 'DEPARTMENT' | 'USER' | 'MULTI_USER' | 'MULTI_DEPARTMENT';
  start_date: string;
  end_date?: string | null;
  target_scope: 'ALL_QA' | 'FORM' | 'CATEGORY' | 'QUESTION';
  target_form_id?: number | null;
  target_category_id?: number | null;
  target_question_id?: number | null;
  description?: string | null;
  user_ids?: number[];
  department_ids?: number[];
  is_active?: boolean;
}

export interface UpdatePerformanceGoalData extends Partial<CreatePerformanceGoalData> {}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  pages: number;
  currentPage: number;
  pageSize: number;
}

export interface FormOption {
  id: number;
  form_name: string;
  categories?: CategoryOption[];
}

export interface CategoryOption {
  id: number;
  category_name: string;
  form_id: number;
  questions?: QuestionOption[];
}

export interface QuestionOption {
  id: number;
  question_text: string;
  category_id: number;
}

export interface User {
  id: number;
  username: string;
  email: string;
  department_name?: string;
}

export interface Department {
  id: number;
  department_name: string;
}

export interface PerformanceReport {
  goal: EnhancedPerformanceGoal;
  actualValue: number;
  targetValue: number;
  percentComplete: number;
  isOnTrack: boolean;
  dateRange: {
    start: string;
    end: string;
  };
}

/**
 * Enhanced Performance Goal API Service
 * Handles all API calls for enhanced performance goals
 */
export const enhancedPerformanceGoalAPI = {
  
  /**
   * Get all performance goals with pagination and filtering
   */
  async getAll(queryParams?: string): Promise<PaginatedResponse<EnhancedPerformanceGoal>> {
    const url = queryParams ? `enhanced-performance-goals?${queryParams}` : 'enhanced-performance-goals';
    const response = await api.get(url);
    return response.data;
  },

  /**
   * Get performance goal by ID
   */
  async getById(id: number): Promise<EnhancedPerformanceGoal> {
    const response = await api.get(`enhanced-performance-goals/${id}`);
    return response.data;
  },

  /**
   * Create new performance goal
   */
  async create(data: CreatePerformanceGoalData): Promise<EnhancedPerformanceGoal> {
    const response = await api.post('enhanced-performance-goals', data);
    return response.data;
  },

  /**
   * Update performance goal
   */
  async update(id: number, data: UpdatePerformanceGoalData): Promise<EnhancedPerformanceGoal> {
    const response = await api.put(`enhanced-performance-goals/${id}`, data);
    return response.data;
  },

  /**
   * Delete (deactivate) performance goal
   */
  async delete(id: number): Promise<void> {
    await api.delete(`enhanced-performance-goals/${id}`);
  },

  /**
   * Activate performance goal
   */
  async activate(id: number): Promise<void> {
    await api.post(`enhanced-performance-goals/${id}/activate`);
  },

  /**
   * Get active goals for a specific user
   */
  async getActiveGoalsForUser(userId: number, asOfDate?: string): Promise<EnhancedPerformanceGoal[]> {
    const params = asOfDate ? `?asOfDate=${asOfDate}` : '';
    const response = await api.get(`enhanced-performance-goals/user/${userId}/active${params}`);
    return response.data;
  },

  /**
   * Get form options for targeting
   */
  async getFormOptions(): Promise<FormOption[]> {
    const response = await api.get('enhanced-performance-goals/options/forms');
    return response.data;
  },

  /**
   * Get users for assignment
   */
  async getUserOptions(departmentId?: number): Promise<User[]> {
    const params = departmentId ? `?departmentId=${departmentId}` : '';
    const response = await api.get(`enhanced-performance-goals/options/users${params}`);
    return response.data;
  },

  /**
   * Get departments for assignment
   */
  async getDepartmentOptions(): Promise<Department[]> {
    const response = await api.get('enhanced-performance-goals/options/departments');
    return response.data;
  },

  /**
   * Calculate performance report
   */
  async calculatePerformanceReport(filters: {
    user_id?: number;
    department_id?: number;
    start_date: string;
    end_date: string;
  }): Promise<PerformanceReport[]> {
    const response = await api.post('enhanced-performance-goals/reports/performance', filters);
    return response.data;
  },

  /**
   * Validate goal data before submission
   */
  validateGoalData(data: CreatePerformanceGoalData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate target value
    if (data.target_value < 0 || data.target_value > 100) {
      errors.push('Target value must be between 0 and 100');
    }

    // Validate scope requirements
    if (data.scope.includes('USER') && (!data.user_ids || data.user_ids.length === 0)) {
      errors.push('User IDs required for user-scoped goals');
    }

    if (data.scope.includes('DEPARTMENT') && (!data.department_ids || data.department_ids.length === 0)) {
      errors.push('Department IDs required for department-scoped goals');
    }

    // Validate target scope requirements
    if (data.target_scope !== 'ALL_QA') {
      if (data.target_scope === 'FORM' && !data.target_form_id) {
        errors.push('Form ID required for FORM target scope');
      }
      if (data.target_scope === 'CATEGORY' && !data.target_category_id) {
        errors.push('Category ID required for CATEGORY target scope');
      }
      if (data.target_scope === 'QUESTION' && !data.target_question_id) {
        errors.push('Question ID required for QUESTION target scope');
      }
    }

    // Validate date range
    if (data.end_date && data.start_date >= data.end_date) {
      errors.push('End date must be after start date');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  },

  /**
   * Format goal for display
   */
  formatGoalForDisplay(goal: EnhancedPerformanceGoal): {
    scopeLabel: string;
    targetLabel: string;
    assignmentSummary: string;
    dateRange: string;
  } {
    // Format scope
    let scopeLabel = goal.scope;
    if (goal.assigned_users && goal.assigned_users.length > 0) {
      scopeLabel += ` (${goal.assigned_users.length} user${goal.assigned_users.length > 1 ? 's' : ''})`;
    }
    if (goal.assigned_departments && goal.assigned_departments.length > 0) {
      scopeLabel += ` (${goal.assigned_departments.length} dept${goal.assigned_departments.length > 1 ? 's' : ''})`;
    }

    // Format target
    let targetLabel: string;
    switch (goal.target_scope) {
      case 'FORM':
        targetLabel = `Form: ${goal.target_form_name || 'Unknown'}`;
        break;
      case 'CATEGORY':
        targetLabel = `Category: ${goal.target_category_name || 'Unknown'}`;
        break;
      case 'QUESTION':
        targetLabel = `Question: ${goal.target_question_text || 'Unknown'}`;
        break;
      default:
        targetLabel = 'All QA Reviews';
    }

    // Format assignments
    const assignments: string[] = [];
    if (goal.assigned_users && goal.assigned_users.length > 0) {
      assignments.push(`${goal.assigned_users.length} user(s)`);
    }
    if (goal.assigned_departments && goal.assigned_departments.length > 0) {
      assignments.push(`${goal.assigned_departments.length} department(s)`);
    }
    const assignmentSummary = assignments.length > 0 ? assignments.join(', ') : 'Global';

    // Format date range
    const startDate = new Date(goal.start_date).toLocaleDateString();
    const endDate = goal.end_date ? new Date(goal.end_date).toLocaleDateString() : 'No end date';
    const dateRange = `${startDate} - ${endDate}`;

    return {
      scopeLabel,
      targetLabel,
      assignmentSummary,
      dateRange
    };
  },

  /**
   * Check if goal is currently active based on date range
   */
  isGoalActive(goal: EnhancedPerformanceGoal, asOfDate: Date = new Date()): boolean {
    if (!goal.is_active) return false;

    const startDate = new Date(goal.start_date);
    const endDate = goal.end_date ? new Date(goal.end_date) : null;

    const isAfterStart = asOfDate >= startDate;
    const isBeforeEnd = !endDate || asOfDate <= endDate;

    return isAfterStart && isBeforeEnd;
  },

  /**
   * Get applicable goals for a user
   */
  async getApplicableGoalsForUser(userId: number, asOfDate?: string): Promise<EnhancedPerformanceGoal[]> {
    const allGoals = await this.getActiveGoalsForUser(userId, asOfDate);
    const currentDate = asOfDate ? new Date(asOfDate) : new Date();
    
    return allGoals.filter(goal => this.isGoalActive(goal, currentDate));
  },

  /**
   * Export goals to CSV format
   */
  exportToCSV(goals: EnhancedPerformanceGoal[]): string {
    const headers = [
      'ID',
      'Goal Type',
      'Target Value',
      'Scope',
      'Target Scope',
      'Start Date',
      'End Date',
      'Description',
      'Active',
      'Assignments'
    ];

    const rows = goals.map(goal => {
      const formatted = this.formatGoalForDisplay(goal);
      return [
        goal.id,
        goal.goal_type,
        goal.target_value,
        formatted.scopeLabel,
        formatted.targetLabel,
        goal.start_date,
        goal.end_date || 'No end date',
        goal.description || '',
        goal.is_active ? 'Yes' : 'No',
        formatted.assignmentSummary
      ];
    });

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    return csvContent;
  },

  /**
   * Download goals as CSV file
   */
  downloadCSV(goals: EnhancedPerformanceGoal[], filename: string = 'performance_goals.csv'): void {
    const csvContent = this.exportToCSV(goals);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
}; 