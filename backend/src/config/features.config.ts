/**
 * Feature flags configuration
 * Controls which features are enabled/disabled in the application
 */

export interface FeatureFlags {
  useNewAnalyticsService: boolean;
  useNewPerformanceGoalService: boolean;
  // Add more feature flags here as needed
}

// Default feature flags configuration
const DEFAULT_FEATURES: FeatureFlags = {
  useNewAnalyticsService: true, // Activated - using new analytics service
  useNewPerformanceGoalService: true, // Activated - using new performance goal service
};

// Get feature flags from environment or use defaults
const features: FeatureFlags = {
  useNewAnalyticsService: process.env.USE_NEW_ANALYTICS_SERVICE === 'true' || DEFAULT_FEATURES.useNewAnalyticsService,
  useNewPerformanceGoalService: process.env.USE_NEW_PERFORMANCE_GOAL_SERVICE === 'true' || DEFAULT_FEATURES.useNewPerformanceGoalService,
};

/**
 * Check if the new analytics service should be used
 * @returns boolean indicating if new analytics service is enabled
 */
export function useNewAnalyticsService(): boolean {
  return features.useNewAnalyticsService;
}

/**
 * Check if the new performance goal service should be used
 * @returns boolean indicating if new performance goal service is enabled
 */
export function useNewPerformanceGoalService(): boolean {
  return features.useNewPerformanceGoalService;
}

/**
 * Get all feature flags
 * @returns FeatureFlags object with all feature flags
 */
export function getFeatureFlags(): FeatureFlags {
  return { ...features };
} 