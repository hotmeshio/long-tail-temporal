import type { LongTailHttpOptions } from './http';

export interface LongTailActivityConfig {
  /** Long Tail base URL, e.g. https://longtail.example.com */
  url: string;
  /** Bot account API key (lt_bot_...) or a service token. */
  apiKey: string;
  /** Per-request timeout. Default 15 s for waits, 120 s for tool calls. */
  timeoutMs?: number;
}

/** Validated HTTP options; throws naming the factory and the missing setting. */
export function resolveOptions(factory: string, config: LongTailActivityConfig, defaultTimeoutMs: number): LongTailHttpOptions {
  if (!config?.url) throw new Error(`${factory}: \`url\` is required (LT_URL)`);
  if (!config.apiKey) throw new Error(`${factory}: \`apiKey\` is required (LT_API_KEY)`);
  const timeoutMs = config.timeoutMs ?? defaultTimeoutMs;
  if (!(timeoutMs > 0)) throw new Error(`${factory}: \`timeoutMs\` must be positive`);
  new URL(config.url);
  return { url: config.url, apiKey: config.apiKey, timeoutMs };
}
