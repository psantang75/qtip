/**
 * Unit tests for AICalibrationService — focused on the pure-logic
 * surface (sampling decision + agreement math). DB-backed methods are
 * exercised end-to-end by the route layer; here we just guarantee the
 * primitives the calibration tab reads are correct.
 */

import { describe, it, expect } from 'vitest';
import { AICalibrationService } from '../AICalibrationService';

describe('AICalibrationService.shouldRouteToReviewInbox', () => {
  const svc = new AICalibrationService();

  it('routes when low_score_always is on and score is below the cap', () => {
    const result = svc.shouldRouteToReviewInbox({
      total_score: 70,
      critical_cap_percent: 79,
      ai_sample_review_pct: 0,
      ai_sample_low_score_always: true,
      rng: () => 1,
    });
    expect(result).toBe(true);
  });

  it('does not route a passing score when pct is 0', () => {
    const result = svc.shouldRouteToReviewInbox({
      total_score: 95,
      critical_cap_percent: 79,
      ai_sample_review_pct: 0,
      ai_sample_low_score_always: true,
      rng: () => 0,
    });
    expect(result).toBe(false);
  });

  it('always routes at pct=100 regardless of the RNG', () => {
    const result = svc.shouldRouteToReviewInbox({
      total_score: 99,
      critical_cap_percent: 79,
      ai_sample_review_pct: 100,
      ai_sample_low_score_always: false,
      rng: () => 0.999,
    });
    expect(result).toBe(true);
  });

  it('uses the percentage threshold deterministically', () => {
    const below = svc.shouldRouteToReviewInbox({
      total_score: 95,
      critical_cap_percent: 79,
      ai_sample_review_pct: 25,
      ai_sample_low_score_always: false,
      // 0.20 * 100 = 20, which is < 25 → routed
      rng: () => 0.20,
    });
    const above = svc.shouldRouteToReviewInbox({
      total_score: 95,
      critical_cap_percent: 79,
      ai_sample_review_pct: 25,
      ai_sample_low_score_always: false,
      // 0.30 * 100 = 30, which is >= 25 → not routed
      rng: () => 0.30,
    });
    expect(below).toBe(true);
    expect(above).toBe(false);
  });

  it('does not route on missing score even when low_score_always is on', () => {
    const result = svc.shouldRouteToReviewInbox({
      total_score: null,
      critical_cap_percent: 79,
      ai_sample_review_pct: 0,
      ai_sample_low_score_always: true,
      rng: () => 0,
    });
    expect(result).toBe(false);
  });
});
