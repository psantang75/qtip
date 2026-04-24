import { MemoryTTLCache } from './MemoryTTLCache';

/**
 * QACacheService — domain wrapper around the shared `MemoryTTLCache` for
 * QA dashboard data (stats + per-QA CSR activity). Storage primitive is
 * shared with `EnhancedCacheService` and `TrainerCache`; the keying scheme
 * here is QA-scoped so each domain can be cleared independently.
 */

class QACacheService {
  private readonly store = new MemoryTTLCache({
    name: 'QACacheService',
    defaultTTLMs: 5 * 60 * 1000,
    cleanupIntervalMs: 10 * 60 * 1000,
  });

  /** Get cached data if it exists and is not expired. */
  get(key: string): unknown {
    const value = this.store.get(key);
    return value === undefined ? null : value;
  }

  /** Set cache data with optional TTL (milliseconds). */
  set(key: string, data: unknown, ttlMs?: number): void {
    this.store.set(key, data, ttlMs);
  }

  /** Clear specific cache entry. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Clear all cache entries. */
  clear(): void {
    this.store.clear();
  }

  /** Cache key for QA dashboard stats. */
  getStatsKey(qaUserId: number): string {
    return `qa_stats_${qaUserId}`;
  }

  /** Cache key for QA CSR activity. */
  getCSRActivityKey(qaUserId: number): string {
    return `qa_csr_activity_${qaUserId}`;
  }

  /** Clear QA-user-specific cache. */
  clearQAUserCache(qaUserId: number): void {
    this.delete(this.getStatsKey(qaUserId));
    this.delete(this.getCSRActivityKey(qaUserId));
  }

  /** Drop expired entries (also runs automatically via the shared cleanup timer). */
  cleanup(): void {
    this.store.cleanup();
  }

  /** Cache statistics. */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.store.getStats().size,
      keys: this.store.keys(),
    };
  }
}

export const qaCacheService = new QACacheService();
export default qaCacheService;
