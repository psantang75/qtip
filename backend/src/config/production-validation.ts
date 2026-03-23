/**
 * Production Environment Validation Module
 * 
 * Validates that all required environment variables are set for production deployment.
 * This prevents runtime failures due to missing configuration.
 * 
 * @version 1.0.0
 * @author QTIP Development Team
 */

import logger from './logger';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Required environment variables for production
 */
const REQUIRED_ENV_VARS = [
  'NODE_ENV',
  'JWT_SECRET',
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'PORT'
] as const;

/**
 * Optional but recommended environment variables
 */
const RECOMMENDED_ENV_VARS = [
  'APP_VERSION',
  'LOG_LEVEL',
  'CORS_ORIGIN',
  'SESSION_SECRET',
  'BCRYPT_ROUNDS',
  'RATE_LIMIT_WINDOW',
  'RATE_LIMIT_MAX_REQUESTS'
] as const;

/**
 * Environment variables that should not use default values in production
 */
const NO_DEFAULT_IN_PROD = [
  'JWT_SECRET',
  'DB_PASSWORD',
  'SESSION_SECRET'
] as const;

/**
 * Validates a single environment variable
 */
const validateEnvVar = (
  varName: string, 
  value: string | undefined,
  is_required: boolean = false
): { isValid: boolean; error?: string; warning?: string } => {
  
  if (is_required && !value) {
    return {
      isValid: false,
      error: `Required environment variable ${varName} is not set`
    };
  }

  if (!value) {
    return {
      isValid: true,
      warning: `Optional environment variable ${varName} is not set`
    };
  }

  // Check for dangerous default values in production
  if (process.env.NODE_ENV === 'production') {
    const dangerousDefaults = {
      JWT_SECRET: ['secret', 'qtip_secret_key', 'default_secret'],
      DB_PASSWORD: ['password', 'admin', '123456', 'root'],
      SESSION_SECRET: ['secret', 'session_secret', 'default_session']
    };

    const dangerous = dangerousDefaults[varName as keyof typeof dangerousDefaults];
    if (dangerous && dangerous.includes(value.toLowerCase())) {
      return {
        isValid: false,
        error: `Environment variable ${varName} is using a default/insecure value in production`
      };
    }
  }

  // Specific validation rules
  switch (varName) {
    case 'NODE_ENV':
      if (!['development', 'production', 'test'].includes(value)) {
        return {
          isValid: false,
          error: `NODE_ENV must be 'development', 'production', or 'test', got '${value}'`
        };
      }
      break;

    case 'PORT':
      const port = parseInt(value);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return {
          isValid: false,
          error: `PORT must be a number between 1024 and 65535, got '${value}'`
        };
      }
      break;

    case 'JWT_SECRET':
      if (value.length < 32) {
        return {
          isValid: false,
          error: `JWT_SECRET must be at least 32 characters long for security`
        };
      }
      break;

    case 'BCRYPT_ROUNDS':
      const rounds = parseInt(value);
      if (isNaN(rounds) || rounds < 10 || rounds > 15) {
        return {
          isValid: false,
          error: `BCRYPT_ROUNDS must be between 10 and 15, got '${value}'`
        };
      }
      break;

    case 'LOG_LEVEL':
      if (!['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].includes(value)) {
        return {
          isValid: false,
          error: `LOG_LEVEL must be a valid Winston log level, got '${value}'`
        };
      }
      break;
  }

  return { isValid: true };
};

/**
 * Validates all environment variables
 */
export const validateEnvironment = (): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  for (const varName of REQUIRED_ENV_VARS) {
    const result = validateEnvVar(varName, process.env[varName], true);
    if (!result.isValid && result.error) {
      errors.push(result.error);
    }
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  // Check recommended variables
  for (const varName of RECOMMENDED_ENV_VARS) {
    const result = validateEnvVar(varName, process.env[varName], false);
    if (!result.isValid && result.error) {
      errors.push(result.error);
    }
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

/**
 * Validates environment and exits if critical errors are found
 */
export const validateAndExit = (): void => {
  const result = validateEnvironment();

  // Log warnings
  result.warnings.forEach(warning => {
    logger.warn(`Environment Warning: ${warning}`);
  });

  // Log errors and exit if any
  if (!result.isValid) {
    logger.error('Environment Validation Failed:');
    result.errors.forEach(error => {
      logger.error(`  - ${error}`);
    });
    
    logger.error('Application cannot start with invalid environment configuration');
    process.exit(1);
  }

  logger.info('Environment validation passed', {
    nodeEnv: process.env.NODE_ENV,
    warningsCount: result.warnings.length
  });
};

/**
 * Get environment configuration summary for monitoring
 */
export const getEnvironmentSummary = () => {
  return {
    nodeEnv: process.env.NODE_ENV,
    hasJwtSecret: !!process.env.JWT_SECRET,
    hasDbConfig: !!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME),
    port: process.env.PORT,
    logLevel: process.env.LOG_LEVEL || 'info',
    corsOrigin: process.env.CORS_ORIGIN || 'not-set',
    timestamp: new Date().toISOString()
  };
};

export default {
  validateEnvironment,
  validateAndExit,
  getEnvironmentSummary
}; 