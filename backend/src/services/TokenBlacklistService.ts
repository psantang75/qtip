/**
 * Token Blacklist Service
 * Manages invalidated tokens to prevent their reuse after logout
 * In production, this should use Redis or a database for persistence across server restarts
 */
export class TokenBlacklistService {
  private blacklistedTokens: Set<string> = new Set();
  private tokenExpirations: Map<string, number> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired tokens every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 60 * 60 * 1000); // 1 hour
  }

  /**
   * Add a token to the blacklist
   */
  blacklistToken(token: string, expirationTime?: number): void {
    this.blacklistedTokens.add(token);
    
    if (expirationTime) {
      this.tokenExpirations.set(token, expirationTime);
    }
    
    console.log(`[TOKEN_BLACKLIST] Token blacklisted. Total blacklisted: ${this.blacklistedTokens.size}`);
  }

  /**
   * Check if a token is blacklisted
   */
  isTokenBlacklisted(token: string): boolean {
    return this.blacklistedTokens.has(token);
  }

  /**
   * Remove expired tokens from blacklist
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now() / 1000; // Current time in seconds
    let cleanedCount = 0;

    for (const [token, expiration] of this.tokenExpirations.entries()) {
      if (expiration < now) {
        this.blacklistedTokens.delete(token);
        this.tokenExpirations.delete(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[TOKEN_BLACKLIST] Cleaned up ${cleanedCount} expired tokens. Remaining: ${this.blacklistedTokens.size}`);
    }
  }

  /**
   * Get blacklist statistics
   */
  getStats(): { totalBlacklisted: number; expiredTokens: number } {
    const now = Date.now() / 1000;
    let expiredCount = 0;

    for (const expiration of this.tokenExpirations.values()) {
      if (expiration < now) {
        expiredCount++;
      }
    }

    return {
      totalBlacklisted: this.blacklistedTokens.size,
      expiredTokens: expiredCount
    };
  }

  /**
   * Clear all blacklisted tokens (for testing purposes)
   */
  clearAll(): void {
    this.blacklistedTokens.clear();
    this.tokenExpirations.clear();
    console.log('[TOKEN_BLACKLIST] All tokens cleared from blacklist');
  }

  /**
   * Cleanup on service shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Singleton instance
export const tokenBlacklistService = new TokenBlacklistService(); 