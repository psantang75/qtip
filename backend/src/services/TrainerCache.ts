/**
 * TrainerCache - Simple in-memory caching service for trainer operations
 * Provides performance improvements for frequently accessed data
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

export class TrainerCache {
  private static instance: TrainerCache;
  private cache = new Map<string, CacheEntry<any>>();
  private hits = 0;
  private misses = 0;
  private readonly maxSize = 1000;
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes

  static getInstance(): TrainerCache {
    if (!TrainerCache.instance) {
      TrainerCache.instance = new TrainerCache();
    }
    return TrainerCache.instance;
  }

  /**
   * Get cached data
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if entry has expired
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data;
  }

  /**
   * Set cached data
   */
  set<T>(key: string, data: T, ttl: number = this.defaultTTL): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * Delete cached data
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: Math.round(hitRate * 100) / 100
    };
  }

  /**
   * Get dashboard stats cache key
   */
  getDashboardStatsKey(trainerId: number): string {
    return `dashboard_stats_${trainerId}`;
  }

  /**
   * Get CSR activity cache key
   */
  getCSRActivityKey(trainerId: number): string {
    return `csr_activity_${trainerId}`;
  }

  /**
   * Get training stats cache key
   */
  getTrainingStatsKey(trainerId: number): string {
    return `training_stats_${trainerId}`;
  }

  /**
   * Get coaching sessions cache key
   */
  getCoachingSessionsKey(trainerId: number, page: number = 1, filters: string = ''): string {
    const filterHash = filters ? Buffer.from(filters).toString('base64').substring(0, 8) : 'none';
    return `coaching_sessions_${trainerId}_${page}_${filterHash}`;
  }

  /**
   * Invalidate trainer-related cache entries
   */
  invalidateTrainerCache(trainerId: number): void {
    const keysToDelete: string[] = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(`_${trainerId}`)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }
}

// Export singleton instance
export const trainerCache = TrainerCache.getInstance();

// Setup periodic cleanup (every 10 minutes)
setInterval(() => {
  trainerCache.cleanup();
}, 10 * 60 * 1000); 