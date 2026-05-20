/**
 * Unit-tests the input contract for `POST /api/ai-reviewer/run`'s new
 * optional `attached_sources[]` field.
 *
 * The route handler delegates body validation to `parseAttachedSources`
 * (a pure function), which lets us pin the validation rules without
 * spinning up Express, supertest, or the AI Reviewer service. The
 * dispatch path itself is covered by
 * `AIReviewerService.reviewCase.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { parseAttachedSources } from '../ai-reviewer.routes';

describe('parseAttachedSources', () => {
  it('returns [] when the field is absent', () => {
    expect(parseAttachedSources(undefined)).toEqual({ refs: [] });
    expect(parseAttachedSources(null)).toEqual({ refs: [] });
  });

  it('returns [] when the field is an empty array', () => {
    expect(parseAttachedSources([])).toEqual({ refs: [] });
  });

  it('rejects a non-array value', () => {
    const out = parseAttachedSources('TICKET:42');
    expect('error' in out && out.error).toMatch(/must be an array/);
  });

  it('rejects an entry missing the kind field', () => {
    const out = parseAttachedSources([{ external_id: 42 }]);
    expect('error' in out && out.error).toMatch(/kind must be one of/);
  });

  it('rejects an unsupported kind', () => {
    const out = parseAttachedSources([{ kind: 'EMAIL', external_id: 'abc' }]);
    expect('error' in out && out.error).toMatch(/kind must be one of/);
  });

  it('rejects an entry missing external_id', () => {
    const out = parseAttachedSources([{ kind: 'TICKET' }]);
    expect('error' in out && out.error).toMatch(/external_id is required/);
  });

  it('rejects an empty external_id string', () => {
    const out = parseAttachedSources([{ kind: 'TICKET', external_id: '   ' }]);
    expect('error' in out && out.error).toMatch(/must not be empty/);
  });

  it('rejects a non-positive integer external_id for TICKET', () => {
    const out = parseAttachedSources([{ kind: 'TICKET', external_id: 'abc' }]);
    expect('error' in out && out.error).toMatch(/must be a positive integer/);
    const out2 = parseAttachedSources([{ kind: 'TASK', external_id: -3 }]);
    expect('error' in out2 && out2.error).toMatch(/must be a positive integer/);
  });

  it('coerces TICKET / TASK external_id to a number', () => {
    const out = parseAttachedSources([
      { kind: 'TICKET', external_id: '42' },
      { kind: 'TASK', external_id: 7 },
    ]);
    expect(out).toEqual({
      refs: [
        { kind: 'TICKET', external_id: 42 },
        { kind: 'TASK', external_id: 7 },
      ],
    });
  });

  it('renames CONVERSATION to CALL and keeps external_id as a string', () => {
    const out = parseAttachedSources([{ kind: 'CONVERSATION', external_id: 'abc-123' }]);
    expect(out).toEqual({
      refs: [{ kind: 'CALL', external_id: 'abc-123' }],
    });
  });

  it('returns the index of the first invalid entry in the error message', () => {
    const out = parseAttachedSources([
      { kind: 'TICKET', external_id: 1 },
      { kind: 'TICKET', external_id: 'oops' },
      { kind: 'TICKET', external_id: 3 },
    ]);
    expect('error' in out && out.error).toMatch(/attached_sources\[1\]/);
  });
});
