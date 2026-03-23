import { Request, Response } from 'express';
import {
  queryRawData,
  getTableSchema,
  getAvailableTables,
  exportRawData,
  VALID_TABLES,
} from '../services/rawDataService';

function getRequestingUser(req: Request) {
  const user = (req as any).user;
  return {
    requestingUserId: user?.user_id ?? 0,
    userRole: user?.role ?? 'CSR',
  };
}

function parseDate(value: any): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

/** GET /api/raw-data/tables */
export const getTablesHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userRole } = getRequestingUser(req);
    const tables = await getAvailableTables(userRole);
    res.status(200).json({ data: tables });
  } catch (error: any) {
    console.error('[RAW DATA CONTROLLER] getTables error:', error);
    res.status(500).json({ message: error?.message || 'Failed to fetch tables' });
  }
};

/** GET /api/raw-data/:table/schema */
export const getSchemaHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const tableName = req.params.table;
    if (!VALID_TABLES.includes(tableName)) {
      res.status(404).json({ message: `Table "${tableName}" not found` });
      return;
    }
    const schema = getTableSchema(tableName);
    res.status(200).json({ data: { table: tableName, columns: schema } });
  } catch (error: any) {
    console.error('[RAW DATA CONTROLLER] getSchema error:', error);
    res.status(500).json({ message: error?.message || 'Failed to fetch schema' });
  }
};

/** POST /api/raw-data/:table/query */
export const queryDataHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const tableName = req.params.table;
    if (!VALID_TABLES.includes(tableName)) {
      res.status(404).json({ message: `Table "${tableName}" not found` });
      return;
    }

    const { requestingUserId, userRole } = getRequestingUser(req);
    const {
      userId,
      departmentId,
      startDate,
      endDate,
      filters,
      columns,
      page = 1,
      limit = 100,
    } = req.body;

    const safePage = Math.max(1, parseInt(String(page), 10));
    const safeLimit = Math.min(1000, Math.max(1, parseInt(String(limit), 10)));

    const result = await queryRawData({
      tableName,
      userId: userId ? Number(userId) : undefined,
      departmentId: departmentId ? Number(departmentId) : undefined,
      userRole,
      requestingUserId,
      startDate: parseDate(startDate),
      endDate: parseDate(endDate),
      filters: Array.isArray(filters) ? filters : [],
      columns: Array.isArray(columns) ? columns : undefined,
      limit: safeLimit,
      offset: (safePage - 1) * safeLimit,
    });

    res.status(200).json({
      ...result,
      page: safePage,
      limit: safeLimit,
      total_pages: Math.ceil(result.total / safeLimit),
    });
  } catch (error: any) {
    console.error('[RAW DATA CONTROLLER] queryData error:', error);
    res.status(500).json({ message: error?.message || 'Query failed' });
  }
};

/** POST /api/raw-data/:table/export */
export const exportDataHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const tableName = req.params.table;
    if (!VALID_TABLES.includes(tableName)) {
      res.status(404).json({ message: `Table "${tableName}" not found` });
      return;
    }

    const { requestingUserId, userRole } = getRequestingUser(req);
    const { userId, departmentId, startDate, endDate, filters, columns } = req.body;

    const buffer = await exportRawData({
      tableName,
      userId: userId ? Number(userId) : undefined,
      departmentId: departmentId ? Number(departmentId) : undefined,
      userRole,
      requestingUserId,
      startDate: parseDate(startDate),
      endDate: parseDate(endDate),
      filters: Array.isArray(filters) ? filters : [],
      columns: Array.isArray(columns) ? columns : undefined,
    });

    const fileName = `${tableName}_export_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error: any) {
    console.error('[RAW DATA CONTROLLER] exportData error:', error);
    res.status(500).json({ message: error?.message || 'Export failed' });
  }
};
