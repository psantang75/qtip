import { desktimeConfig } from '../../config/environment';
import logger from '../../config/logger';

/**
 * DeskTime read-only client. Mirrors `BookStackService`: a singleton with an
 * `isConfigured()` guard, a `fetch` wrapper with timeout + light retry, and
 * narrow typed methods. The API key travels as `?apiKey=` (DeskTime's scheme),
 * so it is never included in logged messages — only the path is.
 *
 * Everything reads the company-wide `employees` endpoint: `period=day` returns
 * every employee for one date, `period=month` every day of the month in one
 * call. DeskTime interprets dates in the account timezone, which is Eastern
 * (America/Detroit) — the same calendar day as the punch clock and Genesys.
 */

interface RawEmployee {
  id?: number;
  name?: string | null;
  email?: string | null;
  group?: string | null;
  /** ET wall-clock timestamp, or `false` when the employee never arrived. */
  arrived?: string | boolean | null;
  left?: string | boolean | null;
  late?: boolean | null;
  onlineTime?: number | string | null;
  desktimeTime?: number | string | null;
  atWorkTime?: number | string | null;
  productiveTime?: number | string | null;
  productivity?: number | string | null;
  efficiency?: number | string | null;
}

interface EmployeesResponse {
  /** Keyed by date, then by employee id (object or array). */
  employees?: Record<string, Record<string, RawEmployee> | RawEmployee[]>;
}

/** One employee's tracked day. Durations in seconds; times are ET wall clock. */
export interface DeskTimeDayRecord {
  date: string;
  employeeId: number;
  email: string;
  name: string | null;
  group: string | null;
  arrivedAt: string | null;
  leftAt: string | null;
  isLate: boolean;
  onlineSec: number;
  desktimeSec: number;
  atWorkSec: number;
  productiveSec: number;
  productivityPct: number | null;
  efficiencyPct: number | null;
}

/** email (lowercased) → productive seconds for the day. */
export type ProductiveSecondsByEmail = Map<string, number>;

const PAST_DAY_TTL_MS = 6 * 60 * 60 * 1000;
const CURRENT_DAY_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const secs = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const pctOrNull = (v: unknown) => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};
const stamp = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v) ? v : null);

/**
 * Flatten the `employees` payload into employee-days. Zero-activity days are
 * kept: a tracked employee with no desk time is a real 0, distinct from an
 * email DeskTime does not track at all (no record → "No data").
 */
export function flattenEmployees(body: EmployeesResponse): DeskTimeDayRecord[] {
  const out: DeskTimeDayRecord[] = [];
  for (const [date, bucket] of Object.entries(body.employees ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !bucket) continue;
    for (const e of Object.values(bucket)) {
      const email = e?.email?.trim().toLowerCase();
      if (!email || e.id == null) continue;
      const desktimeSec = secs(e.desktimeTime);
      out.push({
        date,
        employeeId: Number(e.id),
        email,
        name: e.name ?? null,
        group: e.group ?? null,
        arrivedAt: stamp(e.arrived),
        leftAt: stamp(e.left),
        isLate: e.late === true,
        onlineSec: secs(e.onlineTime),
        desktimeSec,
        atWorkSec: secs(e.atWorkTime),
        productiveSec: secs(e.productiveTime),
        productivityPct: pctOrNull(e.productivity),
        efficiencyPct: pctOrNull(e.efficiency),
      });
    }
  }
  return out;
}

/** Productive seconds by email for one date. */
export function productiveByEmail(records: DeskTimeDayRecord[], date: string): ProductiveSecondsByEmail {
  const out: ProductiveSecondsByEmail = new Map();
  for (const r of records) {
    if (r.date === date) out.set(r.email, (out.get(r.email) ?? 0) + r.productiveSec);
  }
  return out;
}

class DeskTimeService {
  private cache = new Map<string, { expiresAt: number; data: ProductiveSecondsByEmail | null }>();
  private inFlight = new Map<string, Promise<ProductiveSecondsByEmail | null>>();

  isConfigured(): boolean {
    return desktimeConfig !== null;
  }

  private async request<T>(path: string, query: Record<string, string>): Promise<T> {
    if (!desktimeConfig) throw new Error('DeskTime is not configured (set DESKTIME_API_KEY).');
    const cfg = desktimeConfig;
    const url = new URL(`${cfg.baseUrl}${path}`);
    url.searchParams.set('apiKey', cfg.apiKey);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    const maxAttempts = cfg.maxRetries + 1;
    for (let attempt = 1; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) return (await res.json()) as T;
        // Retry only transient failures; any other 4xx is a key/permission problem.
        const retryable = res.status >= 500 || res.status === 429;
        if (!retryable || attempt >= maxAttempts) throw new Error(`DeskTime ${res.status} ${res.statusText} on ${path}`);
      } catch (err) {
        clearTimeout(timer);
        const error = err instanceof Error ? err : new Error('unknown');
        const transient = error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ECONNRESET';
        if (!transient || attempt >= maxAttempts) throw error;
      }
      await sleep(Math.min(500 * 2 ** (attempt - 1), 8_000));
    }
  }

  /** Every tracked employee-day for `date` (period=day) or its month (period=month). Throws on failure. */
  async getEmployeeDays(date: string, period: 'day' | 'month'): Promise<DeskTimeDayRecord[]> {
    const body = await this.request<EmployeesResponse>('/employees', { date, period });
    return flattenEmployees(body);
  }

  /**
   * Live productive seconds per email for one day, or `null` when DeskTime is
   * unconfigured or unreachable (callers render "unavailable", never zero). The
   * roster's fallback for days the sync has not stored yet. Cached per date: a
   * closed day for hours, the current day for minutes, a failure briefly so an
   * outage does not add a timeout to every roster load.
   */
  async getProductiveSecondsByEmail(date: string): Promise<ProductiveSecondsByEmail | null> {
    if (!this.isConfigured()) return null;
    const hit = this.cache.get(date);
    if (hit && hit.expiresAt > Date.now()) return hit.data;
    const pending = this.inFlight.get(date);
    if (pending) return pending;

    const load = (async () => {
      try {
        const data = productiveByEmail(await this.getEmployeeDays(date, 'day'), date);
        const ttl = date < localToday() ? PAST_DAY_TTL_MS : CURRENT_DAY_TTL_MS;
        this.cache.set(date, { expiresAt: Date.now() + ttl, data });
        return data;
      } catch (err) {
        logger.warn(`[desktime] employees fetch failed for ${date}: ${(err as Error).message}`);
        this.cache.set(date, { expiresAt: Date.now() + FAILURE_TTL_MS, data: null });
        return null;
      } finally {
        this.inFlight.delete(date);
      }
    })();
    this.inFlight.set(date, load);
    return load;
  }

  /** Test-only: drop cached days so each case starts cold. */
  clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}

export const deskTimeService = new DeskTimeService();
export default deskTimeService;
