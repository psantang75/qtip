# Multiple Database Connections Guide

Q-Tip uses one read/write database for its own data and reads from one or
more external databases owned by other systems. This doc explains the named
pools, how each is configured, and the patterns to follow when adding a new
external integration.

## The pools

| Pool name | Purpose                                                  | Access     | Required env block |
| --------- | -------------------------------------------------------- | ---------- | ------------------ |
| `primary` | Q-Tip's own DB. New code should use Prisma; this raw pool stays for legacy controllers. | Read/write | `DB_*`             |
| `phone`   | External Phone System DB — source of call audio URLs and transcripts. Q-Tip queries on demand and snapshots reviewed calls into its own tables. | Read-only  | `PHONE_DB_*`       |
| `crm`     | External CRM DB (Phase 2) — source of ticket data attached to QA submissions. | Read-only  | `CRM_DB_*`         |

Each external pool is **optional**. If any of the four required env vars in
its block is missing, `phoneDatabaseConfig` / `crmDatabaseConfig` in
[`backend/src/config/environment.ts`](../backend/src/config/environment.ts)
evaluates to `null` and the pool is never created. Calling code that tries
to use it gets a clear `Database configuration not found for connection: …`
error rather than half-connecting against blank credentials.

See [`docs/environment_variables.md`](environment_variables.md) for the full
variable reference.

## Configuration

Add the relevant blocks to `.env`. The minimum is the `DB_*` (primary) block;
add `PHONE_DB_*` to enable phone-system integration and `CRM_DB_*` to enable
the CRM integration.

```env
# Primary (Q-Tip)
DB_HOST=localhost
DB_PORT=3306
DB_USER=qtip_user
DB_PASSWORD=...
DB_NAME=qtip
DB_CONNECTION_LIMIT=20

# Phone System (read-only)
PHONE_DB_HOST=blazer.dm.local
PHONE_DB_PORT=3306
PHONE_DB_USER=qtip_phone_ro
PHONE_DB_PASSWORD=...
PHONE_DB_NAME=PhoneSystem
PHONE_DB_CONNECTION_LIMIT=10

# CRM (read-only, Phase 2)
CRM_DB_HOST=
CRM_DB_PORT=3306
CRM_DB_USER=
CRM_DB_PASSWORD=
CRM_DB_NAME=
CRM_DB_CONNECTION_LIMIT=5
```

Use a dedicated **read-only** MySQL user for both `PHONE_DB_USER` and
`CRM_DB_USER`. Q-Tip never needs to write to either — enforcing it at the
DB user level removes any chance of an accidental mutation.

## Using a pool

### From feature code

Prefer the typed helper functions over reaching for the pool directly:

```typescript
import { executeQuery } from '../utils/databaseUtils';

// Phone System DB
const rows = await executeQuery(
  'SELECT Transcript FROM tblConversationTranscript WHERE ConversationID = ?',
  [conversationId],
  'phone'
);

// CRM DB (Phase 2)
const tickets = await executeQuery(
  'SELECT id, subject FROM tickets WHERE id = ?',
  [ticketId],
  'crm'
);
```

`executeQuery`'s third argument routes to the correct pool. Valid values:
`'default'` / `'primary'` / `'phone'` / `'crm'`.

### From a service module

The phone-system service already follows the pattern that any new external
integration should mirror — see
[`backend/src/services/PhoneSystemService.ts`](../backend/src/services/PhoneSystemService.ts).
A CRM service for Phase 2 should look the same shape: thin wrapper class,
named pool routing, no SQL outside the service.

### Direct pool access

If you need raw `mysql.Pool` access (transactions, prepared streams, etc.):

```typescript
import { getPhonePool, getCrmPool } from '../utils/databaseUtils';

const pool = getPhonePool();
const conn = await pool.getConnection();
try {
  // ...
} finally {
  conn.release();
}
```

## Health checks

```typescript
import { testAllDatabaseConnections, getAllPoolStats } from '../config/database';

const status = await testAllDatabaseConnections();
// -> { primary: true, phone: true, crm: true } when all are configured.
// Pools that aren't configured are simply absent from the result.

const stats = getAllPoolStats();
// -> { primary: {...}, phone?: {...}, crm?: {...} }
```

These are safe to call from a `/health/integrations`-style endpoint; they
ping the pool, never query application tables, and never throw.

## Adding a new external pool

1. Add the env block (`FOO_DB_HOST`, `FOO_DB_USER`, `FOO_DB_PASSWORD`,
   `FOO_DB_NAME`, `FOO_DB_CONNECTION_LIMIT`) to `.env` and to
   [`deploy/production_environment_template.env`](../deploy/production_environment_template.env).
2. Declare the keys on `EnvironmentConfig` and source them in `process.env`
   inside [`backend/src/config/environment.ts`](../backend/src/config/environment.ts).
3. Build a `fooDatabaseConfig` using the same all-or-nothing conditional
   pattern (`null` if any required value is missing).
4. Extend `DatabasePoolName` and `configForPool()` in
   [`backend/src/config/database.ts`](../backend/src/config/database.ts) to
   include `'foo'`.
5. Extend `DatabaseOperation` and `poolNameFor()` in
   [`backend/src/utils/databaseUtils.ts`](../backend/src/utils/databaseUtils.ts).
6. Update `testAllDatabaseConnections()` and `getAllPoolStats()` to surface
   the new pool when configured.
7. Document the new variables in
   [`docs/environment_variables.md`](environment_variables.md) and the new
   pool in this file.

## Security

- Read-only user for every external pool. Q-Tip is a consumer.
- Never commit `.env`. The production template is the only checked-in source.
- For production, set network-level rules (firewall / security group) so
  Q-Tip can only reach the read replica it should be hitting.
