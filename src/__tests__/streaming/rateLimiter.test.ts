import { RateLimiter } from '../../streaming/rateLimiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter(1000); // 1 second for testing
  });

  test('should not be rate limited initially', () => {
    expect(rateLimiter.isCurrentlyRateLimited()).toBe(false);
  });

  test('should be rate limited after triggering', () => {
    rateLimiter.triggerRateLimit();
    expect(rateLimiter.isCurrentlyRateLimited()).toBe(true);
  });

  test('should return correct time remaining', () => {
    rateLimiter.triggerRateLimit();
    const timeRemaining = rateLimiter.getTimeRemaining();
    expect(timeRemaining).toBeGreaterThan(0);
    expect(timeRemaining).toBeLessThanOrEqual(1000);
  });

  test('should format time remaining correctly', () => {
    rateLimiter.triggerRateLimit();
    const formatted = rateLimiter.getTimeRemainingFormatted();
    expect(formatted).toMatch(/^\d+s$/);
  });

  test('should reset correctly', () => {
    rateLimiter.triggerRateLimit();
    expect(rateLimiter.isCurrentlyRateLimited()).toBe(true);
    
    rateLimiter.reset();
    expect(rateLimiter.isCurrentlyRateLimited()).toBe(false);
  });

  test('should return correct status', () => {
    const status = rateLimiter.getStatus();
    expect(status).toHaveProperty('isRateLimited');
    expect(status).toHaveProperty('timeRemaining');
    expect(status).toHaveProperty('timeRemainingFormatted');
    expect(typeof status.isRateLimited).toBe('boolean');
    expect(typeof status.timeRemaining).toBe('number');
    expect(typeof status.timeRemainingFormatted).toBe('string');
  });

  test('should automatically expire after cooldown period', async () => {
    rateLimiter.triggerRateLimit();
    expect(rateLimiter.isCurrentlyRateLimited()).toBe(true);
    
    // Wait for the cooldown period to expire
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    expect(rateLimiter.isCurrentlyRateLimited()).toBe(false);
  });
});
