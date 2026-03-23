/**
 * QA Cache Service
 * Simple in-memory cache for QA dashboard statistics to improve performance
 */

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class QACacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get cached data if it exists and is not expired
   */
  get(key: string): any | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Set cache data with optional TTL
   */
  set(key: string, data: any, ttl?: number): void {
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    };
    
    this.cache.set(key, entry);
  }

  /**
   * Clear specific cache entry
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache key for QA dashboard stats
   */
  getStatsKey(qaUserId: number): string {
    return `qa_stats_${qaUserId}`;
  }

  /**
   * Get cache key for QA CSR activity
   */
  getCSRActivityKey(qaUserId: number): string {
    return `qa_csr_activity_${qaUserId}`;
  }

  /**
   * Clear QA user specific cache
   */
  clearQAUserCache(qaUserId: number): void {
    this.delete(this.getStatsKey(qaUserId));
    this.delete(this.getCSRActivityKey(qaUserId));
  }

  /**
   * Get cache size and cleanup expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Create singleton instance
export const qaCacheService = new QACacheService();

// Schedule cleanup every 10 minutes
setInterval(() => {
  qaCacheService.cleanup();
}, 10 * 60 * 1000);

export default qaCacheService; 