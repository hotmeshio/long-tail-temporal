import { DEFAULTS, LT_ACTIVITY, LT_ROUTES } from '../constants';
import type { LTActivities, LTCloseInput, LTOpenInput, LTOpenResult } from '../types';
import { throwActivityFailure } from './failure';
import { LongTailHttpError, postJson } from './http';
import { resolveOptions, type LongTailActivityConfig } from './options';

export { LongTailHttpError } from './http';
export { longTailTools } from './tools';
export type { LongTailFailureDetails } from './failure';
export type { LongTailActivityConfig } from './options';
export type { LTActivities, LTOpenInput, LTOpenResult, LTCloseInput, LTToolActivities, LTToolCallInput } from '../types';

const HTTP_CONFLICT = 409;

/**
 * The activities `conditional()` calls. Spread them into the worker:
 * `activities: { ...myActivities, ...longTailActivities({ url, apiKey }) }`.
 */
export function longTailActivities(config: LongTailActivityConfig): LTActivities {
  const options = resolveOptions('longTailActivities', config, DEFAULTS.HTTP_TIMEOUT_MS);
  return {
    async [LT_ACTIVITY.OPEN](input: LTOpenInput): Promise<LTOpenResult> {
      try {
        return await postJson<LTOpenResult>(options, LT_ROUTES.OPEN_WAIT, input);
      } catch (err) {
        throwActivityFailure(err);
      }
    },
    async [LT_ACTIVITY.CLOSE]({ escalationId }: LTCloseInput): Promise<void> {
      try {
        await postJson(options, LT_ROUTES.cancel(escalationId), {});
      } catch (err) {
        // Already terminal: nothing to close.
        if (err instanceof LongTailHttpError && err.status === HTTP_CONFLICT) return;
        throwActivityFailure(err);
      }
    },
  };
}
