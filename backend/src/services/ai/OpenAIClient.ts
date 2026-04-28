import OpenAI from 'openai';
import { aiConfig } from '../../config/ai';
import logger from '../../config/logger';

/**
 * Singleton OpenAI client. Lazily constructed on first use so a missing
 * OPENAI_API_KEY is only fatal for code paths that actually need the client.
 *
 * Use `getOpenAIClient()` from feature code; use `pingOpenAI()` from health
 * checks — it never throws and reports `not_configured` cleanly when the
 * key is absent.
 */
let client: OpenAI | null = null;

export function isOpenAIConfigured(): boolean {
  return aiConfig.openai !== null;
}

export function getOpenAIClient(): OpenAI {
  if (!aiConfig.openai) {
    throw new Error('OpenAI is not configured (set OPENAI_API_KEY).');
  }
  if (!client) {
    client = new OpenAI({
      apiKey: aiConfig.openai.apiKey,
      timeout: aiConfig.openai.timeoutMs,
      maxRetries: aiConfig.openai.maxRetries,
    });
  }
  return client;
}

export type PingResult = { ok: true; model?: string } | { ok: false; error: string };

/**
 * Lightweight credential check — calls `models.list` which is free and
 * confirms the API key is valid without burning a completion. Safe to call
 * from /health endpoints.
 */
export async function pingOpenAI(): Promise<PingResult> {
  if (!aiConfig.openai) return { ok: false, error: 'not_configured' };
  try {
    const c = getOpenAIClient();
    const list = await c.models.list();
    const sample = list.data.find((m) => m.id === aiConfig.openai!.defaultModel) ?? list.data[0];
    return { ok: true, model: sample?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logger.warn('[ai] OpenAI ping failed:', message);
    return { ok: false, error: message };
  }
}
