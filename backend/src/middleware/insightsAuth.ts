import { Request, Response, NextFunction } from 'express';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { InsightsPermissionService } from '../services/InsightsPermissionService';

const permissionService = new InsightsPermissionService();

declare global {
  namespace Express {
    interface Request {
      insightsScope?: {
        canAccess: boolean;
        dataScope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF';
        departmentKeys: number[];
        employeeKey: number | null;
        pageId: number;
      };
    }
  }
}

const roleNameToId: Record<string, number> = {
  Admin: 1,
  QA: 2,
  CSR: 3,
  Trainer: 4,
  Manager: 5,
  Director: 6,
};

export const authorizeInsights = (pageKey: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const roleId = roleNameToId[req.user.role];
      if (!roleId) {
        res.status(403).json({ error: 'Unknown role' });
        return;
      }

      const access = await permissionService.resolveAccess(req.user.user_id, roleId, pageKey);

      if (!access.canAccess) {
        res.status(403).json({ error: 'Access denied to this insights page' });
        return;
      }

      req.insightsScope = {
        canAccess: true,
        dataScope: access.dataScope!,
        departmentKeys: access.departmentKeys,
        employeeKey: access.employeeKey,
        pageId: access.pageId!,
      };

      next();
    } catch {
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};
