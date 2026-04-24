import { Request, Response, NextFunction, RequestHandler } from 'express'

/**
 * In-memory TTL cache for QC GET endpoints.
 *
 * Tradeoffs / contract:
 *  - Bounded LRU (default 1000 entries) so memory cannot grow unbounded.
 *  - User-scoped keys (`${userId}|${path}|${normalizedQuery}`) so data scopes
 *    (SELF / DEPT / ALL) cannot leak across users with different permissions.
 *  - Query-string keys are normalized by sorting parameter names before
 *    serializing — `?a=1&b=2` and `?b=2&a=1` hit the same cache entry.
 *  - TTL is 60s by default, override via `QC_CACHE_TTL_MS` env. Acceptable
 *    staleness window for analytics dashboards (per QC perf review).
 *  - Only successful (HTTP 200) JSON responses are cached. Errors and
 *    non-200 responses bypass the cache entirely.
 *  - `?nocache=1` bypasses both reads and writes (handy for diagnostics).
 *  - No mutation invalidation: callers accept up to TTL_MS staleness when
 *    new audits / coaching / write-ups are submitted. If hard freshness is
 *    required later, expose a bust hook from this module.
 */

interface CacheEntry {
  expiresAt: number
  body: unknown
}

const TTL_MS = Number.parseInt(process.env.QC_CACHE_TTL_MS || '60000', 10)
const MAX_ENTRIES = Number.parseInt(process.env.QC_CACHE_MAX_ENTRIES || '1000', 10)

const store = new Map<string, CacheEntry>()

const normalizeQuery = (query: Request['query']): string => {
  const keys = Object.keys(query).sort()
  if (keys.length === 0) return ''
  const pairs: Array<[string, unknown]> = []
  for (const k of keys) {
    const v = query[k]
    pairs.push([k, Array.isArray(v) ? [...v].sort() : v])
  }
  return JSON.stringify(pairs)
}

const buildKey = (req: Request): string => {
  const userId = req.user?.user_id ?? 'anon'
  return `${userId}|${req.baseUrl}${req.path}|${normalizeQuery(req.query)}`
}

const evictExpired = (now: number): void => {
  for (const [key, entry] of store) {
    if (entry.expiresAt > now) break
    store.delete(key)
  }
}

const touch = (key: string, entry: CacheEntry): void => {
  store.delete(key)
  store.set(key, entry)
}

export const qcCache: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method !== 'GET' || req.query.nocache === '1') {
    next()
    return
  }

  const key = buildKey(req)
  const now = Date.now()
  const cached = store.get(key)

  if (cached && cached.expiresAt > now) {
    touch(key, cached)
    res.setHeader('X-QC-Cache', 'HIT')
    res.json(cached.body)
    return
  }

  evictExpired(now)

  const originalJson = res.json.bind(res)
  res.json = (body: unknown) => {
    if (res.statusCode === 200) {
      if (store.size >= MAX_ENTRIES) {
        const oldest = store.keys().next().value
        if (oldest !== undefined) store.delete(oldest)
      }
      store.set(key, { expiresAt: Date.now() + TTL_MS, body })
    }
    res.setHeader('X-QC-Cache', 'MISS')
    return originalJson(body)
  }

  next()
}

export const qcCacheStats = () => ({
  size: store.size,
  maxEntries: MAX_ENTRIES,
  ttlMs: TTL_MS,
})

export const qcCacheClear = (): void => {
  store.clear()
}
