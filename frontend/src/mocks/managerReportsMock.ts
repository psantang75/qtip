import type { 
  ManagerReportData, 
  FilterOptions 
} from '../types/performance.types';

export const mockFilterOptions: FilterOptions = {
  departments: [
    { id: 1, name: 'Customer Service' },
    { id: 2, name: 'Technical Support' },
    { id: 3, name: 'Sales' },
    { id: 4, name: 'Billing' },
    { id: 5, name: 'Retention' }
  ],
  managers: [
    { id: 1, name: 'John Smith', department: 'Customer Service' },
    { id: 2, name: 'Sarah Johnson', department: 'Technical Support' },
    { id: 3, name: 'Mike Davis', department: 'Sales' },
    { id: 4, name: 'Lisa Wilson', department: 'Billing' },
    { id: 5, name: 'Tom Brown', department: 'Retention' },
    { id: 6, name: 'Emily Rodriguez', department: 'Customer Service' },
    { id: 7, name: 'David Chen', department: 'Technical Support' }
  ]
};

export const mockReportData: ManagerReportData = {
  qaScores: [
    { id: 1, name: 'Customer Service', averageScore: 87.5, totalSubmissions: 245, type: 'department' },
    { id: 2, name: 'Technical Support', averageScore: 91.2, totalSubmissions: 189, type: 'department' },
    { id: 3, name: 'Sales', averageScore: 82.8, totalSubmissions: 156, type: 'department' },
    { id: 4, name: 'Billing', averageScore: 89.1, totalSubmissions: 134, type: 'department' },
    { id: 5, name: 'Retention', averageScore: 85.3, totalSubmissions: 98, type: 'department' },
    { id: 1, name: 'John Smith', averageScore: 88.7, totalSubmissions: 67, type: 'manager' },
    { id: 2, name: 'Sarah Johnson', averageScore: 92.1, totalSubmissions: 58, type: 'manager' },
    { id: 3, name: 'Mike Davis', averageScore: 81.5, totalSubmissions: 49, type: 'manager' }
  ],
  trainingCompletion: [
    { id: 1, name: 'Customer Service', completionRate: 92.5, completedCourses: 185, totalCourses: 200, type: 'department' },
    { id: 2, name: 'Technical Support', completionRate: 88.7, totalCourses: 150, completedCourses: 133, type: 'department' },
    { id: 3, name: 'Sales', completionRate: 95.2, completedCourses: 119, totalCourses: 125, type: 'department' },
    { id: 4, name: 'Billing', completionRate: 85.4, completedCourses: 94, totalCourses: 110, type: 'department' },
    { id: 5, name: 'Retention', completionRate: 91.8, completedCourses: 78, totalCourses: 85, type: 'department' },
    { id: 1, name: 'John Smith', completionRate: 94.1, completedCourses: 48, totalCourses: 51, type: 'manager' },
    { id: 2, name: 'Sarah Johnson', completionRate: 87.3, completedCourses: 41, totalCourses: 47, type: 'manager' },
    { id: 3, name: 'Mike Davis', completionRate: 96.8, completedCourses: 30, totalCourses: 31, type: 'manager' }
  ],
  disputeTrends: [
    { id: 1, name: 'Customer Service', date: '2025-01-01', disputeCount: 5, type: 'department' },
    { id: 1, name: 'Customer Service', date: '2025-01-02', disputeCount: 3, type: 'department' },
    { id: 1, name: 'Customer Service', date: '2025-01-03', disputeCount: 7, type: 'department' },
    { id: 1, name: 'Customer Service', date: '2025-01-04', disputeCount: 2, type: 'department' },
    { id: 1, name: 'Customer Service', date: '2025-01-05', disputeCount: 4, type: 'department' },
    { id: 2, name: 'Technical Support', date: '2025-01-01', disputeCount: 2, type: 'department' },
    { id: 2, name: 'Technical Support', date: '2025-01-02', disputeCount: 1, type: 'department' },
    { id: 2, name: 'Technical Support', date: '2025-01-03', disputeCount: 3, type: 'department' },
    { id: 2, name: 'Technical Support', date: '2025-01-04', disputeCount: 0, type: 'department' },
    { id: 2, name: 'Technical Support', date: '2025-01-05', disputeCount: 1, type: 'department' },
    { id: 3, name: 'Sales', date: '2025-01-01', disputeCount: 8, type: 'department' },
    { id: 3, name: 'Sales', date: '2025-01-02', disputeCount: 6, type: 'department' },
    { id: 3, name: 'Sales', date: '2025-01-03', disputeCount: 4, type: 'department' },
    { id: 3, name: 'Sales', date: '2025-01-04', disputeCount: 9, type: 'department' },
    { id: 3, name: 'Sales', date: '2025-01-05', disputeCount: 5, type: 'department' }
  ],
  summaryTable: [
    { id: 1, name: 'Customer Service', type: 'department', qaScore: 87.5, completionRate: 92.5, disputeCount: 21 },
    { id: 2, name: 'Technical Support', type: 'department', qaScore: 91.2, completionRate: 88.7, disputeCount: 7 },
    { id: 3, name: 'Sales', type: 'department', qaScore: 82.8, completionRate: 95.2, disputeCount: 32 },
    { id: 4, name: 'Billing', type: 'department', qaScore: 89.1, completionRate: 85.4, disputeCount: 12 },
    { id: 5, name: 'Retention', type: 'department', qaScore: 85.3, completionRate: 91.8, disputeCount: 8 },
    { id: 1, name: 'John Smith', type: 'manager', qaScore: 88.7, completionRate: 94.1, disputeCount: 6 },
    { id: 2, name: 'Sarah Johnson', type: 'manager', qaScore: 92.1, completionRate: 87.3, disputeCount: 2 },
    { id: 3, name: 'Mike Davis', type: 'manager', qaScore: 81.5, completionRate: 96.8, disputeCount: 9 },
    { id: 4, name: 'Lisa Wilson', type: 'manager', qaScore: 89.5, completionRate: 84.2, disputeCount: 4 },
    { id: 5, name: 'Tom Brown', type: 'manager', qaScore: 86.8, completionRate: 90.5, disputeCount: 3 }
  ]
}; 