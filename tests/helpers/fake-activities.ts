import type { LTActivities, LTCloseInput, LTOpenInput } from '../../src/types';

/** Records ltOpen / ltClose calls; ids are derived from the wait key. */
export function fakeActivities() {
  const opened: LTOpenInput[] = [];
  const closed: LTCloseInput[] = [];
  const activities: LTActivities = {
    async ltOpen(input) {
      opened.push(input);
      return { escalationId: `esc-${input.workflowId}-${input.waitKey}`, status: 'pending', created: true };
    },
    async ltClose(input) {
      closed.push(input);
    },
  };
  return { activities, opened, closed };
}

export function outcome(waitKey: string, status: 'resolved' | 'expired' | 'cancelled', data?: Record<string, unknown>) {
  return { waitKey, escalationId: `esc-${waitKey}`, status, ...(data ? { data } : {}) };
}
