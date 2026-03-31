import { Request, Response } from 'express';
import {
  getReports,
  getNavReports,
  getReportById,
  createReport,
  updateReport,
  deleteReport,
  duplicateReport,
} from '../services/reportService';
import prisma from '../config/prisma';

function getUserContext(req: Request): { userId: number; userRole: string; departmentId: number | null } {
  const user = req.user;
  return {
    userId: user?.user_id ?? 0,
    userRole: user?.role ?? 'CSR',
    departmentId: null, // fetched per-request when needed
  };
}

export const getReportsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, userRole } = getUserContext(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? 1), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10)));
    const search = req.query.search ? String(req.query.search) : undefined;

    // Fetch user's department for scoping
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { department_id: true },
    });
    const departmentId = userRecord?.department_id ?? null;

    const result = await getReports(userId, userRole, departmentId, { page, limit, search });
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[REPORT CONTROLLER] getReports error:', error);
    res.status(500).json({ message: error?.message || 'Failed to fetch reports' });
  }
};

export const getNavReportsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, userRole } = getUserContext(req);

    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { department_id: true },
    });
    const departmentId = userRecord?.department_id ?? null;

    const reports = await getNavReports(userId, userRole, departmentId);
    res.status(200).json({ data: reports });
  } catch (error: any) {
    console.error('[REPORT CONTROLLER] getNavReports error:', error);
    res.status(500).json({ message: error?.message || 'Failed to fetch nav reports' });
  }
};

export const getReportByIdHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ message: 'Invalid report ID' }); return; }

    const report = await getReportById(id);
    if (!report) { res.status(404).json({ message: 'Report not found' }); return; }

    res.status(200).json({ data: report });
  } catch (error: any) {
    console.error('[REPORT CONTROLLER] getReportById error:', error);
    res.status(500).json({ message: error?.message || 'Failed to fetch report' });
  }
};

export const createReportHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = getUserContext(req);
    const { name, layout_config, audience_scope } = req.body;

    if (!name || !layout_config || !audience_scope) {
      res.status(400).json({ message: 'name, layout_config, and audience_scope are required' });
      return;
    }

    const report = await createReport(req.body, userId);
    res.status(201).json({ data: report });
  } catch (error: any) {
    console.error('[REPORT CONTROLLER] createReport error:', error);
    res.status(500).json({ message: error?.message || 'Failed to create report' });
  }
};

export const updateReportHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ message: 'Invalid report ID' }); return; }

    const report = await updateReport(id, req.body);
    res.status(200).json({ data: report });
  } catch (error: any) {
    console.error('[REPORT CONTROLLER] updateReport error:', error);
    if (error?.code === 'P2025') { res.status(404).json({ message: 'Report not found' }); return; }
    res.status(500).json({ message: error?.message || 'Failed to update report' });
  }
};

export const deleteReportHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ message: 'Invalid report ID' }); return; }

    await deleteReport(id);
    res.status(200).json({ message: 'Report deactivated', id });
  } catch (error: any) {
    console.error('[REPORT CONTROLLER] deleteReport error:', error);
    if (error?.code === 'P2025') { res.status(404).json({ message: 'Report not found' }); return; }
    res.status(500).json({ message: error?.message || 'Failed to delete report' });
  }
};

export const duplicateReportHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ message: 'Invalid report ID' }); return; }

    const { userId } = getUserContext(req);
    const copy = await duplicateReport(id, userId);
    res.status(201).json({ data: copy });
  } catch (error: any) {
    console.error('[REPORT CONTROLLER] duplicateReport error:', error);
    res.status(500).json({ message: error?.message || 'Failed to duplicate report' });
  }
};
