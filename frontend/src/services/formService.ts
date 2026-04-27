import apiClient, { apiGet } from './apiClient';
import type { Form, FormListItem } from '../types/form.types';
import { logError } from '../utils/errorHandling';

// The other handlers in this file keep their own try/catch because they
// translate specific HTTP status codes into user-facing messages
// (e.g. 404 → "Form not found…"). Only simple pass-through calls use
// the shared `apiGet`/`apiPost`/etc. helpers from apiClient.

// Get all forms with optional active filter
export const getAllForms = async (isActive?: boolean): Promise<FormListItem[]> => {
  const d = await apiGet<unknown>(
    'formService',
    '/forms',
    isActive !== undefined ? { params: { is_active: isActive } } : undefined,
  );
  if (Array.isArray(d))                               return d as FormListItem[];
  if (d && typeof d === 'object' && 'forms' in d && Array.isArray((d as { forms: unknown }).forms))
    return (d as { forms: FormListItem[] }).forms;
  if (d && typeof d === 'object' && 'items' in d && Array.isArray((d as { items: unknown }).items))
    return (d as { items: FormListItem[] }).items;
  return [];
};

// Get form by ID with all details
export const getFormById = async (formId: number, includeInactive = false): Promise<Form> => {
  try {
    const url = includeInactive ? `/forms/${formId}?include_inactive=true` : `/forms/${formId}`;
    const response = await apiClient.get(url);
    return response.data;
  } catch (error: any) {
    if (error.response) {
      const { status, data } = error.response;
      if (status === 401) throw new Error('Authentication expired. Please login again.');
      if (status === 404) throw new Error('Form not found. The form may have been deleted or you may not have permission to view it.');
      if (status === 403) throw new Error('Access denied. You do not have permission to view this form.');
      if (status === 500) throw new Error('Server error occurred while loading the form. Please try again.');
      if (data?.error) throw new Error(data.error);
    } else if (error.request) {
      throw new Error('Unable to connect to server. Please check your internet connection and try again.');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  }
};

// Create new form
export const createForm = async (formData: Form): Promise<{ message: string; form_id: number }> => {
  try {
    const response = await apiClient.post('/forms', formData, {
      timeout: 60000,
      headers: { 'Content-Type': 'application/json' },
    });
    return response.data;
  } catch (error: unknown) {
    if (error.response) {
      const { status, data } = error.response;
      if (status === 404) throw new Error('Form endpoint not found. Please check if the server is running correctly.');
      if (status === 500) throw new Error('Server error occurred while creating form. Please try again.');
      if (status === 413) throw new Error('Form data is too large. Please reduce the number of questions or categories.');
      if (data?.message) throw new Error(data.message);
    } else if (error.request) {
      throw new Error('No response received from server. Please check your connection and try again.');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Request timed out. The form might be too complex. Please try again or contact support.');
    }
    logError('formService', 'Error creating form:', error);
    throw error;
  }
};

// Update form (creates new version)
export const updateForm = async (formId: number, formData: Form): Promise<{ message: string; form_id: number }> => {
  try {
    const response = await apiClient.put(`/forms/${formId}`, formData, {
      timeout: 60000,
      headers: { 'Content-Type': 'application/json' },
    });
    return response.data;
  } catch (error: unknown) {
    if (error.response) {
      const { status, data } = error.response;
      if (status === 404) throw new Error(`Form with ID ${formId} not found. Please check if the form exists.`);
      if (status === 500) throw new Error('Server error occurred while updating form. Please try again.');
      if (status === 413) throw new Error('Form data is too large. Please reduce the number of questions or categories.');
      if (data?.message) throw new Error(data.message);
    } else if (error.request) {
      throw new Error('No response received from server. Please check your connection and try again.');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Request timed out. The form might be too complex. Please try again or contact support.');
    }
    logError('formService', `Error updating form ${formId}:`, error);
    throw error;
  }
};

// Deactivate form (does not create new version)
export const deactivateForm = async (formId: number): Promise<{ message: string }> => {
  try {
    const response = await apiClient.delete(`/forms/${formId}`);
    return response.data;
  } catch (error: any) {
    if (error.response) {
      const { status, data } = error.response;
      if (status === 401) throw new Error('Authentication expired. Please login again.');
      if (status === 404) throw new Error('Form not found. The form may have been deleted.');
      if (status === 403) throw new Error('Access denied. You do not have permission to deactivate this form.');
      if (status === 500) throw new Error(data?.error || data?.message || 'Server error occurred while deactivating the form. Please try again.');
      if (data?.error) throw new Error(data.error);
    } else if (error.request) {
      throw new Error('Unable to connect to server. Please check your internet connection and try again.');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Request timed out. Please try again.');
    }
    logError('formService', `Error deactivating form ${formId}:`, error);
    throw error;
  }
};
