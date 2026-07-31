/**
 * Template CRUD endpoints. Transport-only.
 */
import { Response } from 'express';
import {
  AuthReq, listTemplates, getTemplate, createTemplate, updateTemplate,
  setTemplateActive, duplicateTemplate,
} from '../../services/scheduling';
import { respondWithError } from './respond';

export const getTemplates = async (req: AuthReq, res: Response) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    res.json({ success: true, data: await listTemplates(includeInactive) });
  } catch (error) {
    respondWithError(res, 'getTemplates', error);
  }
};

export const getTemplateById = async (req: AuthReq, res: Response) => {
  try {
    res.json({ success: true, data: await getTemplate(parseInt(req.params.id)) });
  } catch (error) {
    respondWithError(res, 'getTemplateById', error);
  }
};

export const postTemplate = async (req: AuthReq, res: Response) => {
  try {
    const data = await createTemplate(req.body, req.user!.user_id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'postTemplate', error);
  }
};

export const putTemplate = async (req: AuthReq, res: Response) => {
  try {
    const data = await updateTemplate(parseInt(req.params.id), req.body);
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'putTemplate', error);
  }
};

export const patchTemplateActive = async (req: AuthReq, res: Response) => {
  try {
    const data = await setTemplateActive(parseInt(req.params.id), !!req.body.is_active);
    res.json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'patchTemplateActive', error);
  }
};

export const postDuplicateTemplate = async (req: AuthReq, res: Response) => {
  try {
    const data = await duplicateTemplate(parseInt(req.params.id), req.user!.user_id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    respondWithError(res, 'postDuplicateTemplate', error);
  }
};
