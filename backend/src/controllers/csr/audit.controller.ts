import { Request, Response } from 'express';
import { CSRService, CSRAuditFilters } from '../../services/CSRService';
import logger from '../../config/logger';

/**
 * CSR audit handlers — `/api/csr/audits/*` and the finalize endpoint.
 *
 * One of three transport modules under `controllers/csr/` (consolidated
 * during pre-production review item #69). Re-exported via `./index`.
 */

/**
 * Get audits for a CSR
 * @route GET /api/csr/audits
 */
export const getCSRAudits = async (req: Request, res: Response): Promise<void> => {
  try {
    const csr_id = req.user?.user_id;
    
    if (!csr_id) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const { page = 1, limit = 10, formName, form_id_search, startDate, endDate, status, searchTerm } = req.query;
    
    const filters: CSRAuditFilters = {
      formName: formName as string,
      form_id_search: form_id_search as string,
      startDate: startDate as string,
      endDate: endDate as string,
      status: status as string,
      searchTerm: searchTerm as string
    };
    
    // Remove undefined values
    Object.keys(filters).forEach(key => 
      filters[key as keyof CSRAuditFilters] === undefined && 
      delete filters[key as keyof CSRAuditFilters]
    );

    const result = await CSRService.getCSRAudits(
      csr_id,
      Number(page),
      Number(limit),
      filters
    );

    res.status(200).json(result);
  } catch (error) {
    logger.error('Error fetching CSR audits:', error);
    res.status(500).json({ message: 'Failed to fetch audits' });
  }
};

/**
 * Get audit details for a CSR
 * @route GET /api/csr/audits/:id
 */
export const getCSRAuditDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const csr_id = req.user?.user_id;
    const auditId = parseInt(req.params.id);
    
    logger.info(`\n🚀 CSR AUDIT CONTROLLER: getCSRAuditDetails called for audit ${auditId} by CSR ${csr_id}`);
    
    if (!csr_id) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (isNaN(auditId)) {
      res.status(400).json({ message: 'Invalid audit ID' });
      return;
    }

    const auditDetails = await CSRService.getAuditDetails(auditId, csr_id);

    if (!auditDetails) {
      res.status(404).json({ message: 'Audit not found or access denied' });
      return;
    }

    res.status(200).json(auditDetails);
  } catch (error) {
    logger.error('Error fetching audit details:', error);
    res.status(500).json({ message: 'Failed to fetch audit details' });
  }
};

/**
 * Check if an audit is disputable
 * @route GET /api/csr/audits/:id/disputable
 */
export const isAuditDisputable = async (req: Request, res: Response): Promise<void> => {
  try {
    const csr_id = req.user?.user_id;
    const auditId = parseInt(req.params.id);
    
    if (!csr_id) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (isNaN(auditId)) {
      res.status(400).json({ message: 'Invalid audit ID' });
      return;
    }

    const disputable = await CSRService.isAuditDisputable(auditId, csr_id);

    res.status(200).json({ disputable });
  } catch (error) {
    logger.error('Error checking if audit is disputable:', error);
    res.status(500).json({ message: 'Failed to check audit disputability' });
  }
};

/**
 * Finalize a submission (CSR accepts the review)
 * @route PUT /api/csr/audits/:id/finalize
 */
export const finalizeSubmission = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('[CSR AUDIT CONTROLLER] finalizeSubmission called');
    logger.info('[CSR AUDIT CONTROLLER] Request params:', req.params);
    logger.info('[CSR AUDIT CONTROLLER] Request body:', req.body);
    logger.info('[CSR AUDIT CONTROLLER] User:', req.user);
    
    const csr_id = req.user?.user_id;
    const submission_id = parseInt(req.params.id);
    
    logger.info('[CSR AUDIT CONTROLLER] Parsed values:', { csr_id, submission_id });
    
    if (!csr_id) {
      logger.info('[CSR AUDIT CONTROLLER] No CSR ID found');
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    if (isNaN(submission_id)) {
      logger.info('[CSR AUDIT CONTROLLER] Invalid submission ID:', req.params.id);
      res.status(400).json({ message: 'Invalid submission ID' });
      return;
    }

    logger.info('[CSR AUDIT CONTROLLER] Calling CSRService.finalizeSubmission');
    const success = await CSRService.finalizeSubmission(submission_id, csr_id);
    logger.info('[CSR AUDIT CONTROLLER] CSRService.finalizeSubmission result:', success);

    if (!success) {
      logger.info('[CSR AUDIT CONTROLLER] Finalization failed, returning 400');
      res.status(400).json({ 
        message: 'Cannot finalize submission. It may not exist, not belong to you, or not be in the correct status.' 
      });
      return;
    }

    logger.info('[CSR AUDIT CONTROLLER] Finalization successful, returning 200');
    res.status(200).json({ 
      message: 'Submission finalized successfully',
      success: true 
    });
  } catch (error) {
    logger.error('Error finalizing submission:', error);
    res.status(500).json({ message: 'Failed to finalize submission' });
  }
}; 