/**
 * Campaign LIBRARY controllers — categories (with color) and campaign items
 * (with anchor rules). Read handlers are open to any campaign viewer; write
 * handlers are gated admin-only at the route layer. Transport-only.
 */
import { Response } from 'express';
import { AuthReq } from '../../services/scheduling';
import {
  listCategories, createCategory, updateCategory, setCategoryActive, reorderCategories,
  createItem, updateItem, setItemActive, reorderItems,
} from '../../services/campaigns';
import { respondWithError } from '../scheduling/respond';

const includeInactive = (req: AuthReq) => req.query.include_inactive === 'true';

// ── Library (categories + nested items) ──────────────────────────────────────
export const getLibrary = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await listCategories(includeInactive(req)) }); }
  catch (error) { respondWithError(res, 'getLibrary', error); }
};

// ── Categories ───────────────────────────────────────────────────────────────
export const postCategory = async (req: AuthReq, res: Response) => {
  try { res.status(201).json({ success: true, data: await createCategory(req.body) }); }
  catch (error) { respondWithError(res, 'postCategory', error); }
};
export const putCategory = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await updateCategory(parseInt(req.params.id), req.body) }); }
  catch (error) { respondWithError(res, 'putCategory', error); }
};
export const patchCategoryActive = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await setCategoryActive(parseInt(req.params.id), !!req.body.is_active) }); }
  catch (error) { respondWithError(res, 'patchCategoryActive', error); }
};
export const postReorderCategories = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await reorderCategories(req.body.order) }); }
  catch (error) { respondWithError(res, 'postReorderCategories', error); }
};

// ── Items ────────────────────────────────────────────────────────────────────
export const postItem = async (req: AuthReq, res: Response) => {
  try { res.status(201).json({ success: true, data: await createItem(req.body) }); }
  catch (error) { respondWithError(res, 'postItem', error); }
};
export const putItem = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await updateItem(parseInt(req.params.id), req.body) }); }
  catch (error) { respondWithError(res, 'putItem', error); }
};
export const patchItemActive = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await setItemActive(parseInt(req.params.id), !!req.body.is_active) }); }
  catch (error) { respondWithError(res, 'patchItemActive', error); }
};
export const postReorderItems = async (req: AuthReq, res: Response) => {
  try { res.json({ success: true, data: await reorderItems(req.body.order) }); }
  catch (error) { respondWithError(res, 'postReorderItems', error); }
};
