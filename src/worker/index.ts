import { DEFAULTS, LT_ACTIVITY, LT_ROUTES } from '../constants';
import type { LTActivities, LTCloseInput, LTOpenInput, LTOpenResult } from '../types';
import { LongTailHttpError, postJson, type LongTailHttpOptions } from './http';

export { LongTailHttpError } from './http';
export type { LTActivities, LTOpenInput, LTOpenResult, LTCloseInput } from '../types';

export interface LongTailActivityConfig {
  /** Long Tail base URL, e.g. https://longtail.example.com */
  url: string;
  /** Bot account API key (lt_bot_...) or a service token. */
  apiKey: string;
  /** Per-request timeout. Default 15 s. */
  timeoutMs?: number;
}

const HTTP_CONFLICT = 409;

/**
 * The activities `conditional()` calls. Spread them into the worker:
 * `activities: { ...myActivities, ...longTailActivities({ url, apiKey }) }`.
 */
export function longTailActivities(config: LongTailActivityConfig): LTActivities {
  const options = resolveOptions(config);
  return {
    async [LT_ACTIVITY.OPEN](input: LTOpenInput): Promise<LTOpenResult> {
      return postJson<LTOpenResult>(options, LT_ROUTES.OPEN_WAIT, input);
    },
    async [LT_ACTIVITY.CLOSE]({ escalationId }: LTCloseInput): Promise<void> {
      try {
        await postJson(options, LT_ROUTES.cancel(escalationId), {});
      } catch (err) {
        // Already terminal: nothing to close.
        if (err instanceof LongTailHttpError && err.status === HTTP_CONFLICT) return;
        throw err;
      }
    },
  };
}

function resolveOptions(config: LongTailActivityConfig): LongTailHttpOptions {
  if (!config?.url) throw new Error('longTailActivities: `url` is required (LT_URL)');
  if (!config.apiKey) throw new Error('longTailActivities: `apiKey` is required (LT_API_KEY)');
  const timeoutMs = config.timeoutMs ?? DEFAULTS.HTTP_TIMEOUT_MS;
  if (!(timeoutMs > 0)) throw new Error('longTailActivities: `timeoutMs` must be positive');
  new URL(config.url);
  return { url: config.url, apiKey: config.apiKey, timeoutMs };
}
