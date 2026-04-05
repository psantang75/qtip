import pool from '../config/database';
import { RowDataPacket } from 'mysql2';

/**
 * Returns all descendant department_keys (including the root) from ie_dim_department.
 * Uses a recursive CTE to walk the parent_id hierarchy.
 */
export async function getDescendantDepartmentKeys(rootDepartmentKey: number): Promise<number[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `WITH RECURSIVE dept_tree AS (
       SELECT department_key FROM ie_dim_department WHERE department_key = ? AND is_current = TRUE
       UNION ALL
       SELECT d.department_key FROM ie_dim_department d
       INNER JOIN dept_tree dt ON d.parent_id = dt.department_key
       WHERE d.is_current = TRUE
     )
     SELECT department_key FROM dept_tree`,
    [rootDepartmentKey]
  );
  return rows.map((r) => r.department_key as number);
}

/**
 * Returns all descendant department IDs (including the root) from the live Qtip departments table.
 * Used for circular-reference prevention in admin UI.
 */
export async function getDescendantDepartmentIds(rootDepartmentId: number): Promise<number[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `WITH RECURSIVE dept_tree AS (
       SELECT id FROM departments WHERE id = ?
       UNION ALL
       SELECT d.id FROM departments d INNER JOIN dept_tree dt ON d.parent_id = dt.id
     )
     SELECT id FROM dept_tree`,
    [rootDepartmentId]
  );
  return rows.map((r) => r.id as number);
}
