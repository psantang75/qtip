/**
 * QA-specific configuration for different environments
 */

import { config, isDevelopment, isProduction } from './environment';

interface QAConfig {
  pagination: {
    defaultLimit: number;
    maxLimit: number;
  };
  cache: {
    enabled: boolean;
    ttl: number; // Time to live in milliseconds
  };
  rateLimiting: {
    dashboard: {
      windowMs: number;
      maxRequests: number;
    };
    data: {
      windowMs: number;
      maxRequests: number;
    };
    sensitive: {
      windowMs: number;
      maxRequests: number;
    };
  };
  performance: {
    queryTimeout: number;
    enableSlowQueryLogging: boolean;
    slowQueryThreshold: number;
  };
  features: {
    enableAdvancedFiltering: boolean;
    enableBulkOperations: boolean;
    enableExportLimits: boolean;
  };
  monitoring: {
    enableMetrics: boolean;
    enableHealthChecks: boolean;
    enablePerformanceTracking: boolean;
  };
}

const developmentConfig: QAConfig = {
  pagination: {
    defaultLimit: 20,
    maxLimit: 5000
  },
  cache: {
    enabled: false, // Disable caching in development for real-time data
    ttl: 2 * 60 * 1000 // 2 minutes
  },
  rateLimiting: {
    dashboard: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 1000 // Very lenient for development
    },
    data: {
      windowMs: 15 * 60 * 1000,
      maxRequests: 500
    },
    sensitive: {
      windowMs: 5 * 60 * 1000,
      maxRequests: 100
    }
  },
  performance: {
    queryTimeout: 30000, // 30 seconds
    enableSlowQueryLogging: true,
    slowQueryThreshold: 1000 // 1 second
  },
  features: {
    enableAdvancedFiltering: true,
    enableBulkOperations: true,
    enableExportLimits: false // No limits in development
  },
  monitoring: {
    enableMetrics: true,
    enableHealthChecks: true,
    enablePerformanceTracking: true
  }
};

const productionConfig: QAConfig = {
  pagination: {
    defaultLimit: 20,
    maxLimit: 5000
  },
  cache: {
    enabled: true,
    ttl: 5 * 60 * 1000 // 5 minutes
  },
  rateLimiting: {
    dashboard: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 200 // More restrictive for production
    },
    data: {
      windowMs: 15 * 60 * 1000,
      maxRequests: 100
    },
    sensitive: {
      windowMs: 5 * 60 * 1000,
      maxRequests: 10 // Very strict for production
    }
  },
  performance: {
    queryTimeout: 15000, // 15 seconds
    enableSlowQueryLogging: true,
    slowQueryThreshold: 500 // 500ms
  },
  features: {
    enableAdvancedFiltering: true,
    enableBulkOperations: false, // Disable bulk operations in production initially
    enableExportLimits: true
  },
  monitoring: {
    enableMetrics: true,
    enableHealthChecks: true,
    enablePerformanceTracking: true
  }
};

const testConfig: QAConfig = {
  pagination: {
    defaultLimit: 10,
    maxLimit: 50
  },
  cache: {
    enabled: false, // Disable caching for consistent test results
    ttl: 1 * 60 * 1000 // 1 minute
  },
  rateLimiting: {
    dashboard: {
      windowMs: 1 * 60 * 1000, // 1 minute
      maxRequests: 100
    },
    data: {
      windowMs: 1 * 60 * 1000,
      maxRequests: 50
    },
    sensitive: {
      windowMs: 1 * 60 * 1000,
      maxRequests: 10
    }
  },
  performance: {
    queryTimeout: 5000, // 5 seconds
    enableSlowQueryLogging: false,
    slowQueryThreshold: 1000
  },
  features: {
    enableAdvancedFiltering: false, // Keep tests simple
    enableBulkOperations: false,
    enableExportLimits: true
  },
  monitoring: {
    enableMetrics: false,
    enableHealthChecks: true,
    enablePerformanceTracking: false
  }
};

/**
 * Get QA configuration based on environment
 */
function getQAConfig(): QAConfig {
  const environment = config.NODE_ENV?.toLowerCase();
  
  switch (environment) {
    case 'production':
      return productionConfig;
    case 'test':
    case 'testing':
      return testConfig;
    case 'development':
    default:
      return developmentConfig;
  }
}

export const qaConfig = getQAConfig();

/**
 * QA Feature flags
 */
export const qaFeatureFlags = {
  isCacheEnabled: (): boolean => qaConfig.cache.enabled,
  isAdvancedFilteringEnabled: (): boolean => qaConfig.features.enableAdvancedFiltering,
  isBulkOperationsEnabled: (): boolean => qaConfig.features.enableBulkOperations,
  isExportLimitsEnabled: (): boolean => qaConfig.features.enableExportLimits,
  isMetricsEnabled: (): boolean => qaConfig.monitoring.enableMetrics,
  isHealthChecksEnabled: (): boolean => qaConfig.monitoring.enableHealthChecks,
  isPerformanceTrackingEnabled: (): boolean => qaConfig.monitoring.enablePerformanceTracking
};

/**
 * Get environment-specific rate limiting configuration
 */
export const getQARateLimiting = () => qaConfig.rateLimiting;

/**
 * Get environment-specific pagination configuration
 */
export const getQAPagination = () => qaConfig.pagination;

/**
 * Get environment-specific performance configuration
 */
export const getQAPerformance = () => qaConfig.performance;

export default qaConfig; 