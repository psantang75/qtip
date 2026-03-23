import axios from 'axios';
import authService from './authService';
import { mockFilterOptions, mockReportData } from '../mocks/managerReportsMock';
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

const managerReportsService = {
  // Get available filter options (departments, managers)
  getFilterOptions: async (): Promise<FilterOptions> => {
    try {
      // Use mock data for now
      console.log('Using mock data for filter options');
      return Promise.resolve(mockFilterOptions);
      
      // TODO: Uncomment when backend is ready
      // const api = getAuthorizedAxios();
      // const response = await api.get('/api/director/filters');
      // return response.data;
    } catch (error) {
      console.error('Error fetching filter options:', error);
      throw error;
    }
  },

  // Generate performance report based on filters
  generateReport: async (filters: ManagerReportFilters): Promise<ManagerReportData> => {
    try {
      // Use mock data for now
      console.log('Using mock data for report generation', filters);
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      return Promise.resolve(mockReportData);
      
      // TODO: Uncomment when backend is ready
      // const api = getAuthorizedAxios();
      // const response = await api.post('/api/director/reports', filters);
      // return response.data;
    } catch (error) {
      console.error('Error generating performance report:', error);
      throw error;
    }
  },

  // Export report as CSV or PDF
  exportReport: async (reportId: string, format: 'csv' | 'pdf'): Promise<Blob> => {
    try {
      // Mock CSV/PDF export for now
      console.log('Mock export:', reportId, format);
      const mockData = format === 'csv' 
        ? 'Name,Type,QA Score,Completion Rate,Dispute Count\nCustomer Service,Department,87.5,92.5,21\n'
        : 'Mock PDF content';
      
      return Promise.resolve(new Blob([mockData], { 
        type: format === 'csv' ? 'text/csv' : 'application/pdf' 
      }));
      
      // TODO: Uncomment when backend is ready
      // const api = getAuthorizedAxios();
      // const response = await api.get(`/api/director/export/${reportId}?format=${format}`, {
      //   responseType: 'blob'
      // });
      // return response.data;
    } catch (error) {
      console.error('Error exporting report:', error);
      throw error;
    }
  }
};

export default managerReportsService; 