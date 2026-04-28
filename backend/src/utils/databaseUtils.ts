import { getDatabasePool, type DatabasePoolName } from '../config/database';

/**
 * Database operation routing key.
 *
 * - 'default' / 'primary' -> Q-Tip's own DB (use Prisma in new code; this raw
 *   pool exists for legacy controllers that haven't been migrated).
 * - 'phone'               -> external Phone System DB, read-only consumer.
 * - 'crm'                 -> external CRM DB (Phase 2), read-only consumer.
 */
export type DatabaseOperation = 'default' | 'primary' | 'phone' | 'crm';

function poolNameFor(op: DatabaseOperation): DatabasePoolName {
  switch (op) {
    case 'phone': return 'phone';
    case 'crm':   return 'crm';
    case 'default':
    case 'primary':
    default:      return 'primary';
  }
}

/**
 * Get the Phone System DB pool. Throws if PHONE_DB_* env vars are not fully
 * configured — callers should treat that as "phone integration disabled".
 */
export function getPhonePool() {
  return getDatabasePool('phone');
}

/**
 * Get the CRM DB pool (Phase 2). Throws if CRM_DB_* env vars are not fully
 * configured — callers should treat that as "CRM integration disabled".
 */
export function getCrmPool() {
  return getDatabasePool('crm');
}

/**
 * Execute a query against the named external pool (or the primary pool).
 */
export async function executeQuery<T = any>(
  query: string,
  params: any[] = [],
  operation: DatabaseOperation = 'default'
): Promise<T[]> {
  const pool = getDatabasePool(poolNameFor(operation));
  const [rows] = await pool.execute(query, params);
  return rows as T[];
}

/**
 * Run a transaction against the named external pool (or the primary pool).
 */
export async function executeTransaction<T>(
  callback: (connection: any) => Promise<T>,
  operation: DatabaseOperation = 'default'
): Promise<T> {
  const pool = getDatabasePool(poolNameFor(operation));
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
