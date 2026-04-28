import Anthropic from '@anthropic-ai/sdk';
import { aiConfig } from '../../config/ai';
import logger from '../../config/logger';
import type { PingResult } from './OpenAIClient';

/**
 * Singleton Anthropic client. Lazily constructed on first use so a missing
 * ANTHROPIC_API_KEY is only fatal for code paths that actually need it.
 *
 * Anthropic does not expose a free `models.list` equivalent, so the health
 * ping here issues the cheapest valid request (a 1-token completion) when
 * we want a true round-trip check. To avoid spending tokens on every
 * health probe, the default ping only validates the key shape and confirms
 * configuration; pass `{ liveCheck: true }` from a manual /diagnostics
 * route when you actually want to hit the API.
 */
let client: Anthropic | null = null;

export function isAnthropicConfigured(): boolean {
  return aiConfig.anthropic !== null;
}

export function getAnthropicClient(): Anthropic {
  if (!aiConfig.anthropic) {
    throw new Error('Anthropic is not configured (set ANTHROPIC_API_KEY).');
  }
  if (!client) {
    client = new Anthropic({
      apiKey: aiConfig.anthropic.apiKey,
      timeout: aiConfig.anthropic.timeoutMs,
      maxRetries: aiConfig.anthropic.maxRetries,
    });
  }
  return client;
}

export async function pingAnthropic(opts: { liveCheck?: boolean } = {}): Promise<PingResult> {
  if (!aiConfig.anthropic) return { ok: false, error: 'not_configured' };

  if (!opts.liveCheck) {
    const looksLikeKey = aiConfig.anthropic.apiKey.startsWith('sk-ant-');
    return looksLikeKey
      ? { ok: true, model: aiConfig.anthropic.defaultModel }
      : { ok: false, error: 'invalid_key_shape' };
  }

  try {
    const c = getAnthropicClient();
    await c.messages.create({
      model: aiConfig.anthropic.defaultModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true, model: aiConfig.anthropic.defaultModel };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logger.warn('[ai] Anthropic ping failed:', message);
    return { ok: false, error: message };
  }
}
