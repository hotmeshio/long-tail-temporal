import { proxyActivities } from '@temporalio/workflow';

import { DEFAULTS, LT_ACTIVITY } from '../constants';
import type { LTToolActivities } from '../types';

const activities = proxyActivities<LTToolActivities>({
  startToCloseTimeout: DEFAULTS.TOOL_START_TO_CLOSE,
  retry: { maximumAttempts: DEFAULTS.TOOL_MAX_ATTEMPTS },
});
const callTool = activities[LT_ACTIVITY.TOOL_CALL];

export interface LTToolCallOptions {
  /** User id or external id to act as; the worker's account must outrank it. */
  executeAs?: string;
}

/**
 * MCP tools on Long Tail, called from workflow code as an activity. The
 * worker registers `longTailTools({ url, apiKey })`. A refusal (4xx) fails
 * the call at once; server and network errors retry.
 */
export const tools = {
  /** Call `tool` on `server` (an MCP server id or name) and return its result. */
  call<T = unknown>(server: string, tool: string, args: Record<string, unknown> = {}, options: LTToolCallOptions = {}): Promise<T> {
    return callTool({ server, tool, arguments: args, ...(options.executeAs ? { executeAs: options.executeAs } : {}) }) as Promise<T>;
  },
};
