import logger from '../config/logger';

/**
 * MemoryTTLCache — the in-memory TTL store used by every domain cache in the
 * backend (CSR, QA, Trainer). Centralized here so the storage primitive is
 * defined once and the four-cache landscape called out in the pre-production
 * review (item #22) shares one implementation.
 *
 * Boundary (intentional):
 *   - This module owns the in-memory storage primitive (Map + TTL + optional
 *     LRU-style eviction + hit/miss stats + periodic cleanup).
 *   - Domain-specific services compose on top of it and add their own
 *     namespacing + helpers (e.g. `getCSRDashboardStats`, `getStatsKey`).
 *     Those wrappers stay separate so each domain can clear its own bucket
 *     without touching others.
 *   - HTTP-response caching (`middleware/qcCache.ts`) is a different layer
 *     and does not use this primitive — it caches whole JSON responses keyed
 *     by user + URL, while this module caches arbitrary computed values keyed
 *     by string. They cannot share an implementation cleanly.
 *
 * TTL units: milliseconds. Pass `0` or `undefined` to use the configured
 * `defaultTTLMs`.
 */
export interface MemoryTTLCacheOptions {
  /** Default TTL for entries that don't specify one, in milliseconds. */
  defaultTTLMs?: number;
  /** Optional cap on entry count. When exceeded, the oldest entry is evicted. */
  maxEntries?: number;
  /** When > 0, run an internal cleanup interval that drops expired entries. */
  cleanupIntervalMs?: number;
  /** Tag used in log lines so multiple caches can be told apart. */
  name?: string;
}

interface CacheEntry<T> {
  data: T;
  /** Absolute expiry timestamp (Date.now() + ttl). */
  expiresAt: number;
}

export interface MemoryTTLCacheStats {
  hits: number;
  misses: number;
  totalRequests: number;
  hitRate: number;
  size: number;
}

export class MemoryTTLCache {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private readonly defaultTTLMs: number;
  private readonly maxEntries: number | undefined;
  private readonly name: string;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: MemoryTTLCacheOptions = {}) {
    this.defaultTTLMs = options.defaultTTLMs ?? 5 * 60 * 1000;
    this.maxEntries = options.maxEntries;
    this.name = options.name ?? 'MemoryTTLCache';

    const intervalMs = options.cleanupIntervalMs;
    if (intervalMs && intervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
      // Allow the process to exit even if a long-running cleanup timer is
      // still scheduled (Node treats interval timers as "ref'd" by default).
      if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref();
    }
  }

  /** Resolve and return the entry if present and not expired; otherwise undefined. */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.data;
  }

  /** Store `value` under `key`. Returns true on success. */
  set<T>(key: string, value: T, ttlMs?: number): boolean {
    try {
      if (this.maxEntries && this.cache.size >= this.maxEntries && !this.cache.has(key)) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) this.cache.delete(oldestKey);
      }
      const ttl = ttlMs && ttlMs > 0 ? ttlMs : this.defaultTTLMs;
      this.cache.set(key, { data: value as unknown, expiresAt: Date.now() + ttl });
      return true;
    } catch (error) {
      logger.error(`${this.name}: set failed`, { key, error: (error as Error).message });
      return false;
    }
  }

  /** Delete a single key. Returns true if a value was removed. */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /** Iterate the live key set (snapshot). Useful for prefix-scoped invalidation. */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /** Drop every key whose name starts with `prefix`. */
  deleteByPrefix(prefix: string): number {
    let deleted = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /** Drop every key. Stats are reset to zero. */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Drop every entry whose expiry is in the past. */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }

  getStats(): MemoryTTLCacheStats {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? Math.round((this.hits / totalRequests) * 10000) / 100 : 0;
    return {
      hits: this.hits,
      misses: this.misses,
      totalRequests,
      hitRate,
      size: this.cache.size,
    };
  }

  /** Clear the periodic-cleanup timer. Call at process shutdown if needed. */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

export default MemoryTTLCache;
