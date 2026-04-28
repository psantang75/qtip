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
  
  // Email Configuration (for future use)
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  
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

  // CRM Database (Phase 2; optional; pool only created when fully configured)
  CRM_DB_HOST: process.env.CRM_DB_HOST,
  CRM_DB_USER: process.env.CRM_DB_USER,
  CRM_DB_PASSWORD: process.env.CRM_DB_PASSWORD,
  CRM_DB_NAME: process.env.CRM_DB_NAME,
  CRM_DB_CONNECTION_LIMIT: process.env.CRM_DB_CONNECTION_LIMIT ? parseInt(process.env.CRM_DB_CONNECTION_LIMIT, 10) : undefined,

  // AI Providers (each provider independently optional; client built only when key set)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_DEFAULT_MODEL: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini',
  OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS ? parseInt(process.env.OPENAI_TIMEOUT_MS, 10) : 30000,
  OPENAI_MAX_RETRIES: process.env.OPENAI_MAX_RETRIES ? parseInt(process.env.OPENAI_MAX_RETRIES, 10) : 2,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_DEFAULT_MODEL: process.env.ANTHROPIC_DEFAULT_MODEL || 'claude-3-5-sonnet-latest',
  ANTHROPIC_TIMEOUT_MS: process.env.ANTHROPIC_TIMEOUT_MS ? parseInt(process.env.ANTHROPIC_TIMEOUT_MS, 10) : 30000,
  ANTHROPIC_MAX_RETRIES: process.env.ANTHROPIC_MAX_RETRIES ? parseInt(process.env.ANTHROPIC_MAX_RETRIES, 10) : 2,

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
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  AUTH_RATE_LIMIT_MAX: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10),
  
  // File Upload Configuration
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10), // 5MB
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
  
  // Email Configuration
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  
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
