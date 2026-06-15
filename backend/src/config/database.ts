import mysql from 'mysql2/promise';
import { databaseConfig, phoneDatabaseConfig, crmDatabaseConfig } from './environment';
import { DB_SESSION_TIMEOUT_SECONDS, DB_SESSION_TIMEOUT_MS } from '../utils/queryTimeout';
import logger from './logger';

/**
 * Named database pools.
 * - 'primary' -> Q-Tip's own DB (read/write). Most new code should use Prisma
 *   via ./prisma.ts; this pool is kept for legacy controllers.
 * - 'phone'   -> external Phone System DB, read-only consumer.
 * - 'crm'     -> external CRM DB (Phase 2), read-only consumer.
 *
 * Each non-primary pool is optional: if its config block is missing in
 * environment.ts (because the relevant env vars aren't set), getPool() throws
 * a clear error so callers can detect "feature not configured" without
 * connecting against half-set credentials.
 *
 * Every new physical connection has a per-session statement timeout applied.
 * MySQL and MariaDB use different names for the same idea, so we try MySQL
 * syntax first (`SET SESSION max_execution_time = <ms>`) and fall back to
 * MariaDB (`SET SESSION max_statement_time = <seconds>`) if it errors. Any
 * SELECT that exceeds the cap is killed by the engine. This is the
 * engine-side counterpart to `withQueryTimeout()` in
 * `utils/queryTimeout.ts`.
 */
export type DatabasePoolName = 'primary' | 'phone' | 'crm';

function configForPool(name: DatabasePoolName) {
  switch (name) {
    case 'primary': return databaseConfig;
    case 'phone':   return phoneDatabaseConfig;
    case 'crm':     return crmDatabaseConfig;
  }
}

class DatabasePoolFactory {
  private static pools: Map<DatabasePoolName, mysql.Pool> = new Map();

  static getPool(connectionName: DatabasePoolName = 'primary'): mysql.Pool {
    if (!this.pools.has(connectionName)) {
      const config = configForPool(connectionName);

      if (!config) {
        throw new Error(`Database configuration not found for connection: ${connectionName}`);
      }

      const pool = mysql.createPool({
        host: config.host,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: config.waitForConnections ?? true,
        connectionLimit: config.connectionLimit,
        queueLimit: config.queueLimit ?? 0,
        charset: 'utf8mb4',
        typeCast: true,
      });

      // Apply the session statement timeout once per physical connection. The
      // mysql2 pool emits 'connection' the first time a given socket is
      // borrowed; subsequent re-uses reuse the existing session settings.
      // We swallow per-connection errors because (a) the pool will just hand
      // out a working connection without the cap if SET fails, and (b) the
      // application-level `withQueryTimeout` wrapper still protects the
      // request from hanging indefinitely.
      //
      // To avoid noisy logs on every new socket on engines that don't support
      // either variable name, we remember the outcome at the pool level and
      // only log once (at debug, not warn) if neither variant works.
      const corePool = (pool as unknown as { pool: { on: (e: string, cb: (c: { query: (sql: string, cb: (err: unknown) => void) => void }) => void) => void } }).pool;
      let unsupportedLogged = false;
      corePool.on('connection', (conn) => {
        // Try MySQL first (vars-by-name lookup is faster than try/catch on
        // the wire, but mysql2 doesn't expose server version pre-handshake,
        // so a single throwaway SET is the cheapest probe).
        conn.query(`SET SESSION max_execution_time = ${DB_SESSION_TIMEOUT_MS}`, (mysqlErr) => {
          if (!mysqlErr) return;
          conn.query(`SET SESSION max_statement_time = ${DB_SESSION_TIMEOUT_SECONDS}`, (mariaErr) => {
            if (!mariaErr) return;
            if (!unsupportedLogged) {
              unsupportedLogged = true;
              logger.debug('[db] engine accepts neither max_execution_time nor max_statement_time; relying on app-level withQueryTimeout only', {
                connection: connectionName,
                mysqlError: (mysqlErr as Error).message,
                mariaError: (mariaErr as Error).message,
              });
            }
          });
        });
      });

      this.pools.set(connectionName, pool);
    }

    return this.pools.get(connectionName)!;
  }

  static async closeAllPools(): Promise<void> {
    const closePromises = Array.from(this.pools.values()).map((pool) => pool.end());
    await Promise.all(closePromises);
    this.pools.clear();
  }
}

export async function testDatabaseConnection(connectionName: DatabasePoolName = 'primary'): Promise<boolean> {
  try {
    const pool = DatabasePoolFactory.getPool(connectionName);
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch (error) {
    logger.error(`Database connectivity test failed for ${connectionName}:`, error);
    return false;
  }
}

export async function testAllDatabaseConnections(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  results.primary = await testDatabaseConnection('primary');
  if (phoneDatabaseConfig) {
    results.phone = await testDatabaseConnection('phone');
  }
  if (crmDatabaseConfig) {
    results.crm = await testDatabaseConnection('crm');
  }
  return results;
}

export function getPoolStats(connectionName: DatabasePoolName = 'primary') {
  const config = configForPool(connectionName);
  return {
    connectionName,
    connectionLimit: config?.connectionLimit,
    host: config?.host,
    database: config?.database,
  };
}

export function getAllPoolStats() {
  const stats: Record<string, any> = {};
  stats.primary = getPoolStats('primary');
  if (phoneDatabaseConfig) stats.phone = getPoolStats('phone');
  if (crmDatabaseConfig) stats.crm = getPoolStats('crm');
  return stats;
}

export async function closeDatabaseConnections(): Promise<void> {
  try {
    await DatabasePoolFactory.closeAllPools();
  } catch (error) {
    logger.error('Error closing database connection pools:', error);
  }
}

export function getDatabasePool(connectionName: DatabasePoolName = 'primary'): mysql.Pool {
  return DatabasePoolFactory.getPool(connectionName);
}

const pool = DatabasePoolFactory.getPool('primary');
export { pool };
export default pool;
