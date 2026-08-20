import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Environment configuration interface
 */
interface EnvironmentConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number | string;
  
  // Primary Database Configuration
  DB_HOST: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  DB_CONNECTION_LIMIT: number;

  // Phone System Database Configuration (read-only consumer; optional)
  PHONE_DB_HOST?: string;
  PHONE_DB_USER?: string;
  PHONE_DB_PASSWORD?: string;
  PHONE_DB_NAME?: string;
  PHONE_DB_CONNECTION_LIMIT?: number;
  /**
   * Optional override applied to `tblConversationRecording.RecordingPath`
   * before the streaming endpoint opens the MP3. The DB stores Windows
   * UNC paths like `\\wagoneer\DMCMS\PhoneSystem Recording\<id>.mp3`,
   * which work as-is when the Node process runs on a Windows host with
   * share access. Leave unset on Windows. On Linux, mount the share and
   * set this to the mount root prefix that should replace the UNC root
   * (e.g. `/mnt/phonesystem-recordings`). The leading `\\wagoneer\DMCMS\PhoneSystem Recording\`
   * portion is rewritten to this value (with `/` separators) so the
   * filename suffix is preserved.
   */
  PHONE_RECORDING_BASE_PATH?: string;

  // CRM Database Configuration (Phase 2 read-only consumer; optional)
  CRM_DB_HOST?: string;
  CRM_DB_USER?: string;
  CRM_DB_PASSWORD?: string;
  CRM_DB_NAME?: string;
  CRM_DB_CONNECTION_LIMIT?: number;

  // AI Provider Configuration (per-provider; either may be absent)
  OPENAI_API_KEY?: string;
  OPENAI_DEFAULT_MODEL?: string;
  OPENAI_TIMEOUT_MS?: number;
  OPENAI_MAX_RETRIES?: number;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_DEFAULT_MODEL?: string;
  ANTHROPIC_TIMEOUT_MS?: number;
  ANTHROPIC_MAX_RETRIES?: number;

  // BookStack KB (read-only consumer; optional. Disabled when TOKEN_ID or
  // TOKEN_SECRET is blank — same "leave-blank-to-disable" pattern as the
  // optional database pools above.)
  BOOKSTACK_BASE_URL?: string;
  BOOKSTACK_TOKEN_ID?: string;
  BOOKSTACK_TOKEN_SECRET?: string;
  BOOKSTACK_TIMEOUT_MS?: number;
  BOOKSTACK_MAX_RETRIES?: number;

  // AI Reviewer system user id. Optional: when blank, the /api/ai-reviewer/*
  // endpoints return 503 not_configured. Same "leave-blank-to-disable"
  // pattern as the other optional integrations above. The user row itself
  // is created via backend/scripts/seed-ai-reviewer.ts.
  AI_REVIEWER_USER_ID?: number;

  // JWT Configuration
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  REFRESH_TOKEN_SECRET: string;
  REFRESH_TOKEN_EXPIRES_IN: string;
  
  // Security Configuration
  BCRYPT_ROUNDS: number;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  AUTH_RATE_LIMIT_MAX: number;
  
  // File Upload Configuration
  MAX_FILE_SIZE: number;
  UPLOAD_DIR: string;
  
  // Email / Notification Configuration. SMTP_HOST blank => not_configured
  // (same leave-blank-to-disable pattern as the optional integrations above).
  // Internal relay (yukon.dm.local) does not require auth; SMTP_USER /
  // SMTP_PASSWORD remain optional.
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM_ADDRESS?: string;
  MAIL_FROM_NAME?: string;
  MAIL_DEV_DRY_RUN?: boolean;
  MAIL_OVERRIDE_RECIPIENT?: string;
  MAIL_QUIET_HOURS?: string;        // "23-06" => quiet from 23:00 to 06:00 local
  MAIL_GLOBAL_RATE_LIMIT?: number;  // emails per 5-min window before circuit-breaker trips
  MAIL_TIMEZONE?: string;           // IANA tz used to render dates and digest windows

  // Inbound mailbox import (Exchange Web Services). EXCHANGE_EWS_URL blank =>
  // the poller never starts, same leave-blank-to-disable pattern as SMTP above.
  // On-prem Exchange only; NTLM, so EXCHANGE_USER is DOMAIN\user.
  EXCHANGE_EWS_URL?: string;
  EXCHANGE_USER?: string;
  EXCHANGE_PASSWORD?: string;
  EXCHANGE_MAILBOX?: string;
  MAILBOX_IMPORT_POLL_MINUTES?: number;
  MAILBOX_IMPORT_DRY_RUN?: boolean;
  MAILBOX_IMPORT_USER_ID?: number;
  MAILBOX_IMPORT_IGNORE_BEFORE?: string;  // 'YYYY-MM-DD'; ignore mail received before this
  MAILBOX_IMPORT_ALLOWED_TYPES?: string;  // comma-separated DataType allowlist; default 'punch_data'

  // Manual Import Center (Admin > Manual Upload). Comma-separated DataType
  // allowlist for the interactive/API upload path; default 'punch_data'. The
  // six non-punch *_raw datasets have no unique grain and arrive automatically
  // (warehouse sync -> ie_fact_*), so manual upload of them is disabled by
  // default to prevent duplicate rows in the Data Explorer's raw tables.
  IMPORT_ALLOWED_TYPES?: string;

  APP_BASE_URL?: string;            // used for deep links in emails

  
  // Logging Configuration
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
  LOG_FILE?: string;
  
  // CORS Configuration
  ALLOWED_ORIGINS: string[];
  
  // Application Configuration
  APP_NAME: string;
  APP_VERSION: string;
}

/**
 * Validate required environment variables
 */
const validateEnvironment = (): void => {
  const required = [
    'DB_HOST',
    'DB_USER', 
    'DB_PASSWORD',
    'DB_NAME'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing);
    process.exit(1);
  }
};

/**
 * Known dev-only secret defaults. Kept here as a single source of truth
 * so every caller can detect "the operator forgot to set the env var" the
 * same way and refuse to issue tokens against a value that's effectively
 * public.
 */
const DEV_JWT_SECRET_DEFAULT = 'qtip_secret_key_change_in_production';
const DEV_REFRESH_SECRET_DEFAULT = 'qtip_refresh_secret_change_in_production';
// Older code paths (now removed) used this shorter value — keep it in the
// reject list so a stale .env that still has it can't slip into prod.
const LEGACY_DEV_JWT_SECRETS = ['qtip_secret_key'];

/**
 * Resolve the JWT signing secret for the current process.
 *
 * Returns `process.env.JWT_SECRET` whenever it is set to a real value
 * (anything other than a known dev placeholder). In production / test it
 * **fails fast** — `process.exit(1)` after logging — when the variable is
 * missing or still equals one of the dev defaults, so the server can never
 * sign tokens against a value an attacker can read in this repo.
 *
 * In development it falls back to the documented dev default with a
 * one-time warning so local setup keeps working without `.env` plumbing.
 *
 * Use this from `middleware/auth.ts` and `services/AuthenticationService.ts`
 * — never re-derive the secret from `process.env.JWT_SECRET` at the call
 * site, because that's how the two security postures the pre-production
 * review (item #44) flagged ended up coexisting.
 */
let _devJwtWarned = false;
let _devRefreshWarned = false;

export const getJwtSecret = (): string => {
  const raw = process.env.JWT_SECRET?.trim();
  const isDevDefault = !raw || raw === DEV_JWT_SECRET_DEFAULT || LEGACY_DEV_JWT_SECRETS.includes(raw);
  const env = process.env.NODE_ENV;
  if (isDevDefault && env !== 'development') {
    console.error('[FATAL] JWT_SECRET is not set or is using a known dev default. Refusing to start.');
    process.exit(1);
  }
  if (isDevDefault) {
    if (!_devJwtWarned) {
      console.warn('[auth] JWT_SECRET not set — using development default. Do NOT deploy this build.');
      _devJwtWarned = true;
    }
    return DEV_JWT_SECRET_DEFAULT;
  }
  return raw as string;
};

/** Same fail-fast policy as `getJwtSecret`, applied to the refresh secret. */
export const getJwtRefreshSecret = (): string => {
  const raw = process.env.REFRESH_TOKEN_SECRET?.trim();
  const isDevDefault = !raw || raw === DEV_REFRESH_SECRET_DEFAULT;
  const env = process.env.NODE_ENV;
  if (isDevDefault && env !== 'development') {
    console.error('[FATAL] REFRESH_TOKEN_SECRET is not set or is using the dev default. Refusing to start.');
    process.exit(1);
  }
  if (isDevDefault) {
    if (!_devRefreshWarned) {
      console.warn('[auth] REFRESH_TOKEN_SECRET not set — using development default. Do NOT deploy this build.');
      _devRefreshWarned = true;
    }
    return DEV_REFRESH_SECRET_DEFAULT;
  }
  return raw as string;
};

/**
 * Parse allowed origins from environment variable
 */
const parseAllowedOrigins = (): string[] => {
  const origins = process.env.ALLOWED_ORIGINS;
  if (!origins) {
    return ['http://localhost:5173', 'http://localhost:3000']; // Default for development
  }
  return origins.split(',').map(origin => origin.trim());
};

/**
 * Main environment configuration object
 */
export const config: EnvironmentConfig = {
  NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') || 'development',
  PORT: process.env.PORT || '3000',
  
  // Primary Database Configuration
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DB_PASSWORD must be set in production environment');
    }
    return 'development_password_change_for_production';
  })(),
  DB_NAME: process.env.DB_NAME || 'qtip',
  DB_CONNECTION_LIMIT: parseInt(process.env.DB_CONNECTION_LIMIT || '25', 10),

  // Phone System Database (optional; pool only created when fully configured)
  PHONE_DB_HOST: process.env.PHONE_DB_HOST,
  PHONE_DB_USER: process.env.PHONE_DB_USER,
  PHONE_DB_PASSWORD: process.env.PHONE_DB_PASSWORD,
  PHONE_DB_NAME: process.env.PHONE_DB_NAME,
  PHONE_DB_CONNECTION_LIMIT: process.env.PHONE_DB_CONNECTION_LIMIT ? parseInt(process.env.PHONE_DB_CONNECTION_LIMIT, 10) : undefined,
  PHONE_RECORDING_BASE_PATH: process.env.PHONE_RECORDING_BASE_PATH,

  // CRM Database (Phase 2; optional; pool only created when fully configured)
  CRM_DB_HOST: process.env.CRM_DB_HOST,
  CRM_DB_USER: process.env.CRM_DB_USER,
  CRM_DB_PASSWORD: process.env.CRM_DB_PASSWORD,
  CRM_DB_NAME: process.env.CRM_DB_NAME,
  CRM_DB_CONNECTION_LIMIT: process.env.CRM_DB_CONNECTION_LIMIT ? parseInt(process.env.CRM_DB_CONNECTION_LIMIT, 10) : undefined,

  // AI Providers (each provider independently optional; client built only when key set)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_DEFAULT_MODEL: process.env.OPENAI_DEFAULT_MODEL || 'gpt-5',
  OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS ? parseInt(process.env.OPENAI_TIMEOUT_MS, 10) : 30000,
  OPENAI_MAX_RETRIES: process.env.OPENAI_MAX_RETRIES ? parseInt(process.env.OPENAI_MAX_RETRIES, 10) : 2,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_DEFAULT_MODEL: process.env.ANTHROPIC_DEFAULT_MODEL || 'claude-opus-4-7',
  ANTHROPIC_TIMEOUT_MS: process.env.ANTHROPIC_TIMEOUT_MS ? parseInt(process.env.ANTHROPIC_TIMEOUT_MS, 10) : 30000,
  ANTHROPIC_MAX_RETRIES: process.env.ANTHROPIC_MAX_RETRIES ? parseInt(process.env.ANTHROPIC_MAX_RETRIES, 10) : 2,

  // BookStack KB (optional; client only constructed when both token halves are present)
  BOOKSTACK_BASE_URL: process.env.BOOKSTACK_BASE_URL,
  BOOKSTACK_TOKEN_ID: process.env.BOOKSTACK_TOKEN_ID,
  BOOKSTACK_TOKEN_SECRET: process.env.BOOKSTACK_TOKEN_SECRET,
  BOOKSTACK_TIMEOUT_MS: process.env.BOOKSTACK_TIMEOUT_MS ? parseInt(process.env.BOOKSTACK_TIMEOUT_MS, 10) : 15000,
  BOOKSTACK_MAX_RETRIES: process.env.BOOKSTACK_MAX_RETRIES ? parseInt(process.env.BOOKSTACK_MAX_RETRIES, 10) : 2,

  // AI Reviewer (optional; endpoint guards on this being a positive integer)
  AI_REVIEWER_USER_ID: process.env.AI_REVIEWER_USER_ID ? parseInt(process.env.AI_REVIEWER_USER_ID, 10) : undefined,

  // JWT Configuration — resolved through getJwtSecret/getJwtRefreshSecret so
  // that prod / test fail fast when the env var is missing or still equals a
  // known dev default. See pre-production review item #44.
  JWT_SECRET: getJwtSecret(),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  REFRESH_TOKEN_SECRET: getJwtRefreshSecret(),
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  
  // Security Configuration
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  // Per-user (JWT) / per-IP cap. This is an authenticated internal SPA where a
  // single dashboard page legitimately fires 10-30 queries, so 100/15min was far
  // too low and caused 429 storms. 1000/15min is generous per user/IP.
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000', 10),
  AUTH_RATE_LIMIT_MAX: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10),
  
  // File Upload Configuration
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10), // 5MB
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
  
  // Email / Notification Configuration
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  MAIL_FROM_ADDRESS: process.env.MAIL_FROM_ADDRESS,
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
  MAIL_DEV_DRY_RUN: process.env.MAIL_DEV_DRY_RUN
    ? /^(1|true|yes)$/i.test(process.env.MAIL_DEV_DRY_RUN)
    : undefined,
  MAIL_OVERRIDE_RECIPIENT: process.env.MAIL_OVERRIDE_RECIPIENT,
  MAIL_QUIET_HOURS: process.env.MAIL_QUIET_HOURS,
  MAIL_GLOBAL_RATE_LIMIT: process.env.MAIL_GLOBAL_RATE_LIMIT
    ? parseInt(process.env.MAIL_GLOBAL_RATE_LIMIT, 10)
    : undefined,
  MAIL_TIMEZONE: process.env.MAIL_TIMEZONE,

  // Inbound mailbox import (Exchange Web Services)
  EXCHANGE_EWS_URL: process.env.EXCHANGE_EWS_URL,
  EXCHANGE_USER: process.env.EXCHANGE_USER,
  EXCHANGE_PASSWORD: process.env.EXCHANGE_PASSWORD,
  EXCHANGE_MAILBOX: process.env.EXCHANGE_MAILBOX,
  MAILBOX_IMPORT_POLL_MINUTES: process.env.MAILBOX_IMPORT_POLL_MINUTES
    ? parseInt(process.env.MAILBOX_IMPORT_POLL_MINUTES, 10)
    : undefined,
  MAILBOX_IMPORT_DRY_RUN: process.env.MAILBOX_IMPORT_DRY_RUN
    ? /^(1|true|yes)$/i.test(process.env.MAILBOX_IMPORT_DRY_RUN)
    : undefined,
  MAILBOX_IMPORT_USER_ID: process.env.MAILBOX_IMPORT_USER_ID
    ? parseInt(process.env.MAILBOX_IMPORT_USER_ID, 10)
    : undefined,
  MAILBOX_IMPORT_IGNORE_BEFORE: process.env.MAILBOX_IMPORT_IGNORE_BEFORE,
  MAILBOX_IMPORT_ALLOWED_TYPES: process.env.MAILBOX_IMPORT_ALLOWED_TYPES,
  IMPORT_ALLOWED_TYPES: process.env.IMPORT_ALLOWED_TYPES,

  APP_BASE_URL: process.env.APP_BASE_URL,

  
  // Logging Configuration
  LOG_LEVEL: (process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug') || 'info',
  LOG_FILE: process.env.LOG_FILE,
  
  // CORS Configuration
  ALLOWED_ORIGINS: parseAllowedOrigins(),
  
  // Application Configuration
  APP_NAME: process.env.APP_NAME || 'QTIP',
  APP_VERSION: process.env.APP_VERSION || '1.0.0'
};

/**
 * Environment-specific configurations
 */
export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTesting = config.NODE_ENV === 'test';

/**
 * Primary database configuration object for connection pooling
 */
export const databaseConfig = {
  host: config.DB_HOST,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  waitForConnections: true,
  connectionLimit: config.DB_CONNECTION_LIMIT,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  // Read/write DATETIME values as UTC, independent of the host/Node timezone.
  // Paired with a per-connection `SET time_zone = '+00:00'` (see config/database.ts)
  // so NOW()/CURRENT_TIMESTAMP are UTC too. This makes `.toISOString()` emit a
  // correct instant the frontend can render in the browser's local zone — the
  // same in dev/test/prod — and matches how Prisma already stores timestamps.
  // Only the primary pool is pinned; phone/crm are external read-only sources
  // whose DATETIMEs must keep their own timezone semantics.
  timezone: 'Z' as const,
  charset: 'utf8mb4'
};

/**
 * Phone System database configuration (optional). Only built when every
 * required value is present so a half-configured environment never produces
 * a half-working pool. Read-only consumer — Q-Tip never writes here.
 */
export const phoneDatabaseConfig = config.PHONE_DB_HOST && config.PHONE_DB_USER && config.PHONE_DB_PASSWORD && config.PHONE_DB_NAME ? {
  host: config.PHONE_DB_HOST,
  user: config.PHONE_DB_USER,
  password: config.PHONE_DB_PASSWORD,
  database: config.PHONE_DB_NAME,
  waitForConnections: true,
  connectionLimit: config.PHONE_DB_CONNECTION_LIMIT || 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  charset: 'utf8mb4'
} : null;

/**
 * CRM database configuration (Phase 2; optional). Same conditional pattern as
 * phoneDatabaseConfig — leave any of the four required env vars blank in
 * .env to disable the pool entirely. Read-only consumer.
 */
export const crmDatabaseConfig = config.CRM_DB_HOST && config.CRM_DB_USER && config.CRM_DB_PASSWORD && config.CRM_DB_NAME ? {
  host: config.CRM_DB_HOST,
  user: config.CRM_DB_USER,
  password: config.CRM_DB_PASSWORD,
  database: config.CRM_DB_NAME,
  waitForConnections: true,
  connectionLimit: config.CRM_DB_CONNECTION_LIMIT || 5,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  charset: 'utf8mb4'
} : null;

/**
 * AI provider configuration. Each provider is independently optional; an
 * absent API key means the corresponding entry is `null` and the client
 * factory in services/ai/ will refuse to construct a client. Health pings
 * for an unconfigured provider report `not_configured` rather than failing.
 */
export const aiConfig = {
  openai: config.OPENAI_API_KEY ? {
    apiKey: config.OPENAI_API_KEY,
    defaultModel: config.OPENAI_DEFAULT_MODEL!,
    timeoutMs: config.OPENAI_TIMEOUT_MS!,
    maxRetries: config.OPENAI_MAX_RETRIES!,
  } : null,
  anthropic: config.ANTHROPIC_API_KEY ? {
    apiKey: config.ANTHROPIC_API_KEY,
    defaultModel: config.ANTHROPIC_DEFAULT_MODEL!,
    timeoutMs: config.ANTHROPIC_TIMEOUT_MS!,
    maxRetries: config.ANTHROPIC_MAX_RETRIES!,
  } : null,
};

/**
 * BookStack KB configuration. Same conditional-construction pattern as the
 * optional database pools and AI providers above: the client is only built
 * when both halves of the token are present AND the base URL is set, so a
 * partially-configured environment cleanly degrades to "not configured"
 * rather than throwing at startup.
 *
 * Trailing slashes on the base URL are stripped here so callers can
 * unconditionally append `/api/...` paths without worrying about doubles.
 */
export const bookstackConfig = config.BOOKSTACK_BASE_URL && config.BOOKSTACK_TOKEN_ID && config.BOOKSTACK_TOKEN_SECRET ? {
  baseUrl: config.BOOKSTACK_BASE_URL.replace(/\/+$/, ''),
  tokenId: config.BOOKSTACK_TOKEN_ID,
  tokenSecret: config.BOOKSTACK_TOKEN_SECRET,
  timeoutMs: config.BOOKSTACK_TIMEOUT_MS!,
  maxRetries: config.BOOKSTACK_MAX_RETRIES!,
} : null;

/**
 * AI Reviewer configuration. Only built when AI_REVIEWER_USER_ID resolves to
 * a positive integer; otherwise the /api/ai-reviewer/* endpoints answer
 * `503 not_configured` instead of attempting a half-configured submission.
 *
 * The user row this id points at is seeded by backend/scripts/seed-ai-reviewer.ts.
 */
export const aiReviewerConfig = config.AI_REVIEWER_USER_ID && config.AI_REVIEWER_USER_ID > 0 ? {
  userId: config.AI_REVIEWER_USER_ID,
} : null;

/**
 * Email / notification configuration. Same leave-blank-to-disable pattern
 * as the optional integrations above: when SMTP_HOST is missing the
 * EmailService reports `not_configured` and every send becomes a logged
 * no-op. We never want a half-configured mail relay to silently drop
 * password-reset emails in production.
 *
 * `dryRun` forces console-only output regardless of SMTP_HOST — used in
 * dev/test so a misconfigured developer machine never spams real users.
 *
 * `overrideRecipient`, when set, rewrites every outbound `To/Cc/Bcc` to a
 * single inbox. Industry-standard "envelope rewrite" for staging.
 */
export const mailConfig = {
  enabled: !!config.SMTP_HOST,
  host: config.SMTP_HOST,
  port: config.SMTP_PORT ?? 25,
  user: config.SMTP_USER || undefined,
  password: config.SMTP_PASSWORD || undefined,
  fromAddress: config.MAIL_FROM_ADDRESS || 'noreply.qtip@dm-us.com',
  fromName: config.MAIL_FROM_NAME || 'QTIP Notifications',
  appBaseUrl: (config.APP_BASE_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  dryRun: config.MAIL_DEV_DRY_RUN ?? config.NODE_ENV !== 'production',
  overrideRecipient: config.MAIL_OVERRIDE_RECIPIENT || undefined,
  quietHours: config.MAIL_QUIET_HOURS || '',
  globalRateLimit: config.MAIL_GLOBAL_RATE_LIMIT ?? 1000,
  timezone: config.MAIL_TIMEZONE || 'America/New_York',
};

/**
 * Inbound mailbox import: QTIP polls an Exchange mailbox and loads any Excel
 * report emailed to it. See docs/mailbox_import.md.
 *
 * `enabled` is keyed on the EWS URL so a deployment that never sets it simply
 * never starts the poller — no error, no log noise.
 *
 * `dryRun` defaults ON everywhere including production, because this reads live
 * mail and writes to warehouse tables. It must be switched off deliberately,
 * once the sender allowlist is populated and the inbox is known to be clean.
 *
 * `importedByUserId` is normally the only attribution available: the punch
 * report arrives from an automated no-reply address that will never match a
 * QTIP user.
 *
 * `allowedTypesRaw` is the STRICT allowlist of report types the mailbox may
 * ingest. In practice only ONE report (the Paychex punch feed) arrives by
 * email — every other `*_raw` dataset comes from the warehouse queries, not the
 * inbox. So this defaults (resolved in `MailboxImportScheduler`) to
 * `punch_data` only; anything else emailed in is refused to `QTIP Failed`.
 * Override with a comma-separated `MAILBOX_IMPORT_ALLOWED_TYPES` if that ever
 * changes — a config edit, not a code change.
 */
export const mailboxImportConfig = {
  enabled: !!config.EXCHANGE_EWS_URL,
  ewsUrl: config.EXCHANGE_EWS_URL || '',
  user: config.EXCHANGE_USER || '',
  password: config.EXCHANGE_PASSWORD || '',
  mailbox: config.EXCHANGE_MAILBOX || '',
  pollMinutes: Math.max(1, config.MAILBOX_IMPORT_POLL_MINUTES ?? 10),
  dryRun: config.MAILBOX_IMPORT_DRY_RUN ?? true,
  importedByUserId: config.MAILBOX_IMPORT_USER_ID,
  ignoreBefore: config.MAILBOX_IMPORT_IGNORE_BEFORE || '',
  allowedTypesRaw: config.MAILBOX_IMPORT_ALLOWED_TYPES || '',
};

/**
 * JWT configuration object
 */
export const jwtConfig = {
  secret: config.JWT_SECRET,
  expiresIn: config.JWT_EXPIRES_IN,
  refreshSecret: config.REFRESH_TOKEN_SECRET,
  refreshExpiresIn: config.REFRESH_TOKEN_EXPIRES_IN
};

/**
 * Validate environment on module import
 * Only enforce in production to allow development flexibility
 */
if (process.env.NODE_ENV === 'production') {
  validateEnvironment();
} else if (process.env.NODE_ENV !== 'test') {
  // Warn about missing variables in development
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn('⚠️  Missing environment variables (using defaults):', missing);
    console.warn('📝 For production deployment, set these in .env file');
  }
}

// Default-secret enforcement now lives in getJwtSecret / getJwtRefreshSecret
// (process.exit(1) on a dev default in non-development envs), so this file no
// longer needs a separate "warn at startup" block.

export default config;
