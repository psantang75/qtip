import axios from 'axios';
import type { Course, CourseCreatePayload, CourseListResponse, CoursePage } from '../types/course.types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const courseApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
courseApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export class CourseService {
  /**
   * Create a new course
   */
  async createCourse(courseData: CourseCreatePayload): Promise<Course> {
    const response = await courseApi.post('/courses', courseData);
    return response.data;
  }

  /**
   * Get list of courses with optional filters
   */
  async getCourses(params?: {
    search?: string;
    is_draft?: boolean;
    page?: number;
    limit?: number;
  }): Promise<CourseListResponse[]> {
    const response = await courseApi.get('/courses', { params });
    return response.data;
  }

  /**
   * Get a specific course by ID
   */
  async getCourse(id: number): Promise<Course> {
    const response = await courseApi.get(`/courses/${id}`);
    return response.data;
  }

  /**
   * Update an existing course
   */
  async updateCourse(id: number, courseData: Partial<CourseCreatePayload>): Promise<Course> {
    const response = await courseApi.put(`/courses/${id}`, courseData);
    return response.data;
  }

  /**
   * Delete a course
   */
  async deleteCourse(id: number): Promise<void> {
    await courseApi.delete(`/courses/${id}`);
  }

  /**
   * Publish a draft course
   */
  async publishCourse(id: number): Promise<Course> {
    const response = await courseApi.patch(`/courses/${id}/publish`);
    return response.data;
  }

  /**
   * Create a new course page
   */
  async createCoursePage(courseId: number, pageData: Omit<CoursePage, 'id' | 'course_id'>): Promise<CoursePage> {
    const response = await courseApi.post(`/courses/${courseId}/pages`, pageData);
    return response.data;
  }

  /**
   * Update an existing course page
   */
  async updateCoursePage(courseId: number, pageId: number, pageData: Partial<Omit<CoursePage, 'id' | 'course_id'>>): Promise<CoursePage> {
    const response = await courseApi.put(`/courses/${courseId}/pages/${pageId}`, pageData);
    return response.data;
  }

  /**
   * Delete a course page
   */
  async deleteCoursePage(courseId: number, pageId: number): Promise<void> {
    await courseApi.delete(`/courses/${courseId}/pages/${pageId}`);
  }

  /**
   * Get all pages for a course
   */
  async getCoursePages(courseId: number): Promise<CoursePage[]> {
    const response = await courseApi.get(`/courses/${courseId}/pages`);
    return response.data;
  }

  /**
   * Auto-save a course page (debounced save for visual editor)
   */
  async autoSaveCoursePage(courseId: number, pageId: number, pageData: Partial<Omit<CoursePage, 'id' | 'course_id'>>): Promise<void> {
    // Use a simpler endpoint for auto-saving that doesn't return full data
    await courseApi.patch(`/courses/${courseId}/pages/${pageId}/autosave`, pageData);
  }
}

export const courseService = new CourseService(); 