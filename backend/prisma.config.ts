import { defineConfig } from 'prisma/config';
import 'dotenv/config';

/**
 * Resolve the datasource URL the Prisma **CLI** (migrate deploy/status/dev) uses.
 *
 * Single source of truth: this deliberately builds the URL from the same
 * discrete `DB_*` vars the **runtime** client connects with (see
 * `src/config/prisma.ts`, which feeds them to the mariadb adapter). Historically
 * migrations read a *separate* `DATABASE_URL` secret, so when a DB password was
 * rotated the app kept working (it uses `DB_PASSWORD`) while `prisma migrate`
 * failed with `P1000: Authentication failed` against a stale `DATABASE_URL`.
 * Deriving from `DB_*` here means migrations always target exactly where the app
 * connects, in every environment (dev / test / prod), with nothing to keep in
 * sync. `DATABASE_URL` is honored only as a fallback for setups that provide it
 * instead of the discrete vars.
 */
function resolveDatasourceUrl(): string {
  const host = process.env.DB_HOST;

  // No discrete DB_* config → fall back to an explicit DATABASE_URL if present.
  if (!host) {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    throw new Error(
      'prisma.config: set DB_HOST/DB_USER/DB_PASSWORD/DB_NAME (or DATABASE_URL) so migrations can connect.',
    );
  }

  const port = process.env.DB_PORT ?? '3306';
  const user = encodeURIComponent(process.env.DB_USER ?? 'root');
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? '');
  const database = process.env.DB_NAME ?? 'qtip';

  return `mysql://${user}:${password}@${host}:${port}/${database}`;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: resolveDatasourceUrl(),
  },
});
