import { Request, Response } from 'express';
import { FormService, FormServiceError } from '../services/FormService';
import { MySQLFormRepository } from '../repositories/MySQLFormRepository';

// Initialize form service with repository
const formRepository = new MySQLFormRepository();
const formService = new FormService(formRepository);

/**
 * Get all forms with optional filtering and pagination
 * @route GET /api/forms
 */
export const getForms = async (req: Request, res: Response) => {
  try {
    // Get forms with optional filtering
    
    // Tri-state: 'true' = active only, 'false' = inactive only, absent = all
    const isActiveParam = req.query.is_active as string | undefined;
    const isActive: boolean | undefined =
      isActiveParam === 'true'  ? true  :
      isActiveParam === 'false' ? false :
      undefined;

    const page = req.query.page ? parseInt(req.query.page as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const result = await formService.getForms(isActive, page, limit);
    
    console.log('[FORM CONTROLLER] Service returned:', {
      formCount: result.forms.length,
      hasPagination: !!result.pagination
    });
    
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FormServiceError) {
      return res.status(error.statusCode).json({ 
        error: error.message,
        code: error.code 
      });
    }
    
    console.error('[FORM CONTROLLER] Error in getForms:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get form by ID with complete structure
 * @route GET /api/forms/:id
 */
export const getFormById = async (req: Request, res: Response) => {
  try {
    console.log('[FORM CONTROLLER] Getting form by ID');
    console.log('[FORM CONTROLLER] Request params:', req.params);
    console.log('[FORM CONTROLLER] Request query:', req.query);
    console.log('[FORM CONTROLLER] User:', req.user);
    
    const form_id = parseInt(req.params.id);
    
    if (isNaN(form_id) || form_id <= 0) {
      console.error('[FORM CONTROLLER] Invalid form ID:', req.params.id);
      return res.status(400).json({ 
        error: 'Invalid form ID',
        code: 'INVALID_FORM_ID'
      });
    }
    
    const includeInactive = req.query.include_inactive === 'true';
    
    console.log(`[FORM CONTROLLER] Fetching form ${form_id} (includeInactive: ${includeInactive})`);
    
    const form = await formService.getFormById(form_id, includeInactive);
    
    console.log('[FORM CONTROLLER] Form retrieved successfully:', {
      form_id: form.id,
      form_name: form.form_name,
      categoriesCount: form.categories?.length || 0,
      totalQuestions: form.categories?.reduce((sum, cat) => sum + (cat.questions?.length || 0), 0) || 0
    });
    
    return res.status(200).json(form);
  } catch (error) {
    console.error('[FORM CONTROLLER] Error in getFormById:', error);
    
    if (error instanceof FormServiceError) {
      console.error('[FORM CONTROLLER] FormServiceError:', {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode
      });
      return res.status(error.statusCode).json({ 
        error: error.message,
        code: error.code 
      });
    }
    
    console.error('[FORM CONTROLLER] Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * Create a new form with categories and questions
 * @route POST /api/forms
 */
export const createForm = async (req: Request, res: Response) => {
  try {
    console.log('[FORM CONTROLLER] Creating new form');
    console.log('[FORM CONTROLLER] Request body keys:', Object.keys(req.body));
    console.log('[FORM CONTROLLER] Form data size:', JSON.stringify(req.body).length, 'characters');
    
    const formData = req.body;
    const created_by = req.user?.user_id;
    if (!created_by) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

    // Validate that we have the required data
    if (!formData.form_name) {
      return res.status(400).json({ 
        error: 'Form name is required',
        code: 'MISSING_FORM_NAME'
      });
    }
    
    if (!formData.categories || formData.categories.length === 0) {
      return res.status(400).json({ 
        error: 'At least one category is required',
        code: 'MISSING_CATEGORIES'
      });
    }
    
    console.log('[FORM CONTROLLER] Starting form creation process...');
    const result = await formService.createForm(formData, created_by);
    
    console.log('[FORM CONTROLLER] Form creation successful:', result);
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof FormServiceError) {
      console.error('[FORM CONTROLLER] FormServiceError:', error.message, 'Code:', error.code);
      return res.status(error.statusCode).json({ 
        error: error.message,
        code: error.code 
      });
    }
    
    console.error('[FORM CONTROLLER] Error in createForm:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'An unexpected error occurred while creating the form. Please try again.',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
};

/**
 * Update existing form (creates new version)
 * @route PUT /api/forms/:id
 */
export const updateForm = async (req: Request, res: Response) => {
  try {
    console.log('[FORM CONTROLLER] Updating form');
    console.log('[FORM CONTROLLER] Form ID:', req.params.id);
    console.log('[FORM CONTROLLER] Request body keys:', Object.keys(req.body));
    console.log('[FORM CONTROLLER] Form data size:', JSON.stringify(req.body).length, 'characters');
    
    const form_id = parseInt(req.params.id);
    const formData = req.body;
    const updatedBy = req.user?.user_id;
    if (!updatedBy) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

    // Validate form ID
    if (isNaN(form_id) || form_id <= 0) {
      return res.status(400).json({ 
        error: 'Invalid form ID',
        code: 'INVALID_FORM_ID'
      });
    }
    
    // Validate that we have the required data
    if (!formData.form_name) {
      return res.status(400).json({ 
        error: 'Form name is required',
        code: 'MISSING_FORM_NAME'
      });
    }
    
    if (!formData.categories || formData.categories.length === 0) {
      return res.status(400).json({ 
        error: 'At least one category is required',
        code: 'MISSING_CATEGORIES'
      });
    }
    
    console.log('[FORM CONTROLLER] Starting form update process...');
    const result = await formService.updateForm(form_id, formData, updatedBy);
    
    console.log('[FORM CONTROLLER] Form update successful:', result);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FormServiceError) {
      console.error('[FORM CONTROLLER] FormServiceError:', error.message, 'Code:', error.code);
      return res.status(error.statusCode).json({ 
        error: error.message,
        code: error.code 
      });
    }
    
    console.error('[FORM CONTROLLER] Error in updateForm:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'An unexpected error occurred while updating the form. Please try again.',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
};

/**
 * Deactivate form
 * @route DELETE /api/forms/:id
 */
export const deactivateForm = async (req: Request, res: Response) => {
  try {
    console.log('[FORM CONTROLLER] Deactivating form');
    
    const form_id = parseInt(req.params.id);
    const updatedBy = req.user?.user_id;
    if (!updatedBy) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });

    console.log('[FORM CONTROLLER] Deactivation request details:', {
      form_id,
      updatedBy,
      user: req.user,
      hasAuth: !!req.user,
      timestamp: new Date().toISOString()
    });
    
    const result = await formService.deactivateForm(form_id, updatedBy);
    
    console.log('[FORM CONTROLLER] Deactivation successful:', result);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof FormServiceError) {
      console.error('[FORM CONTROLLER] FormServiceError in deactivateForm:', {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        details: error.details
      });
      return res.status(error.statusCode).json({ 
        error: error.message,
        code: error.code 
      });
    }
    
    console.error('[FORM CONTROLLER] Unexpected error in deactivateForm:', {
      error: error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      form_id: req.params.id,
      user: req.user
    });
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred'
    });
  }
}; 