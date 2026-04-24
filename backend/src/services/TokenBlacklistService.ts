/**
 * Token Blacklist Service
 *
 * Tracks JWTs that have been invalidated (typically by logout) so that
 * `middleware/auth.ts` can reject them before their natural `exp`.
 *
 * ## Why this isn't just an in-memory Set
 *
 * Pre-production review item #43 flagged the previous implementation as
 * broken in two ways:
 *
 *   1. **Cluster mode:** PM2 (and any multi-worker deployment) gives every
 *      worker its own process memory. A token blacklisted on worker A was
 *      still accepted by worker B.
 *   2. **Restarts:** the Set lived only in process memory, so a redeploy or
 *      crash-recover wiped every blacklist entry — tokens that were
 *      explicitly logged out became valid again until their natural exp.
 *
 * The fix below keeps the in-memory hot path (synchronous lookups during
 * request handling) but persists every entry to a JSONL file shared across
 * all workers on the host. Workers reload the file periodically so a
 * blacklist on worker A propagates to worker B within `RELOAD_INTERVAL_MS`.
 *
 * The store is intentionally local-disk, not Redis / DB:
 *   - We're forbidden from adding tables (per repo rules).
 *   - The system runs as a single host today (PM2 cluster, not multi-host).
 *   - Adding Redis just for this would add an operational dependency for
 *     ~hundreds of bytes per logout. JSONL on disk solves both failure
 *     modes the review identified without that cost.
 *
 * If/when we move to multi-host, swap the I/O layer below for a Redis client
 * — the public surface (`blacklistToken` / `isTokenBlacklisted`) doesn't
 * need to change.
 */

import * as fs from 'fs';
import * as path from 'path';

/** How often each worker re-reads the file to pick up sibling workers' writes. */
const RELOAD_INTERVAL_MS = 30_000;
/** How often we rewrite the file with expired entries pruned. */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

interface BlacklistEntry {
  token: string;
  /** Unix epoch seconds — matches JWT `exp` so `expirationTime` from logout flows in unchanged. */
  exp: number;
}

const STORE_PATH = (() => {
  const fromEnv = process.env.TOKEN_BLACKLIST_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), 'data', 'token-blacklist.jsonl');
})();

export class TokenBlacklistService {
  private blacklistedTokens: Set<string> = new Set();
  private tokenExpirations: Map<string, number> = new Map();
  private readonly storePath: string;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private reloadInterval: NodeJS.Timeout | null = null;

  constructor(storePath: string = STORE_PATH) {
    this.storePath = storePath;

    // In test runs we don't want background timers / disk I/O at all.
    const isTest = process.env.NODE_ENV === 'test';

    if (!isTest) {
      try {
        fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      } catch (err) {
        console.error('[TOKEN_BLACKLIST] Failed to create store directory:', err);
      }
      this.loadFromDisk();

      this.reloadInterval = setInterval(() => this.loadFromDisk(), RELOAD_INTERVAL_MS);
      this.cleanupInterval = setInterval(() => this.cleanupExpiredTokens(), CLEANUP_INTERVAL_MS);
    }
  }

  /**
   * Add a token to the blacklist.
   *
   * `expirationTime` is Unix epoch seconds (matches the JWT `exp` claim so
   * the call site in `AuthenticationService.logout` can pass `decoded.exp`
   * unchanged). When omitted, the entry stays in memory until cleanup
   * sweeps it (we still persist it so cluster siblings see it).
   */
  blacklistToken(token: string, expirationTime?: number): void {
    if (!token) return;
    this.blacklistedTokens.add(token);
    if (expirationTime) {
      this.tokenExpirations.set(token, expirationTime);
    }
    this.appendToDisk({ token, exp: expirationTime ?? 0 });
    console.log(`[TOKEN_BLACKLIST] Token blacklisted. Total in-memory: ${this.blacklistedTokens.size}`);
  }

  /** Synchronous hot-path check used by every authenticated request. */
  isTokenBlacklisted(token: string): boolean {
    return this.blacklistedTokens.has(token);
  }

  /** Diagnostic counters — currently surfaced through ops endpoints. */
  getStats(): { totalBlacklisted: number; expiredTokens: number; storePath: string } {
    const now = Date.now() / 1000;
    let expiredCount = 0;
    for (const exp of this.tokenExpirations.values()) {
      if (exp && exp < now) expiredCount++;
    }
    return {
      totalBlacklisted: this.blacklistedTokens.size,
      expiredTokens: expiredCount,
      storePath: this.storePath,
    };
  }

  /** For tests only — also clears the on-disk store. */
  clearAll(): void {
    this.blacklistedTokens.clear();
    this.tokenExpirations.clear();
    try {
      if (fs.existsSync(this.storePath)) fs.unlinkSync(this.storePath);
    } catch {
      // best-effort
    }
    console.log('[TOKEN_BLACKLIST] All tokens cleared from blacklist');
  }

  /** Stop background timers — used by graceful-shutdown paths and tests. */
  destroy(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.reloadInterval) clearInterval(this.reloadInterval);
    this.cleanupInterval = null;
    this.reloadInterval = null;
  }

  /**
   * Append-only persistence. We accept an extra newline on crash because the
   * reader skips blank lines; this keeps the write a single syscall and
   * cheaper than a rewrite-on-every-logout pattern.
   */
  private appendToDisk(entry: BlacklistEntry): void {
    try {
      fs.appendFileSync(this.storePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error('[TOKEN_BLACKLIST] Failed to persist blacklist entry:', err);
    }
  }

  /** Re-read the file and merge into the in-memory set. Cluster-shared by design. */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const now = Date.now() / 1000;
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as BlacklistEntry;
          if (!entry.token) continue;
          if (entry.exp && entry.exp < now) continue;
          this.blacklistedTokens.add(entry.token);
          if (entry.exp) this.tokenExpirations.set(entry.token, entry.exp);
        } catch {
          // skip malformed lines — never let a bad entry brick auth
        }
      }
    } catch (err) {
      console.error('[TOKEN_BLACKLIST] Failed to load blacklist from disk:', err);
    }
  }

  /**
   * Drop expired entries from memory and rewrite the file with only the
   * still-live ones. Atomic via tmp file + rename so a crash mid-cleanup
   * can't lose entries that other workers still need.
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now() / 1000;
    let cleaned = 0;
    for (const [token, exp] of this.tokenExpirations.entries()) {
      if (exp && exp < now) {
        this.blacklistedTokens.delete(token);
        this.tokenExpirations.delete(token);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.rewriteStore();
      console.log(`[TOKEN_BLACKLIST] Cleaned up ${cleaned} expired tokens. Remaining: ${this.blacklistedTokens.size}`);
    }
  }

  private rewriteStore(): void {
    try {
      const tmp = this.storePath + '.tmp';
      const lines: string[] = [];
      for (const token of this.blacklistedTokens) {
        const exp = this.tokenExpirations.get(token) ?? 0;
        lines.push(JSON.stringify({ token, exp } satisfies BlacklistEntry));
      }
      fs.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '', 'utf8');
      fs.renameSync(tmp, this.storePath);
    } catch (err) {
      console.error('[TOKEN_BLACKLIST] Failed to rewrite blacklist store:', err);
    }
  }
}

// Singleton instance — wired into middleware/auth.ts and AuthenticationService.
export const tokenBlacklistService = new TokenBlacklistService();
