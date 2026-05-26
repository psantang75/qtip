/**
 * BasePromptService — DB-backed library for the AI Reviewer Base prompt
 * + Trace prompt (layer 1 of the 4-layer system-prompt model). Sync
 * read API is the critical contract: the prompt builders call
 * getBaseForKind() / getAssembledPrompt() synchronously, so cache
 * hydration must work without an async hop.
 *
 * Coverage:
 *   - warmCache loads base rows + exposes them via sync reads
 *   - getBaseForKind returns the default for the kind, throws when none
 *   - getAssembledPrompt = base body + the matching addendum
 *   - upsertBase creates v1 on a new key, increments version on edit
 *   - rollbackToVersion creates a NEW version row whose body is a copy
 *     of the source (forward-only history)
 *   - setDefaultForKind atomically clears the previous default
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  baseFindMany,
  baseFindUnique,
  baseCreate,
  baseUpdate,
  baseUpdateMany,
  versionFindFirst,
  versionFindUnique,
  versionCreate,
  transactionMock,
} = vi.hoisted(() => ({
  baseFindMany: vi.fn(),
  baseFindUnique: vi.fn(),
  baseCreate: vi.fn(),
  baseUpdate: vi.fn(),
  baseUpdateMany: vi.fn(),
  versionFindFirst: vi.fn(),
  versionFindUnique: vi.fn(),
  versionCreate: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    aiBasePrompt: {
      findMany: baseFindMany,
      findUnique: baseFindUnique,
      create: baseCreate,
      update: baseUpdate,
      updateMany: baseUpdateMany,
    },
    aiBasePromptVersion: {
      findFirst: versionFindFirst,
      findUnique: versionFindUnique,
      create: versionCreate,
    },
    $transaction: transactionMock,
  },
}));

import {
  basePromptService,
  warmCache,
  clearBasePromptCache,
  BasePromptError,
} from '../BasePromptService';
import { SINGLE_SOURCE_MARKER, SYNTHESIS_MARKER } from '../aiReviewerPromptAddenda';

const fakeBase = (over: Partial<any> = {}) => ({
  id: 1,
  key: 'base.v1',
  name: 'Base prompt',
  description: null,
  prompt_kind: 'base',
  current_version_id: 100,
  is_default: true,
  is_archived: false,
  updated_by: null,
  created_at: new Date('2026-05-01T00:00:00Z'),
  updated_at: new Date('2026-05-01T00:00:00Z'),
  current_version: {
    id: 100,
    base_prompt_id: 1,
    version: 1,
    body_md: 'You are the AI Reviewer.',
    change_note: null,
    created_by: null,
    created_at: new Date('2026-05-01T00:00:00Z'),
  },
  ...over,
});

const fakeTrace = (over: Partial<any> = {}) =>
  fakeBase({
    id: 2,
    key: 'trace.v1',
    name: 'Trace extraction (Pass 1)',
    prompt_kind: 'trace',
    current_version_id: 200,
    current_version: {
      id: 200,
      base_prompt_id: 2,
      version: 1,
      body_md: 'You are the Pass-1 trace extractor.',
      change_note: null,
      created_by: null,
      created_at: new Date('2026-05-01T00:00:00Z'),
    },
    ...over,
  });

beforeEach(() => {
  baseFindMany.mockReset();
  baseFindUnique.mockReset();
  baseCreate.mockReset();
  baseUpdate.mockReset();
  baseUpdateMany.mockReset();
  versionFindFirst.mockReset();
  versionFindUnique.mockReset();
  versionCreate.mockReset();
  transactionMock.mockReset();
  // Default seed-check returns "row already exists" so warmCache skips
  // its disk-read seed path. Resolves any key.
  baseFindUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where?.key ? fakeBase({ key: where.key }) : null),
  );
  clearBasePromptCache();
});

describe('warmCache + sync reads', () => {
  it('loads bases and exposes them via getBaseForKind', async () => {
    baseFindMany.mockResolvedValueOnce([fakeBase(), fakeTrace()]);

    await warmCache();

    const base = basePromptService.getBaseForKind('base');
    expect(base.id).toBe(1);
    expect(base.body).toBe('You are the AI Reviewer.');
    expect(base.version).toBe(1);

    const trace = basePromptService.getBaseForKind('trace');
    expect(trace.id).toBe(2);
    expect(trace.body).toBe('You are the Pass-1 trace extractor.');
  });

  it('throws BasePromptError when no default exists for the requested kind', async () => {
    baseFindMany.mockResolvedValueOnce([]);
    await warmCache();

    expect(() => basePromptService.getBaseForKind('base')).toThrow(BasePromptError);
  });

  it('throws BasePromptError before warmCache runs', () => {
    expect(() => basePromptService.getBaseForKind('base')).toThrow(BasePromptError);
  });

  it('skips legacy single_source / synthesis rows even if they leak through is_archived', async () => {
    baseFindMany.mockResolvedValueOnce([
      fakeBase(),
      fakeBase({ id: 99, key: 'system.v3', prompt_kind: 'single_source', is_default: true }),
      fakeBase({ id: 98, key: 'synthesis.v1', prompt_kind: 'synthesis', is_default: true }),
    ]);
    await warmCache();
    // Only the kind='base' row is reachable.
    expect(basePromptService.getBaseForKind('base').id).toBe(1);
  });
});

describe('getAssembledPrompt', () => {
  beforeEach(async () => {
    baseFindMany.mockResolvedValueOnce([fakeBase()]);
    await warmCache();
  });

  it('appends SINGLE_SOURCE_ADDENDUM to the base body for single_source mode', () => {
    const assembled = basePromptService.getAssembledPrompt('single_source');
    expect(assembled.body.startsWith('You are the AI Reviewer.')).toBe(true);
    expect(assembled.body).toContain(SINGLE_SOURCE_MARKER);
    // Single-source mode never carries the synthesis-only PER-SOURCE
    // TRACES marker.
    expect(assembled.body).not.toContain(SYNTHESIS_MARKER);
    // Identity passes through from the base row.
    expect(assembled.id).toBe(1);
    expect(assembled.key).toBe('base.v1');
    expect(assembled.version).toBe(1);
  });

  it('appends SYNTHESIS_ADDENDUM to the base body for synthesis mode', () => {
    const assembled = basePromptService.getAssembledPrompt('synthesis');
    expect(assembled.body.startsWith('You are the AI Reviewer.')).toBe(true);
    expect(assembled.body).toContain(SYNTHESIS_MARKER);
    expect(assembled.body).toContain('faithfulness');
    expect(assembled.id).toBe(1);
  });
});

describe('upsertBase', () => {
  beforeEach(async () => {
    baseFindMany.mockResolvedValueOnce([fakeBase()]);
    await warmCache();
    transactionMock.mockImplementation(async (cb: any) =>
      cb({
        aiBasePrompt: {
          findUnique: baseFindUnique,
          create: baseCreate,
          update: baseUpdate,
          updateMany: baseUpdateMany,
        },
        aiBasePromptVersion: {
          findFirst: versionFindFirst,
          create: versionCreate,
        },
      }),
    );
  });

  it('rejects invalid keys', async () => {
    await expect(
      basePromptService.upsertBase({
        key: 'BadKey',
        name: 'X',
        prompt_kind: 'base',
        body_md: 'Body',
      }),
    ).rejects.toBeInstanceOf(BasePromptError);
  });

  it('rejects legacy kinds (single_source / synthesis)', async () => {
    await expect(
      basePromptService.upsertBase({
        key: 'something.v1',
        name: 'X',
        // @ts-expect-error — exercising the runtime guard for legacy kinds
        prompt_kind: 'single_source',
        body_md: 'Body',
      }),
    ).rejects.toBeInstanceOf(BasePromptError);
  });

  it('creates a new base + v1 when key does not exist', async () => {
    baseFindUnique.mockResolvedValueOnce(null);
    baseCreate.mockResolvedValueOnce(
      fakeBase({ id: 5, key: 'base.v2', is_default: false, current_version_id: null }),
    );
    versionFindFirst.mockResolvedValueOnce(null);
    versionCreate.mockResolvedValueOnce({ id: 500, version: 1 });
    baseUpdate.mockResolvedValueOnce(
      fakeBase({ id: 5, key: 'base.v2', is_default: false, current_version_id: 500 }),
    );
    baseFindMany.mockResolvedValueOnce([
      fakeBase(),
      fakeBase({ id: 5, key: 'base.v2', is_default: false, current_version_id: 500 }),
    ]);

    const result = await basePromptService.upsertBase({
      key: 'base.v2',
      name: 'Base prompt v2',
      prompt_kind: 'base',
      body_md: 'New base body',
    });

    expect(result.key).toBe('base.v2');
    expect(versionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 1, body_md: 'New base body' }),
      }),
    );
  });

  it('increments version on edit (existing base by id)', async () => {
    baseFindUnique.mockResolvedValueOnce(fakeBase({ id: 1 }));
    baseUpdate.mockResolvedValueOnce(fakeBase({ id: 1 }));
    versionFindFirst.mockResolvedValueOnce({ version: 4 });
    versionCreate.mockResolvedValueOnce({ id: 555, version: 5 });
    baseUpdate.mockResolvedValueOnce(
      fakeBase({ id: 1, current_version: { ...fakeBase().current_version, id: 555, version: 5 } }),
    );
    baseFindMany.mockResolvedValueOnce([fakeBase()]);

    const result = await basePromptService.upsertBase({
      id: 1,
      key: 'base.v1',
      name: 'Base prompt',
      prompt_kind: 'base',
      body_md: 'Edited body',
      change_note: 'Tightened wording',
    });

    expect(result.current_version).toBe(5);
    expect(versionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 5, change_note: 'Tightened wording' }),
      }),
    );
  });
});

describe('rollbackToVersion', () => {
  beforeEach(async () => {
    baseFindMany.mockResolvedValueOnce([fakeBase()]);
    await warmCache();
    transactionMock.mockImplementation(async (cb: any) =>
      cb({
        aiBasePrompt: { findUnique: baseFindUnique, update: baseUpdate },
        aiBasePromptVersion: { findFirst: versionFindFirst, findUnique: versionFindUnique, create: versionCreate },
      }),
    );
  });

  it('creates a new version row whose body is a copy of the source', async () => {
    versionFindUnique.mockResolvedValueOnce({ id: 50, base_prompt_id: 1, version: 2, body_md: 'Old body' });
    versionFindFirst.mockResolvedValueOnce({ version: 5 });
    versionCreate.mockResolvedValueOnce({ id: 600, version: 6, body_md: 'Old body' });
    baseUpdate.mockResolvedValueOnce(undefined);
    baseFindUnique.mockResolvedValueOnce(
      fakeBase({ current_version: { ...fakeBase().current_version, id: 600, version: 6, body_md: 'Old body' } }),
    );
    baseFindMany.mockResolvedValueOnce([fakeBase()]);

    const result = await basePromptService.rollbackToVersion(1, 50);

    expect(versionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 6, body_md: 'Old body', change_note: 'Rollback to v2' }),
      }),
    );
    expect(result.current_version).toBe(6);
    expect(result.body).toBe('Old body');
  });

  it('rejects when the version belongs to a different base', async () => {
    versionFindUnique.mockResolvedValueOnce({ id: 50, base_prompt_id: 99, version: 2, body_md: 'wrong base' });
    await expect(basePromptService.rollbackToVersion(1, 50)).rejects.toBeInstanceOf(BasePromptError);
  });
});

describe('setDefaultForKind', () => {
  beforeEach(async () => {
    baseFindMany.mockResolvedValueOnce([fakeBase()]);
    await warmCache();
  });

  it('atomically clears the previous default', async () => {
    baseFindUnique.mockResolvedValueOnce(fakeBase({ id: 5, is_default: false }));
    transactionMock.mockResolvedValueOnce([{ count: 1 }, fakeBase({ id: 5, is_default: true })]);
    baseFindMany.mockResolvedValueOnce([fakeBase({ is_default: false }), fakeBase({ id: 5, is_default: true })]);
    // getBaseById call after the flip:
    baseFindUnique.mockResolvedValueOnce(fakeBase({ id: 5, is_default: true }));

    const result = await basePromptService.setDefaultForKind(5);
    expect(result.is_default).toBe(true);
    // The transaction body must run BOTH updateMany (clear) and update (set).
    const ops = transactionMock.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(2);
  });
});
