import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { BaseInsightsWorker, WorkerResult } from './BaseInsightsWorker';

export class EmployeeSyncWorker extends BaseInsightsWorker {
  constructor() {
    super('dimension-emp-sync', 'qtip');
  }

  protected async execute(): Promise<WorkerResult> {
    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT u.id, u.username, u.email, u.department_id, u.manager_id, u.title, u.is_active,
              r.role_name
       FROM users u JOIN roles r ON u.role_id = r.id
       ORDER BY u.id`
    );

    const [dimEmps] = await pool.execute<RowDataPacket[]>(
      `SELECT employee_key, user_id, username, email, role_name, department_key, manager_user_id, title, is_active
       FROM ie_dim_employee WHERE is_current = 1`
    );

    const [deptDims] = await pool.execute<RowDataPacket[]>(
      'SELECT department_key, department_id FROM ie_dim_department WHERE is_current = 1'
    );
    const deptIdToKey = new Map<number, number>();
    for (const d of deptDims) deptIdToKey.set(d.department_id, d.department_key);

    const dimMap = new Map<number, RowDataPacket>();
    for (const e of dimEmps) dimMap.set(e.user_id, e);

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    let loaded = 0;
    let skipped = 0;

    for (const user of users) {
      const deptKey = user.department_id ? (deptIdToKey.get(user.department_id) ?? null) : null;
      const existing = dimMap.get(user.id);

      if (!existing) {
        await this.insertEmployee(user, deptKey, today);
        loaded++;
        continue;
      }

      const changed =
        existing.role_name !== user.role_name ||
        existing.department_key !== deptKey ||
        existing.manager_user_id !== user.manager_id ||
        existing.title !== user.title ||
        (!!existing.is_active) !== (!!user.is_active);

      if (!changed) {
        skipped++;
        continue;
      }

      await pool.execute(
        'UPDATE ie_dim_employee SET effective_to = ?, is_current = 0 WHERE employee_key = ?',
        [yesterday, existing.employee_key]
      );

      await this.insertEmployee(user, deptKey, today);
      loaded++;
    }

    return {
      rowsExtracted: users.length,
      rowsLoaded: loaded,
      rowsSkipped: skipped,
      rowsErrored: 0,
      batchIdentifier: today,
    };
  }

  private async insertEmployee(user: RowDataPacket, deptKey: number | null, effectiveFrom: string): Promise<void> {
    await pool.execute(
      `INSERT INTO ie_dim_employee (user_id, username, email, role_name, department_key, manager_user_id, title, is_active, effective_from, effective_to, is_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
      [user.id, user.username, user.email, user.role_name, deptKey, user.manager_id, user.title, user.is_active ? 1 : 0, effectiveFrom]
    );
  }
}
