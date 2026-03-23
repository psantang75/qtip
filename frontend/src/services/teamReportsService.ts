import axios from 'axios';
import authService from './authService';
import type { 
  ManagerReportFilters, 
  ManagerReportData, 
  FilterOptions 
} from '../types/performance.types';

// Helper function to create axios instance with auth headers
const getAuthorizedAxios = () => {
  const token = authService.getToken();
  return axios.create({
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    }
  });
};

const teamReportsService = {
  // Get available filter options (team members only, manager's department)
  getTeamFilterOptions: async (): Promise<FilterOptions> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/manager/team/filters');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching team filter options:', error);
      throw error;
    }
  },

  // Generate team performance report based on filters
  generateTeamReport: async (filters: ManagerReportFilters): Promise<ManagerReportData> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post('/manager/team/reports', filters);
      return response.data.data;
    } catch (error) {
      console.error('Error generating team performance report:', error);
      throw error;
    }
  },

  // Export team report as CSV or PDF
  exportTeamReport: async (reportId: string, format: 'csv' | 'pdf'): Promise<Blob> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get(`/api/manager/team/export/${reportId}?format=${format}`, {
        responseType: 'blob'
      });
      return response.data;
    } catch (error) {
      console.error('Error exporting team report:', error);
      throw error;
    }
  },

  // Get team performance goals
  getTeamGoals: async (): Promise<any> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/manager/team/goals');
      return response.data.data;
    } catch (error) {
      console.error('Error fetching team goals:', error);
      throw error;
    }
  },

  // Get team member performance summary
  getTeamPerformanceSummary: async (dateRange: { startDate: string; endDate: string }): Promise<any> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/manager/team/performance', {
        params: {
          startDate: dateRange.startDate,
          endDate: dateRange.endDate
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching team performance summary:', error);
      throw error;
    }
  }
};

export default teamReportsService; 