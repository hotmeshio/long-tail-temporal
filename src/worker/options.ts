import type { LongTailHttpOptions } from './http';

/** Long Tail as a separate service, over HTTP. */
export interface LongTailHttpActivityConfig {
  /** Long Tail base URL, e.g. https://longtail.example.com */
  url: string;
  /** Bot account API key (lt_bot_...) or a service token. */
  apiKey: string;
  /** Per-request timeout. Default 15 s for waits, 120 s for tool calls. */
  timeoutMs?: number;
}

/** Long Tail in the worker's process: its SDK client, created with the workflow bot's identity. */
export interface LongTailInProcessActivityConfig {
  /** `createClient({ auth: { userId } })` from @hotmeshio/long-tail 0.37.0 or later. */
  client: LongTailClient;
}

export type LongTailActivityConfig = LongTailHttpActivityConfig | LongTailInProcessActivityConfig;

/** An SDK call's result, as Long Tail's api layer returns it. */
export interface LongTailClientResult<T = unknown> {
  status: number;
  data?: T;
  error?: string;
}

/** The part of Long Tail's SDK client the activities call. */
export interface LongTailClient {
  escalations: {
    openWait(input: Record<string, unknown>): Promise<LongTailClientResult>;
    cancel(input: { id: string }): Promise<LongTailClientResult>;
  };
  mcp: {
    callTool(input: { id: string; toolName: string; arguments?: Record<string, unknown>; execute_as?: string }): Promise<LongTailClientResult>;
  };
}

/** How the activities reach Long Tail. */
export type LongTailTarget = LongTailHttpOptions | { client: LongTailClient };

export function isInProcess(target: LongTailTarget | LongTailActivityConfig): target is { client: LongTailClient } {
  return 'client' in target && target.client !== undefined;
}

/** Validated options; throws naming the factory and the missing setting. */
export function resolveOptions(factory: string, config: LongTailActivityConfig, defaultTimeoutMs: number): LongTailTarget {
  if (config && isInProcess(config)) return { client: validClient(factory, config.client) };
  const http = config as LongTailHttpActivityConfig;
  if (!http?.url) throw new Error(`${factory}: \`url\` is required (LT_URL)`);
  if (!http.apiKey) throw new Error(`${factory}: \`apiKey\` is required (LT_API_KEY)`);
  const timeoutMs = http.timeoutMs ?? defaultTimeoutMs;
  if (!(timeoutMs > 0)) throw new Error(`${factory}: \`timeoutMs\` must be positive`);
  new URL(http.url);
  return { url: http.url, apiKey: http.apiKey, timeoutMs };
}

function validClient(factory: string, client: LongTailClient): LongTailClient {
  const methods: Array<[string, unknown]> = [
    ['escalations.openWait', client?.escalations?.openWait],
    ['escalations.cancel', client?.escalations?.cancel],
    ['mcp.callTool', client?.mcp?.callTool],
  ];
  const missing = methods.filter(([, fn]) => typeof fn !== 'function').map(([name]) => name);
  if (missing.length) {
    throw new Error(`${factory}: \`client\` lacks ${missing.join(', ')}; pass createClient() from @hotmeshio/long-tail 0.37.0 or later`);
  }
  return client;
}
