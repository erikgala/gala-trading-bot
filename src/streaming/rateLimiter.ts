export class RateLimiter {
  private isRateLimited: boolean = false;
  private rateLimitUntil: number = 0;
  private readonly cooldownMs: number;

  constructor(cooldownMs: number = 30000) { // 30 seconds default
    this.cooldownMs = cooldownMs;
  }

  /**
   * Check if we're currently rate limited
   */
  isCurrentlyRateLimited(): boolean {
    if (this.isRateLimited && Date.now() >= this.rateLimitUntil) {
      this.isRateLimited = false;
      this.rateLimitUntil = 0;
    }
    return this.isRateLimited;
  }

  /**
   * Trigger rate limiting - pause for the cooldown period
   */
  triggerRateLimit(): void {
    this.isRateLimited = true;
    this.rateLimitUntil = Date.now() + this.cooldownMs;
    console.log(`🚫 Rate limit triggered - pausing for ${this.cooldownMs / 1000} seconds`);
  }

  /**
   * Get time remaining until rate limit expires (in milliseconds)
   */
  getTimeRemaining(): number {
    if (!this.isRateLimited) return 0;
    return Math.max(0, this.rateLimitUntil - Date.now());
  }

  /**
   * Get time remaining in a human-readable format
   */
  getTimeRemainingFormatted(): string {
    const remaining = this.getTimeRemaining();
    if (remaining === 0) return '0s';
    
    const seconds = Math.ceil(remaining / 1000);
    return `${seconds}s`;
  }

  /**
   * Reset the rate limiter (for testing or manual reset)
   */
  reset(): void {
    this.isRateLimited = false;
    this.rateLimitUntil = 0;
  }

  /**
   * Get status information
   */
  getStatus(): {
    isRateLimited: boolean;
    timeRemaining: number;
    timeRemainingFormatted: string;
  } {
    return {
      isRateLimited: this.isCurrentlyRateLimited(),
      timeRemaining: this.getTimeRemaining(),
      timeRemainingFormatted: this.getTimeRemainingFormatted(),
    };
  }
}
