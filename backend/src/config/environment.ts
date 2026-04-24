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
  
  // Secondary Database Configuration (Optional)
  DB2_HOST?: string;
  DB2_USER?: string;
  DB2_PASSWORD?: string;
  DB2_NAME?: string;
  DB2_CONNECTION_LIMIT?: number;
  
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
  
  // Secondary Database Configuration (Optional)
  DB2_HOST: process.env.DB2_HOST,
  DB2_USER: process.env.DB2_USER,
  DB2_PASSWORD: process.env.DB2_PASSWORD,
  DB2_NAME: process.env.DB2_NAME,
  DB2_CONNECTION_LIMIT: process.env.DB2_CONNECTION_LIMIT ? parseInt(process.env.DB2_CONNECTION_LIMIT, 10) : undefined,
  
  // JWT Configuration
  JWT_SECRET: process.env.JWT_SECRET || 'qtip_secret_key_change_in_production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'qtip_refresh_secret_change_in_production',
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
 * Secondary database configuration object for connection pooling (optional)
 */
export const secondaryDatabaseConfig = config.DB2_HOST && config.DB2_USER && config.DB2_PASSWORD && config.DB2_NAME ? {
  host: config.DB2_HOST,
  user: config.DB2_USER,
  password: config.DB2_PASSWORD,
  database: config.DB2_NAME,
  waitForConnections: true,
  connectionLimit: config.DB2_CONNECTION_LIMIT || 5,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  charset: 'utf8mb4'
} : null;

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

// Warn about default secrets in production
if (isProduction) {
  if (config.JWT_SECRET.includes('default') || config.JWT_SECRET.includes('change')) {
    console.error('WARNING: Using default JWT secret in production! Please set JWT_SECRET environment variable.');
  }
  
  if (config.REFRESH_TOKEN_SECRET.includes('default') || config.REFRESH_TOKEN_SECRET.includes('change')) {
    console.error('WARNING: Using default refresh token secret in production! Please set REFRESH_TOKEN_SECRET environment variable.');
  }
}

export default config; 