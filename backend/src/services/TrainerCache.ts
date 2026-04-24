import { MemoryTTLCache } from './MemoryTTLCache';

/**
 * TrainerCache — domain wrapper around the shared `MemoryTTLCache` for
 * trainer dashboard data (stats, CSR activity, training stats, paginated
 * coaching session lists). Storage primitive is shared with
 * `EnhancedCacheService` and `QACacheService`.
 */

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

export class TrainerCache {
  private static instance: TrainerCache;
  private readonly store = new MemoryTTLCache({
    name: 'TrainerCache',
    defaultTTLMs: 5 * 60 * 1000,
    maxEntries: 1000,
    cleanupIntervalMs: 10 * 60 * 1000,
  });

  static getInstance(): TrainerCache {
    if (!TrainerCache.instance) {
      TrainerCache.instance = new TrainerCache();
    }
    return TrainerCache.instance;
  }

  /** Get cached data. Returns null when missing or expired. */
  get<T>(key: string): T | null {
    const value = this.store.get<T>(key);
    return value === undefined ? null : value;
  }

  /** Set cached data. TTL is in milliseconds. */
  set<T>(key: string, data: T, ttlMs?: number): void {
    this.store.set(key, data, ttlMs);
  }

  /** Delete cached data. Returns true if a value was removed. */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Clear all entries. */
  clear(): void {
    this.store.clear();
  }

  getStats(): CacheStats {
    const s = this.store.getStats();
    return {
      hits: s.hits,
      misses: s.misses,
      size: s.size,
      hitRate: s.hitRate,
    };
  }

  /** Dashboard stats cache key. */
  getDashboardStatsKey(trainerId: number): string {
    return `dashboard_stats_${trainerId}`;
  }

  /** CSR activity cache key. */
  getCSRActivityKey(trainerId: number): string {
    return `csr_activity_${trainerId}`;
  }

  /** Training stats cache key. */
  getTrainingStatsKey(trainerId: number): string {
    return `training_stats_${trainerId}`;
  }

  /** Coaching sessions cache key. */
  getCoachingSessionsKey(trainerId: number, page: number = 1, filters: string = ''): string {
    const filterHash = filters ? Buffer.from(filters).toString('base64').substring(0, 8) : 'none';
    return `coaching_sessions_${trainerId}_${page}_${filterHash}`;
  }

  /** Invalidate every entry whose key contains `_${trainerId}` (matches all key shapes above). */
  invalidateTrainerCache(trainerId: number): void {
    const tag = `_${trainerId}`;
    for (const key of this.store.keys()) {
      if (key.includes(tag)) this.store.delete(key);
    }
  }

  /** Drop expired entries (also runs automatically via the shared cleanup timer). */
  cleanup(): void {
    this.store.cleanup();
  }
}

export const trainerCache = TrainerCache.getInstance();
