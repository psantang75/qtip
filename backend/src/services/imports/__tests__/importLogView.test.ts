import { describe, it, expect } from 'vitest';
import {
  normalizeImportStatus, importChannel, importDetailMessage,
} from '../importLogView';

describe('normalizeImportStatus', () => {
  it('maps COMPLETE to SUCCESS', () => {
    expect(normalizeImportStatus('COMPLETE')).toBe('SUCCESS');
  });

  it('maps PENDING and PROCESSING to RUNNING', () => {
    expect(normalizeImportStatus('PENDING')).toBe('RUNNING');
    expect(normalizeImportStatus('PROCESSING')).toBe('RUNNING');
  });

  it('passes FAILED through unchanged', () => {
    expect(normalizeImportStatus('FAILED')).toBe('FAILED');
  });
});

describe('importChannel', () => {
  it('reads a mailbox stamp as the email channel', () => {
    expect(importChannel({ source: 'mailbox', from: 'a@b.com' })).toBe('email');
  });

  it('treats anything else — including null — as a manual upload', () => {
    expect(importChannel(null)).toBe('manual');
    expect(importChannel({})).toBe('manual');
    expect(importChannel({ warnings: ['x'] })).toBe('manual');
  });
});

describe('importDetailMessage', () => {
  it('prefers an explicit failure message', () => {
    expect(importDetailMessage({ message: 'boom' })).toBe('boom');
  });

  it('falls back to concatenated warnings', () => {
    expect(importDetailMessage({ warnings: ['a', 'b'] })).toBe('a b');
  });

  it('returns null when there is nothing to say', () => {
    expect(importDetailMessage(null)).toBeNull();
    expect(importDetailMessage({})).toBeNull();
    expect(importDetailMessage({ warnings: [] })).toBeNull();
  });
});
