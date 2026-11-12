import { describe, it, expect } from 'vitest';
import type { WorkflowExecutionDescription } from '@temporalio/client';

import { toJobStatus, unknownJobStatus } from '../../src/provider/status';

function described(name: string, closeTime?: Date) {
  return { workflowId: 'wf', type: 'reviewOrder', status: { code: 0, name }, startTime: new Date('2026-11-11T00:00:00Z'), closeTime } as unknown as WorkflowExecutionDescription;
}

describe('toJobStatus', () => {
  it.each([
    ['RUNNING', 'running'], ['PAUSED', 'running'], ['COMPLETED', 'completed'], ['CONTINUED_AS_NEW', 'completed'],
    ['FAILED', 'failed'], ['TIMED_OUT', 'failed'], ['CANCELLED', 'cancelled'], ['TERMINATED', 'terminated'],
    ['UNSPECIFIED', 'unknown'],
  ])('maps %s to %s', (name, state) => {
    expect(toJobStatus(described(name)).state).toBe(state);
  });

  it('keeps type, provider status and times', () => {
    const status = toJobStatus(described('COMPLETED', new Date('2026-11-11T01:00:00Z')));
    expect(status).toEqual({
      workflowId: 'wf', workflowType: 'reviewOrder', state: 'completed', providerState: 'COMPLETED',
      startedAt: '2026-11-11T00:00:00.000Z', closedAt: '2026-11-11T01:00:00.000Z',
    });
  });

  it('reports a workflow Temporal does not know as unknown', () => {
    expect(unknownJobStatus('gone')).toEqual({ workflowId: 'gone', state: 'unknown', providerState: 'NOT_FOUND' });
  });
});
