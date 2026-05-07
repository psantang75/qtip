import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/environment')>();
  return { ...actual, aiReviewerConfig: { userId: 99004 } };
});

import { classifyReviewer, isAiReviewer } from '../ReviewerClassifier';

describe('ReviewerClassifier', () => {
  it('classifies an AI submission when submitted_by matches the configured AI user', () => {
    expect(classifyReviewer({ submitted_by: 99004 })).toBe('ai');
  });

  it('classifies any other user as a QA-driven (human) submission', () => {
    expect(classifyReviewer({ submitted_by: 7 })).toBe('qa');
  });

  it('treats unknown / null submitter as QA so we never silently drop critical mail', () => {
    expect(classifyReviewer({ submitted_by: null })).toBe('qa');
    expect(classifyReviewer({ submitted_by: undefined })).toBe('qa');
  });

  it('isAiReviewer matches the configured AI user only', () => {
    expect(isAiReviewer(99004)).toBe(true);
    expect(isAiReviewer(99005)).toBe(false);
    expect(isAiReviewer(null)).toBe(false);
  });
});
