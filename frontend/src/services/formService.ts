import apiClient from './apiClient';
import type { Form, FormListItem } from '../types/form.types';

// Get auth token from localStorage
const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    }
  };
};

// Get all forms with optional active filter
export const getAllForms = async (isActive?: boolean): Promise<FormListItem[]> => {
  try {
    let url = '/forms';
    if (isActive !== undefined) {
      url += `?is_active=${isActive}`;
    }
    
    const response = await apiClient.get(url);
    return response.data;
  } catch (error) {
    console.error('Error fetching forms:', error);
    throw error;
  }
};

// Get form by ID with all details
export const getFormById = async (formId: number, includeInactive: boolean = false): Promise<Form> => {
  try {
    console.log(`[FORM SERVICE] Fetching form with ID: ${formId} (includeInactive: ${includeInactive})`);
    
    // Check if user is authenticated
    const token = localStorage.getItem('token');
    if (!token) {
      console.error('[FORM SERVICE] No authentication token found');
      throw new Error('Authentication required. Please login again.');
    }
    
    const url = includeInactive ? `/forms/${formId}?include_inactive=true` : `/forms/${formId}`;
    const response = await apiClient.get(url);
    console.log(`[FORM SERVICE] Successfully fetched form ${formId}:`, response.data);
    return response.data;
  } catch (error: any) {
    console.error(`[FORM SERVICE] Error fetching form ${formId}:`, error);
    
    // Enhanced error handling
    if (error.response) {
      console.error('[FORM SERVICE] Server response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
      
      // Handle specific error cases
      if (error.response.status === 401) {
        throw new Error('Authentication expired. Please login again.');
      } else if (error.response.status === 404) {
        throw new Error('Form not found. The form may have been deleted or you may not have permission to view it.');
      } else if (error.response.status === 403) {
        throw new Error('Access denied. You do not have permission to view this form.');
      } else if (error.response.status === 500) {
        throw new Error('Server error occurred while loading the form. Please try again.');
      }
      
      // If the server sent back a specific error message, throw that
      if (error.response.data && error.response.data.error) {
        throw new Error(error.response.data.error);
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('[FORM SERVICE] No response received:', error.request);
      throw new Error('Unable to connect to server. Please check your internet connection and try again.');
    } else if (error.code === 'ECONNABORTED') {
      // Request timeout
      console.error('[FORM SERVICE] Request timeout:', error.message);
      throw new Error('Request timed out. Please try again.');
    }
    
    throw error;
  }
};

// Create new form
export const createForm = async (formData: Form): Promise<{ message: string; form_id: number }> => {
  try {
    // Ensure created_by field is present (frontend might not set this)
    const modifiedFormData = {
      ...formData,
      // Use the user ID from localStorage if available, or default to 1
      created_by: localStorage.getItem('userId') ? parseInt(localStorage.getItem('userId') || '1') : 1
    };
    
    // Log what we're sending to help with debugging
    console.log('Sending form data to server:', {
      form_name: modifiedFormData.form_name,
      categories_count: modifiedFormData.categories?.length || 0,
      total_questions: modifiedFormData.categories?.reduce((sum, cat) => sum + (cat.questions?.length || 0), 0) || 0,
      metadata_fields_count: modifiedFormData.metadata_fields?.length || 0
    });
    
    const response = await apiClient.post('/forms', modifiedFormData, {
      timeout: 60000, // 60 second timeout for complex forms
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Form creation successful:', response.data);
    return response.data;
  } catch (error: any) {
    // Enhanced error handling to provide more detailed information
    if (error.response) {
      // The server responded with a status code outside the 2xx range
      console.error('Error creating form - Server response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });
      
      // Handle specific error cases
      if (error.response.status === 404) {
        throw new Error('Form endpoint not found. Please check if the server is running correctly.');
      } else if (error.response.status === 500) {
        throw new Error('Server error occurred while creating form. Please try again.');
      } else if (error.response.status === 413) {
        throw new Error('Form data is too large. Please reduce the number of questions or categories.');
      }
      
      // If the server sent back a specific error message, throw that
      if (error.response.data && error.response.data.message) {
        throw new Error(error.response.data.message);
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('Error creating form - No response received:', error.request);
      throw new Error('No response received from server. Please check your connection and try again.');
    } else if (error.code === 'ECONNABORTED') {
      // Request timeout
      console.error('Error creating form - Request timeout:', error.message);
      throw new Error('Request timed out. The form might be too complex. Please try again or contact support.');
    }
    
    console.error('Error creating form:', error);
    throw error;
  }
};

// Update form (creates new version)
export const updateForm = async (formId: number, formData: Form): Promise<{ message: string; form_id: number }> => {
  try {
    // Ensure created_by field is present
    const modifiedFormData = {
      ...formData,
      created_by: localStorage.getItem('userId') ? parseInt(localStorage.getItem('userId') || '1') : 1
    };
    
    // Log what we're sending to help with debugging
    console.log(`Updating form ${formId} with data:`, {
      form_name: modifiedFormData.form_name,
      categories_count: modifiedFormData.categories?.length || 0,
      total_questions: modifiedFormData.categories?.reduce((sum, cat) => sum + (cat.questions?.length || 0), 0) || 0,
      metadata_fields_count: modifiedFormData.metadata_fields?.length || 0
    });
    
    const response = await apiClient.put(`/forms/${formId}`, modifiedFormData, {
      timeout: 60000, // 60 second timeout for complex forms
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Form update successful:', response.data);
    return response.data;
  } catch (error: any) {
    // Enhanced error handling to provide more detailed information
    if (error.response) {
      console.error(`Error updating form ${formId} - Server response:`, {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });
      
      // Handle specific error cases
      if (error.response.status === 404) {
        throw new Error(`Form with ID ${formId} not found. Please check if the form exists.`);
      } else if (error.response.status === 500) {
        throw new Error('Server error occurred while updating form. Please try again.');
      } else if (error.response.status === 413) {
        throw new Error('Form data is too large. Please reduce the number of questions or categories.');
      }
      
      // If the server sent back a specific error message, throw that
      if (error.response.data && error.response.data.message) {
        throw new Error(error.response.data.message);
      }
    } else if (error.request) {
      console.error(`Error updating form ${formId} - No response received:`, error.request);
      throw new Error('No response received from server. Please check your connection and try again.');
    } else if (error.code === 'ECONNABORTED') {
      console.error(`Error updating form ${formId} - Request timeout:`, error.message);
      throw new Error('Request timed out. The form might be too complex. Please try again or contact support.');
    }
    
    console.error(`Error updating form ${formId}:`, error);
    throw error;
  }
};

// Deactivate form (does not create new version)
export const deactivateForm = async (formId: number): Promise<{ message: string }> => {
  try {
    // Check if user is authenticated
    const token = localStorage.getItem('token');
    if (!token) {
      console.error('[FORM SERVICE] No authentication token found');
      throw new Error('Authentication required. Please login again.');
    }
    
    console.log(`[FORM SERVICE] Deactivating form ${formId}`);
    
    const response = await apiClient.delete(`/forms/${formId}`);
    console.log(`[FORM SERVICE] Successfully deactivated form ${formId}:`, response.data);
    return response.data;
  } catch (error: any) {
    console.error(`[FORM SERVICE] Error deactivating form ${formId}:`, error);
    
    // Enhanced error handling
    if (error.response) {
      console.error('[FORM SERVICE] Server response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });
      
      // Handle specific error cases
      if (error.response.status === 401) {
        throw new Error('Authentication expired. Please login again.');
      } else if (error.response.status === 404) {
        throw new Error('Form not found. The form may have been deleted.');
      } else if (error.response.status === 403) {
        throw new Error('Access denied. You do not have permission to deactivate this form.');
      } else if (error.response.status === 500) {
        // Show the actual server error message if available
        const serverMessage = error.response.data?.error || error.response.data?.message || 'Server error occurred while deactivating the form. Please try again.';
        console.error('[FORM SERVICE] 500 Error details:', {
          serverError: error.response.data,
          formId: formId,
          requestUrl: `/forms/${formId}`,
          requestMethod: 'DELETE'
        });
        throw new Error(serverMessage);
      }
      
      // If the server sent back a specific error message, throw that
      if (error.response.data && error.response.data.error) {
        throw new Error(error.response.data.error);
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('[FORM SERVICE] No response received:', error.request);
      throw new Error('Unable to connect to server. Please check your internet connection and try again.');
    } else if (error.code === 'ECONNABORTED') {
      // Request timeout
      throw new Error('Request timed out. Please try again.');
    }
    
    throw error;
  }
}; 