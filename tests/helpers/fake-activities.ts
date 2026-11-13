import type { LTActivities, LTCloseInput, LTOpenInput, LTToolActivities, LTToolCallInput } from '../../src/types';

/** Records lt.open / lt.close / lt.tools.call calls; ids are derived from the wait key. */
export function fakeActivities(toolResult: (input: LTToolCallInput) => unknown = () => ({ ok: true })) {
  const opened: LTOpenInput[] = [];
  const closed: LTCloseInput[] = [];
  const toolCalls: LTToolCallInput[] = [];
  const activities: LTActivities & LTToolActivities = {
    async 'lt.open'(input) {
      opened.push(input);
      return { escalationId: `esc-${input.workflowId}-${input.waitKey}`, status: 'pending', created: true };
    },
    async 'lt.close'(input) {
      closed.push(input);
    },
    async 'lt.tools.call'(input) {
      toolCalls.push(input);
      return toolResult(input);
    },
  };
  return { activities, opened, closed, toolCalls };
}

export function outcome(waitKey: string, status: 'resolved' | 'expired' | 'cancelled', data?: Record<string, unknown>,
  resolution: { resolvedBy?: string; resolvedAt?: string } = {}) {
  return { waitKey, escalationId: `esc-${waitKey}`, status, ...(data ? { data } : {}), ...resolution };
}
