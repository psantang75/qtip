import apiClient from './apiClient';
import type { Course, TrainingPath } from '../types/csr.types';

export const lmsService = {
  // Course API calls
  getCourses: async () => {
    const response = await apiClient.get('/courses');
    // Backend returns paginated response with courses in response.data.data
    return response.data.data || response.data;
  },

  getCourseById: async (id: number) => {
    const response = await apiClient.get(`/courses/${id}`);
    return response.data;
  },

  createCourse: async (course: Course) => {
    const response = await apiClient.post('/courses', course);
    return response.data;
  },

  updateCourse: async (id: number, course: Course) => {
    const response = await apiClient.put(`/courses/${id}`, course);
    return response.data;
  },

  deleteCourse: async (id: number) => {
    const response = await apiClient.delete(`/courses/${id}`);
    return response.data;
  },

  publishCourse: async (id: number) => {
    const response = await apiClient.patch(`/courses/${id}/publish`);
    return response.data;
  },

  // Training Path API calls
  getTrainingPaths: async () => {
    const response = await apiClient.get('/training-paths');
    return response.data;
  },

  getTrainingPathById: async (id: number) => {
    const response = await apiClient.get(`/training-paths/${id}`);
    return response.data;
  },

  createTrainingPath: async (trainingPath: TrainingPath) => {
    const response = await apiClient.post('/training-paths', trainingPath);
    return response.data;
  },

  updateTrainingPath: async (id: number, trainingPath: TrainingPath) => {
    const response = await apiClient.put(`/training-paths/${id}`, trainingPath);
    return response.data;
  },

  deleteTrainingPath: async (id: number) => {
    const response = await apiClient.delete(`/training-paths/${id}`);
    return response.data;
  }
}; 