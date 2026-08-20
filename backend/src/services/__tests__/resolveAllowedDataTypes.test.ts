/**
 * Unit tests for the shared ingestion allowlist resolver.
 *
 * This one function gates BOTH ingestion entry points — the mailbox poller and
 * the manual Import Center — so its parse/fallback behaviour is the single place
 * that decides "which report types may be ingested". No DB, pure input/output.
 */
import { describe, it, expect } from 'vitest';
import { resolveAllowedDataTypes, type DataType } from '../importService';

const PUNCH: readonly DataType[] = ['punch_data'];

describe('resolveAllowedDataTypes', () => {
  it('falls back to the defaults when unset, blank, or all-garbage', () => {
    expect(resolveAllowedDataTypes(undefined, PUNCH)).toEqual(['punch_data']);
    expect(resolveAllowedDataTypes('', PUNCH)).toEqual(['punch_data']);
    expect(resolveAllowedDataTypes('   ', PUNCH)).toEqual(['punch_data']);
    expect(resolveAllowedDataTypes('nonsense,also_fake', PUNCH)).toEqual(['punch_data']);
  });

  it('parses a comma-separated override, trimming and lower-casing tokens', () => {
    expect(resolveAllowedDataTypes(' Punch_Data , ticket_task ', PUNCH)).toEqual([
      'punch_data',
      'ticket_task',
    ]);
  });

  it('drops unknown tokens but keeps recognised ones', () => {
    expect(resolveAllowedDataTypes('ticket_task,made_up', PUNCH)).toEqual(['ticket_task']);
  });

  it('de-duplicates repeated tokens', () => {
    expect(resolveAllowedDataTypes('punch_data,punch_data', PUNCH)).toEqual(['punch_data']);
  });

  it('does not mutate or alias the defaults array', () => {
    const defaults: readonly DataType[] = ['punch_data'];
    const out = resolveAllowedDataTypes(undefined, defaults);
    expect(out).not.toBe(defaults);
    out.push('ticket_task');
    expect(defaults).toEqual(['punch_data']);
  });
});
