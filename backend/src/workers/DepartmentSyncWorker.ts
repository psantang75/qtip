import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';

export class DepartmentSyncWorker extends BaseInsightsWorker {
  constructor() {
    super('dimension-dept-sync', 'qtip');
  }

  protected async execute(): Promise<WorkerResult> {
    const [qtipDepts] = await pool.execute<RowDataPacket[]>(
      'SELECT id, department_name, is_active, parent_id FROM departments ORDER BY id'
    );

    const [dimDepts] = await pool.execute<RowDataPacket[]>(
      'SELECT department_key, department_id, department_name, is_active, parent_id FROM ie_dim_department WHERE is_current = 1'
    );

    const dimMap = new Map<number, RowDataPacket>();
    for (const d of dimDepts) dimMap.set(d.department_id, d);

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    let loaded = 0;
    let skipped = 0;

    for (const dept of qtipDepts) {
      const existing = dimMap.get(dept.id);

      if (!existing) {
        const name = dept.department_name.replace(/'/g, "''");
        await pool.execute(
          `INSERT INTO ie_dim_department (department_id, department_name, parent_id, hierarchy_level, hierarchy_path, is_active, effective_from, effective_to, is_current)
           VALUES (?, ?, NULL, 0, ?, ?, ?, NULL, 1)`,
          [dept.id, dept.department_name, `/${name}`, dept.is_active ? 1 : 0, today]
        );
        loaded++;
        continue;
      }

      const nameChanged = existing.department_name !== dept.department_name;
      const activeChanged = (!!existing.is_active) !== (!!dept.is_active);
      if (!nameChanged && !activeChanged) {
        skipped++;
        continue;
      }

      await pool.execute(
        'UPDATE ie_dim_department SET effective_to = ?, is_current = 0 WHERE department_key = ?',
        [yesterday, existing.department_key]
      );

      await pool.execute(
        `INSERT INTO ie_dim_department (department_id, department_name, parent_id, hierarchy_level, hierarchy_path, is_active, effective_from, effective_to, is_current)
         VALUES (?, ?, NULL, 0, ?, ?, ?, NULL, 1)`,
        [dept.id, dept.department_name, `/${dept.department_name.replace(/'/g, "''")}`, dept.is_active ? 1 : 0, today]
      );
      loaded++;
    }

    await this.recomputeHierarchy();

    return {
      rowsExtracted: qtipDepts.length,
      rowsLoaded: loaded,
      rowsSkipped: skipped,
      rowsErrored: 0,
      batchIdentifier: today,
    };
  }

  private async recomputeHierarchy(): Promise<void> {
    const [qtipDepts] = await pool.execute<RowDataPacket[]>(
      'SELECT id, department_name, parent_id FROM departments ORDER BY id'
    );
    const qtipMap = new Map<number, RowDataPacket>();
    for (const d of qtipDepts) qtipMap.set(d.id, d);

    const [dimCurrent] = await pool.execute<RowDataPacket[]>(
      'SELECT department_key, department_id FROM ie_dim_department WHERE is_current = 1'
    );
    const deptIdToKey = new Map<number, number>();
    for (const d of dimCurrent) deptIdToKey.set(d.department_id, d.department_key);

    for (const dim of dimCurrent) {
      const qtip = qtipMap.get(dim.department_id);
      if (!qtip) continue;

      let level = 0;
      const pathParts: string[] = [];
      let currentId: number | null = qtip.id;

      while (currentId != null) {
        const dept = qtipMap.get(currentId);
        if (!dept) break;
        pathParts.unshift(dept.department_name);
        currentId = dept.parent_id;
        if (currentId != null) level++;
      }

      const hierarchyPath = '/' + pathParts.join('/');
      const parentDimKey = qtip.parent_id ? (deptIdToKey.get(qtip.parent_id) ?? null) : null;

      await pool.execute(
        'UPDATE ie_dim_department SET hierarchy_level = ?, hierarchy_path = ?, parent_id = ? WHERE department_key = ?',
        [level, hierarchyPath, parentDimKey, dim.department_key]
      );
    }
  }
}
