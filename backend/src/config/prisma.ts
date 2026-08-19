import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { databaseConfig } from './environment';

// Connection params come from the single source of truth (`databaseConfig` in
// environment.ts) so Prisma and the legacy mysql2 pool (config/database.ts)
// cannot drift — identical host/user/password/database/pool size and the same
// production password guard. Port is not part of databaseConfig (the pool uses
// the driver default), so it is read from the environment here.
const adapter = new PrismaMariaDb({
  host: databaseConfig.host,
  port: parseInt(process.env.DB_PORT ?? '3306', 10),
  user: databaseConfig.user,
  password: databaseConfig.password,
  database: databaseConfig.database,
  connectionLimit: databaseConfig.connectionLimit,
  allowPublicKeyRetrieval: true,
});

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
