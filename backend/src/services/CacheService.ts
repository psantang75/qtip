import { CSRDashboardStats, CSRActivityData } from '../repositories/CSRRepository';
import { MemoryTTLCache } from './MemoryTTLCache';
import logger from '../config/logger';

/**
 * EnhancedCacheService — domain wrapper around the shared `MemoryTTLCache`
 * that adds CSR/analytics-specific keying (e.g. `csr:dashboard:{id}`),
 * per-bucket invalidation, and cache warming. The underlying TTL store is
 * the same primitive used by `QACacheService` so all
 * three behave consistently.
 */

const CACHE_TTL_MS = {
  CSR_DASHBOARD_STATS: 5 * 60 * 1000,
  CSR_ACTIVITY: 3 * 60 * 1000,
  CSR_AUDITS: 2 * 60 * 1000,
  CSR_QA_STATS: 10 * 60 * 1000,
  CSR_TRAINING_STATS: 5 * 60 * 1000,
} as const;

class EnhancedCacheService {
  private readonly store = new MemoryTTLCache({
    name: 'EnhancedCacheService',
    defaultTTLMs: 5 * 60 * 1000,
    cleanupIntervalMs: 60 * 1000,
  });

  /** Generic API — TTL is in **seconds** for backward compatibility with prior callers. */
  set<T>(key: string, value: T, ttlSeconds: number = 300): boolean {
    return this.store.set(key, value, ttlSeconds * 1000);
  }

  get<T>(key: string): T | undefined {
    return this.store.get<T>(key);
  }

  del(key: string): number {
    return this.store.delete(key) ? 1 : 0;
  }

  // CSR-specific cache methods
  getCSRDashboardStats(csr_id: number): CSRDashboardStats | undefined {
    return this.store.get<CSRDashboardStats>(`csr:dashboard:${csr_id}`);
  }

  setCSRDashboardStats(csr_id: number, stats: CSRDashboardStats): boolean {
    return this.store.set(`csr:dashboard:${csr_id}`, stats, CACHE_TTL_MS.CSR_DASHBOARD_STATS);
  }

  getCSRActivity(csr_id: number): CSRActivityData[] | undefined {
    return this.store.get<CSRActivityData[]>(`csr:activity:${csr_id}`);
  }

  setCSRActivity(csr_id: number, activity: CSRActivityData[]): boolean {
    return this.store.set(`csr:activity:${csr_id}`, activity, CACHE_TTL_MS.CSR_ACTIVITY);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCSRAudits(csr_id: number, page: number, limit: number, filtersHash: string): any {
    return this.store.get(`csr:audits:${csr_id}:${page}:${limit}:${filtersHash}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setCSRAudits(csr_id: number, page: number, limit: number, filtersHash: string, data: any): boolean {
    return this.store.set(`csr:audits:${csr_id}:${page}:${limit}:${filtersHash}`, data, CACHE_TTL_MS.CSR_AUDITS);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCSRQAStats(csr_id: number): any {
    return this.store.get(`csr:qa_stats:${csr_id}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setCSRQAStats(csr_id: number, stats: any): boolean {
    return this.store.set(`csr:qa_stats:${csr_id}`, stats, CACHE_TTL_MS.CSR_QA_STATS);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCSRTrainingStats(csr_id: number): any {
    return this.store.get(`csr:training_stats:${csr_id}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setCSRTrainingStats(csr_id: number, stats: any): boolean {
    return this.store.set(`csr:training_stats:${csr_id}`, stats, CACHE_TTL_MS.CSR_TRAINING_STATS);
  }

  // Cache invalidation methods
  invalidateCSRCache(csr_id: number): void {
    this.store.delete(`csr:dashboard:${csr_id}`);
    this.store.delete(`csr:activity:${csr_id}`);
    this.store.delete(`csr:qa_stats:${csr_id}`);
    this.store.delete(`csr:training_stats:${csr_id}`);
    this.store.deleteByPrefix(`csr:audits:${csr_id}:`);
    logger.info('CSR cache invalidated', { csr_id });
  }

  invalidateAllCSRCaches(): void {
    const removed = this.store.deleteByPrefix('csr:');
    logger.info('All CSR caches invalidated', { removed });
  }

  // Utility methods
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateFiltersHash(filters: Record<string, any>): string {
    const sortedFilters = Object.keys(filters)
      .sort()
      .reduce((result, key) => {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
          result[key] = filters[key];
        }
        return result;
      }, {} as Record<string, unknown>);

    return Buffer.from(JSON.stringify(sortedFilters)).toString('base64');
  }

  getStats() {
    return this.store.getStats();
  }

  // Cache warming
  async warmCSRCache(csr_id: number, warmingData: {
    dashboardStats?: CSRDashboardStats;
    activity?: CSRActivityData[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    qaStats?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trainingStats?: any;
  }): Promise<void> {
    if (warmingData.dashboardStats) this.setCSRDashboardStats(csr_id, warmingData.dashboardStats);
    if (warmingData.activity) this.setCSRActivity(csr_id, warmingData.activity);
    if (warmingData.qaStats) this.setCSRQAStats(csr_id, warmingData.qaStats);
    if (warmingData.trainingStats) this.setCSRTrainingStats(csr_id, warmingData.trainingStats);
    logger.info('CSR cache warmed', { csr_id, dataTypes: Object.keys(warmingData) });
  }

  isHealthy(): boolean {
    try {
      const testKey = '__health-check__';
      const testValue = Date.now();
      this.store.set(testKey, testValue, 1000);
      const retrieved = this.store.get<number>(testKey);
      this.store.delete(testKey);
      return retrieved === testValue;
    } catch (error) {
      logger.error('Cache health check failed', { error: (error as Error).message });
      return false;
    }
  }

  flushAll(): void {
    this.store.clear();
    logger.info('Cache flushed');
  }

  close(): void {
    this.store.close();
  }
}

const cacheService = new EnhancedCacheService();

export default cacheService;
