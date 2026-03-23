import { getDatabasePool } from '../config/database';

/**
 * Database operation types for routing to the secondary (PhoneSystem) database.
 * Primary DB operations should use Prisma directly via ../config/prisma.
 */
export type DatabaseOperation = 'default' | 'analytics' | 'reporting' | 'primary' | 'secondary';

/**
 * Get the secondary database pool (PhoneSystem).
 * Only use for operations that must access the secondary DB.
 */
export function getSecondaryPool() {
  return getDatabasePool('secondary');
}

/**
 * Execute a query on the secondary database (PhoneSystem).
 */
export async function executeQuery<T = any>(
  query: string,
  params: any[] = [],
  operation: DatabaseOperation = 'default'
): Promise<T[]> {
  const pool = getDatabasePool(operation === 'secondary' || operation === 'analytics' || operation === 'reporting' ? 'secondary' : 'primary');
  const [rows] = await pool.execute(query, params);
  return rows as T[];
}

/**
 * Execute a transaction on the secondary database.
 */
export async function executeTransaction<T>(
  callback: (connection: any) => Promise<T>,
  operation: DatabaseOperation = 'default'
): Promise<T> {
  const pool = getDatabasePool(operation === 'secondary' ? 'secondary' : 'primary');
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
