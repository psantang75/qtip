/**
 * Response cache for the Collections cycle reports.
 *
 * These reports read the Insights warehouse, which only changes when the ingestion
 * pipeline runs. Between runs the same question has exactly one answer, so serving
 * a remembered one is not a staleness trade-off — it is the same answer, returned
 * without rebuilding nine aggregates to get it.
 *
 * KEYED ON THE RESOLVED SCOPE, NOT THE REQUEST. The key is built from the scope's
 * own `whereSql` and bind params rather than from the caller's filter object. That
 * is deliberate and load-bearing: if `cycleScope` ever starts narrowing by viewer
 * (it does not today — these reports are campaign/date/currency scoped and ignore
 * users and departments entirely), its params change, so the key changes with it
 * and one viewer's rows cannot be served to another. Keying off the request would
 * have to be remembered and updated by hand, and forgetting would be a data leak
 * rather than a stale number.
 *
 * KEYED ON `lastRunAt`, so a new pipeline run misses naturally and no invalidation
 * hook is needed. The TTL is only a memory bound, not the freshness mechanism.
 *
 * NOT A PERMISSION BOUNDARY. Callers are the service functions, which run after
 * the controller's `collections_*` page-access gate, so a cache hit cannot bypass
 * it — the request never reaches here without passing the gate first.
 */
import MemoryTTLCache from '../../../MemoryTTLCache';
import type { CycleScope } from './scope';

const cache = new MemoryTTLCache({
  name: 'CollectionsCycle',
  defaultTTLMs: 10 * 60 * 1000,
  // Bounded so a user paging through a long invoice list cannot grow the process
  // without limit; the oldest entry is evicted past this.
  maxEntries: 200,
  cleanupIntervalMs: 5 * 60 * 1000,
});

/**
 * Freshness is asked for by all three cycle endpoints on every request, and it is
 * two queries of its own. Short TTL rather than run-keyed, because it is the thing
 * that reports the run — it has to be able to notice a new one.
 */
const FRESHNESS_TTL_MS = 15 * 1000;
const FRESHNESS_KEY = 'freshness';

export function cachedFreshness<T>(load: () => Promise<T>): Promise<T> {
  const hit = cache.get<Promise<T>>(FRESHNESS_KEY);
  if (hit) return hit;
  // The in-flight promise is cached, not just the result, so the burst of parallel
  // requests a page makes on first paint collapses onto one query.
  const pending = load().catch((err) => {
    cache.delete(FRESHNESS_KEY);
    throw err;
  });
  cache.set(FRESHNESS_KEY, pending, FRESHNESS_TTL_MS);
  return pending;
}

/**
 * Serve `load()` from cache when the warehouse has not moved since it last ran.
 *
 * Skipped entirely while the pipeline is mid-run: the page polls every 10s in that
 * state expecting to watch the numbers settle, and a cache would freeze them.
 */
export function cachedCycleRead<T>(
  pageKey: string,
  scope: CycleScope,
  variant: Record<string, unknown>,
  freshness: { lastRunAt?: string | Date | null; loading: boolean },
  load: () => Promise<T>,
): Promise<T> {
  if (freshness.loading) return load();

  const key = JSON.stringify([
    pageKey,
    scope.whereSql,
    scope.params,
    variant,
    freshness.lastRunAt instanceof Date
      ? freshness.lastRunAt.toISOString()
      : freshness.lastRunAt ?? null,
  ]);

  const hit = cache.get<Promise<T>>(key);
  if (hit) return hit;

  const pending = load().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, pending);
  return pending;
}

/** Test seam — the cache is process-wide and would otherwise leak between cases. */
export function clearCycleCache(): void {
  cache.clear();
}
