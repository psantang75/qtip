import logger from '../config/logger';
import { CSRDashboardStats, CSRActivityData } from '../repositories/CSRRepository';

// Simple in-memory cache implementation
interface CacheItem<T> {
  data: T;
  expiry: number;
}

// Cache TTL by data type (in seconds)
const CACHE_TTL = {
  CSR_DASHBOARD_STATS: 300, // 5 minutes
  CSR_ACTIVITY: 180, // 3 minutes
  CSR_AUDITS: 120, // 2 minutes
  CSR_QA_STATS: 600, // 10 minutes
  CSR_TRAINING_STATS: 300, // 5 minutes
  FORM_METADATA: 1800, // 30 minutes
  DEPARTMENT_LIST: 3600 // 1 hour
};

class EnhancedCacheService {
  private cache: Map<string, CacheItem<any>> = new Map();
  private hitCount: number = 0;
  private missCount: number = 0;
  private totalRequests: number = 0;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired items every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiry) {
        this.cache.delete(key);
        logger.debug('Cache EXPIRED', { key });
      }
    }
  }

    // Generic cache methods
  set<T>(key: string, value: T, ttl: number = 300): boolean {
    try {
      const expiry = Date.now() + (ttl * 1000);
      this.cache.set(key, { data: value, expiry });
      logger.debug('Cache set successful', { key, ttl });
      return true;
    } catch (error: any) {
      logger.error('Cache set failed', { key, error: error.message });
      return false;
    }
  }

  get<T>(key: string): T | undefined {
    this.totalRequests++;
    try {
      const item = this.cache.get(key);
      if (item && Date.now() <= item.expiry) {
        this.hitCount++;
        logger.debug('Cache HIT', { key });
        return item.data as T;
      } else {
        if (item && Date.now() > item.expiry) {
          this.cache.delete(key);
        }
        this.missCount++;
        logger.debug('Cache MISS', { key });
        return undefined;
      }
    } catch (error: any) {
      this.missCount++;
      logger.error('Cache get failed', { key, error: error.message });
      return undefined;
    }
  }

  del(key: string): number {
    try {
      const deleted = this.cache.delete(key);
      return deleted ? 1 : 0;
    } catch (error: any) {
      logger.error('Cache delete failed', { key, error: error.message });
      return 0;
    }
  }

  // CSR-specific cache methods
  getCSRDashboardStats(csr_id: number): CSRDashboardStats | undefined {
    return this.get<CSRDashboardStats>(`csr:dashboard:${csr_id}`);
  }

  setCSRDashboardStats(csr_id: number, stats: CSRDashboardStats): boolean {
    return this.set(`csr:dashboard:${csr_id}`, stats, CACHE_TTL.CSR_DASHBOARD_STATS);
  }

  getCSRActivity(csr_id: number): CSRActivityData[] | undefined {
    return this.get<CSRActivityData[]>(`csr:activity:${csr_id}`);
  }

  setCSRActivity(csr_id: number, activity: CSRActivityData[]): boolean {
    return this.set(`csr:activity:${csr_id}`, activity, CACHE_TTL.CSR_ACTIVITY);
  }

  getCSRAudits(csr_id: number, page: number, limit: number, filtersHash: string): any {
    const key = `csr:audits:${csr_id}:${page}:${limit}:${filtersHash}`;
    return this.get(key);
  }

  setCSRAudits(csr_id: number, page: number, limit: number, filtersHash: string, data: any): boolean {
    const key = `csr:audits:${csr_id}:${page}:${limit}:${filtersHash}`;
    return this.set(key, data, CACHE_TTL.CSR_AUDITS);
  }

  getCSRQAStats(csr_id: number): any {
    return this.get(`csr:qa_stats:${csr_id}`);
  }

  setCSRQAStats(csr_id: number, stats: any): boolean {
    return this.set(`csr:qa_stats:${csr_id}`, stats, CACHE_TTL.CSR_QA_STATS);
  }

  getCSRTrainingStats(csr_id: number): any {
    return this.get(`csr:training_stats:${csr_id}`);
  }

  setCSRTrainingStats(csr_id: number, stats: any): boolean {
    return this.set(`csr:training_stats:${csr_id}`, stats, CACHE_TTL.CSR_TRAINING_STATS);
  }

  // Cache invalidation methods
  invalidateCSRCache(csr_id: number): void {
    const patterns = [
      `csr:dashboard:${csr_id}`,
      `csr:activity:${csr_id}`,
      `csr:qa_stats:${csr_id}`,
      `csr:training_stats:${csr_id}`
    ];
    
    patterns.forEach(pattern => {
      this.del(pattern);
    });

         // Invalidate audit cache for this CSR
     const keys = Array.from(this.cache.keys());
     keys.forEach((key: string) => {
       if (key.startsWith(`csr:audits:${csr_id}:`)) {
         this.del(key);
       }
     });

    logger.info('CSR cache invalidated', { csr_id });
  }

     invalidateAllCSRCaches(): void {
     const keys = Array.from(this.cache.keys());
     keys.forEach((key: string) => {
       if (key.startsWith('csr:')) {
         this.del(key);
       }
     });
     logger.info('All CSR caches invalidated');
   }

  // Utility methods
  generateFiltersHash(filters: Record<string, any>): string {
    const sortedFilters = Object.keys(filters)
      .sort()
      .reduce((result, key) => {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
          result[key] = filters[key];
        }
        return result;
      }, {} as Record<string, any>);
    
    return Buffer.from(JSON.stringify(sortedFilters)).toString('base64');
  }

     // Performance monitoring
   getStats() {
     const hitRate = this.totalRequests > 0 ? (this.hitCount / this.totalRequests) * 100 : 0;
     
     return {
       hits: this.hitCount,
       misses: this.missCount,
       hitRate: Math.round(hitRate * 100) / 100,
       keys: this.cache.size,
       totalRequests: this.totalRequests
     };
   }

  // Cache warming
  async warmCSRCache(csr_id: number, warmingData: {
    dashboardStats?: CSRDashboardStats;
    activity?: CSRActivityData[];
    qaStats?: any;
    trainingStats?: any;
  }): Promise<void> {
    const promises = [];

    if (warmingData.dashboardStats) {
      promises.push(this.setCSRDashboardStats(csr_id, warmingData.dashboardStats));
    }

    if (warmingData.activity) {
      promises.push(this.setCSRActivity(csr_id, warmingData.activity));
    }

    if (warmingData.qaStats) {
      promises.push(this.setCSRQAStats(csr_id, warmingData.qaStats));
    }

    if (warmingData.trainingStats) {
      promises.push(this.setCSRTrainingStats(csr_id, warmingData.trainingStats));
    }

    await Promise.all(promises);
    logger.info('CSR cache warmed', { csr_id, dataTypes: Object.keys(warmingData) });
  }

  // Health check
  isHealthy(): boolean {
    try {
      const testKey = 'health-check';
      const testValue = Date.now();
      this.set(testKey, testValue, 1);
      const retrieved = this.get(testKey);
      this.del(testKey);
      return retrieved === testValue;
         } catch (error: any) {
       logger.error('Cache health check failed', { error: error.message });
       return false;
     }
  }

     // Memory management
   flushAll(): void {
     this.cache.clear();
     this.hitCount = 0;
     this.missCount = 0;
     this.totalRequests = 0;
     logger.info('Cache flushed');
   }

   close(): void {
     if (this.cleanupInterval) {
       clearInterval(this.cleanupInterval);
     }
   }
}

// Singleton instance
const cacheService = new EnhancedCacheService();

export default cacheService; 