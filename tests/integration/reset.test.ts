import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { WorkflowHandle } from '@temporalio/client';

import { startLongTailStack, type LongTailStack } from '../helpers/long-tail-stack';

const TASK_QUEUE = 'reset-e2e';
const WORKFLOWS = path.resolve(__dirname, '../workflows/conditional-workflows.ts');
let stack: LongTailStack;
let n = 0;
const id = (name: string) => `${name}-${Date.now()}-${++n}`;
const start = (workflowId: string) =>
  stack.env.client.workflow.start('outcomeWait', { taskQueue: TASK_QUEUE, workflowId, args: ['review'] });
const resolve = (escalationId: string) =>
  stack.api('POST', `/api/escalations/${escalationId}/resolve`, { resolverPayload: { approved: true } });
const statusOf = async (escalationId: string) => {
  const { data } = await stack.api<any>('GET', `/api/escalations/${escalationId}`);
  return (data.escalation ?? data).status;
};

/** Resets the workflow to its first or last completed workflow task. */
async function resetTo(handle: WorkflowHandle, task: 'first' | 'last') {
  const completed = ((await handle.fetchHistory()).events ?? []).filter((e) => e.workflowTaskCompletedEventAttributes);
  const target = task === 'first' ? completed[0] : completed[completed.length - 1];
  await stack.env.client.workflowService.resetWorkflowExecution({
    namespace: 'default', workflowExecution: { workflowId: handle.workflowId },
    reason: 'test', workflowTaskFinishEventId: target.eventId, requestId: id('reset'),
  });
}

describe('workflow reset on Temporal (end to end)', () => {
  beforeAll(async () => {
    stack = await startLongTailStack({ taskQueue: TASK_QUEUE, workflowsPath: WORKFLOWS });
  });

  afterAll(async () => {
    await stack?.shutdown();
  });

  it('resolves the escalation of a wait a reset carried to the current run', async () => {
    const handle = await start(id('carried'));
    const row = await stack.escalationFor(handle.workflowId);
    await resetTo(handle, 'last');

    expect((await resolve(row.id)).status).toBe(200);
    const result = await stack.env.client.workflow.getHandle(handle.workflowId).result();
    expect(result).toMatchObject({ status: 'resolved', escalationId: row.id, data: { approved: true } });
  });

  it('cancels the escalation of a run reset before its wait opened, and resolves the one the current run opened', async () => {
    const handle = await start(id('reopened'));
    const first = await stack.escalationFor(handle.workflowId);
    await resetTo(handle, 'first');
    const second = await stack.escalationFor(handle.workflowId, (row) => row.id !== first.id);

    expect((await resolve(first.id)).status).toBe(409);
    expect(await statusOf(first.id)).toBe('cancelled');

    expect((await resolve(second.id)).status).toBe(200);
    const result = await stack.env.client.workflow.getHandle(handle.workflowId).result();
    expect(result).toMatchObject({ status: 'resolved', escalationId: second.id, data: { approved: true } });
  });
});
