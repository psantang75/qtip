import mysql from 'mysql2/promise';
import { databaseConfig, secondaryDatabaseConfig } from './environment';

/**
 * Primary database pool — used by controllers that have not yet been migrated to Prisma.
 * Repositories and new code should use Prisma (see ./prisma.ts) instead.
 */
class DatabasePoolFactory {
  private static pools: Map<string, mysql.Pool> = new Map();

  static getPool(connectionName: string = 'primary'): mysql.Pool {
    if (!this.pools.has(connectionName)) {
      const config = connectionName === 'primary' ? databaseConfig : secondaryDatabaseConfig;

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

export async function testDatabaseConnection(connectionName: string = 'primary'): Promise<boolean> {
  try {
    const pool = DatabasePoolFactory.getPool(connectionName);
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch (error) {
    console.error(`Database connectivity test failed for ${connectionName}:`, error);
    return false;
  }
}

export async function testAllDatabaseConnections(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  results.primary = await testDatabaseConnection('primary');
  if (secondaryDatabaseConfig) {
    results.secondary = await testDatabaseConnection('secondary');
  }
  return results;
}

export function getPoolStats(connectionName: string = 'primary') {
  const config = connectionName === 'primary' ? databaseConfig : secondaryDatabaseConfig;
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
  if (secondaryDatabaseConfig) stats.secondary = getPoolStats('secondary');
  return stats;
}

export async function closeDatabaseConnections(): Promise<void> {
  try {
    await DatabasePoolFactory.closeAllPools();
  } catch (error) {
    console.error('Error closing database connection pools:', error);
  }
}

export function getDatabasePool(connectionName: string = 'primary'): mysql.Pool {
  return DatabasePoolFactory.getPool(connectionName);
}

const pool = DatabasePoolFactory.getPool('primary');
export { pool };
export default pool;
