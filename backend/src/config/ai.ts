/**
 * AI provider configuration surface.
 *
 * The actual values come from environment.ts (`aiConfig`); this module
 * exposes a stable import path and the per-provider type so client wrappers
 * in services/ai/ don't have to reach into environment.ts directly.
 *
 * Each provider is independently optional. When the API key for a provider
 * is not set, the corresponding entry on `aiConfig` is `null` and the client
 * factory throws on `get*Client()` while the health ping returns
 * `{ ok: false, error: 'not_configured' }`.
 */
export { aiConfig } from './environment';

export interface AiProviderConfig {
  apiKey: string;
  defaultModel: string;
  timeoutMs: number;
  maxRetries: number;
}
