import { ApplicationFailure } from '@temporalio/common';

import { DEFAULTS, LT_ACTIVITY, LT_OPERATIONS, LT_ROUTES } from '../constants';
import type { LTToolActivities, LTToolCallInput } from '../types';
import { throwActivityFailure } from './failure';
import { callInProcess, postJson } from './http';
import { isInProcess, resolveOptions, type LongTailActivityConfig } from './options';

const INVALID_INPUT = 'LongTailInvalidInput';

/**
 * The activity `tools.call()` runs: calls an MCP tool on a Long Tail server,
 * built in or connected, as the configured account, and returns the tool's
 * `result`. Spread it into the worker beside `longTailActivities`.
 */
export function longTailTools(config: LongTailActivityConfig): LTToolActivities {
  const options = resolveOptions('longTailTools', config, DEFAULTS.TOOL_HTTP_TIMEOUT_MS);
  return {
    async [LT_ACTIVITY.TOOL_CALL]({ server, tool, arguments: args, executeAs }: LTToolCallInput): Promise<unknown> {
      if (!server || !tool) throw ApplicationFailure.nonRetryable('lt.tools.call: `server` and `tool` are required', INVALID_INPUT);
      try {
        const callAs = executeAs ? { execute_as: executeAs } : {};
        const reply = isInProcess(options)
          ? await callInProcess<{ result: unknown }>(LT_OPERATIONS.TOOL_CALL, () => options.client.mcp.callTool({ id: server, toolName: tool, arguments: args ?? {}, ...callAs }))
          : await postJson<{ result: unknown }>(options, LT_ROUTES.toolCall(server, tool), { arguments: args ?? {}, ...callAs });
        return reply.result;
      } catch (err) {
        throwActivityFailure(err);
      }
    },
  };
}
