/**
 * Extractor parsing tests. The miner's whole value depends on only storing
 * GENERALIZABLE, well-formed plays: the outcome is authoritative (from the CRM,
 * never the model), unknown categories are dropped, and a bare/blank play is
 * skipped rather than proposed as filler. The guardrail line about free product
 * must be present in the miner prompt.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../ai/ChatModelClient', () => ({ callChatModel: vi.fn() }));
vi.mock('../../../../aiCallLogger', () => ({ withCallLog: vi.fn() }));
vi.mock('../../../../../config/prisma', () => ({ default: {} }));

import { buildMinerSystemPrompt, parsePlays } from '../extractor';

const meta = { conversationId: 'conv-1', agentName: 'Steven Selley' };

describe('parsePlays', () => {
  it('keeps a well-formed play and stamps the authoritative outcome + source', () => {
    const raw = JSON.stringify({
      plays: [{
        category: 'closing',
        title: 'Ask for the order on the first call',
        body_md: 'When the customer confirms need, assume the sale and offer the earliest install date.',
        evidence_quote: 'Can we get this in before the holidays?',
        evidence_speaker: 'CUSTOMER',
        est_value_note: 'Annual subscription',
      }],
    });
    const out = parsePlays(raw, 'WON', meta);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      category: 'closing',
      sourceOutcome: 'WON',
      sourceConversationId: 'conv-1',
      sourceAgentName: 'Steven Selley',
      evidenceSpeaker: 'CUSTOMER',
    });
  });

  it('drops a play with an unknown category', () => {
    const raw = JSON.stringify({ plays: [{ category: 'smalltalk', title: 'x', body_md: 'y' }] });
    expect(parsePlays(raw, 'WON', meta)).toEqual([]);
  });

  it('skips a play missing a title or body rather than storing filler', () => {
    const raw = JSON.stringify({ plays: [
      { category: 'urgency', title: '', body_md: 'body' },
      { category: 'urgency', title: 'title', body_md: '   ' },
    ] });
    expect(parsePlays(raw, 'LOST', meta)).toEqual([]);
  });

  it('nulls the speaker when there is no quote', () => {
    const raw = JSON.stringify({ plays: [
      { category: 'discovery', title: 'Open with a needs question', body_md: 'Ask what problem they are solving.', evidence_speaker: 'AGENT' },
    ] });
    expect(parsePlays(raw, 'WON', meta)[0].evidenceSpeaker).toBeNull();
  });

  it('returns [] for non-JSON instead of throwing', () => {
    expect(parsePlays('the model said no', 'WON', meta)).toEqual([]);
  });

  it('caps output at three plays', () => {
    const plays = Array.from({ length: 6 }, (_, i) => ({
      category: 'objection', title: `Play ${i}`, body_md: 'Handle it with ARP.',
    }));
    expect(parsePlays(JSON.stringify({ plays }), 'WON', meta)).toHaveLength(3);
  });
});

describe('buildMinerSystemPrompt', () => {
  it('carries the persona and the no-free-product guardrail', () => {
    const p = buildMinerSystemPrompt('Be an expert SMB closer.');
    expect(p).toContain('Be an expert SMB closer.');
    expect(p).toMatch(/NEVER recommend free product/i);
  });
});
