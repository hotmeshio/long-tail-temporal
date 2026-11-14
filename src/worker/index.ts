import { DEFAULTS, LT_ACTIVITY, LT_OPERATIONS, LT_ROUTES } from '../constants';
import type { LTActivities, LTCloseInput, LTOpenInput, LTOpenResult } from '../types';
import { throwActivityFailure } from './failure';
import { callInProcess, LongTailHttpError, postJson } from './http';
import { isInProcess, resolveOptions, type LongTailActivityConfig } from './options';

export { LongTailHttpError } from './http';
export { longTailTools } from './tools';
export type { LongTailFailureDetails } from './failure';
export type {
  LongTailActivityConfig, LongTailClient, LongTailClientResult, LongTailHttpActivityConfig, LongTailInProcessActivityConfig,
} from './options';
export type { LTActivities, LTOpenInput, LTOpenResult, LTCloseInput, LTToolActivities, LTToolCallInput } from '../types';

const HTTP_CONFLICT = 409;

/**
 * The activities `conditional()` calls. Spread them into the worker:
 * `activities: { ...myActivities, ...longTailActivities({ url, apiKey }) }`,
 * or `longTailActivities({ client })` when Long Tail runs in the worker's process.
 */
export function longTailActivities(config: LongTailActivityConfig): LTActivities {
  const options = resolveOptions('longTailActivities', config, DEFAULTS.HTTP_TIMEOUT_MS);
  return {
    async [LT_ACTIVITY.OPEN](input: LTOpenInput): Promise<LTOpenResult> {
      try {
        if (isInProcess(options)) {
          return await callInProcess<LTOpenResult>(LT_OPERATIONS.OPEN_WAIT, () => options.client.escalations.openWait({ ...input }));
        }
        return await postJson<LTOpenResult>(options, LT_ROUTES.OPEN_WAIT, input);
      } catch (err) {
        throwActivityFailure(err);
      }
    },
    async [LT_ACTIVITY.CLOSE]({ escalationId }: LTCloseInput): Promise<void> {
      try {
        if (isInProcess(options)) {
          await callInProcess(LT_OPERATIONS.CANCEL, () => options.client.escalations.cancel({ id: escalationId }));
        } else {
          await postJson(options, LT_ROUTES.cancel(escalationId), {});
        }
      } catch (err) {
        // Already terminal: nothing to close.
        if (err instanceof LongTailHttpError && err.status === HTTP_CONFLICT) return;
        throwActivityFailure(err);
      }
    },
  };
}
