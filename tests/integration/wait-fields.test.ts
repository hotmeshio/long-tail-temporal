import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkflowFailedError } from '@temporalio/client';

import { startLongTailStack, type LongTailStack } from '../helpers/long-tail-stack';

const TASK_QUEUE = 'wait-fields-e2e';
const WORKFLOWS = path.resolve(__dirname, '../workflows/conditional-workflows.ts');
let stack: LongTailStack;
let n = 0;
const id = (name: string) => `${name}-${Date.now()}-${++n}`;
const start = (workflow: string, args: unknown[], workflowId = id(workflow)) =>
  stack.env.client.workflow.start(workflow, { taskQueue: TASK_QUEUE, workflowId, args });
const escalation = async (escalationId: string) => {
  const { data } = await stack.api<any>('GET', `/api/escalations/${escalationId}`);
  return data.escalation ?? data;
};

describe('provider wait fields on Temporal (end to end)', () => {
  beforeAll(async () => {
    stack = await startLongTailStack({ taskQueue: TASK_QUEUE, workflowsPath: WORKFLOWS });
  });

  afterAll(async () => {
    await stack?.shutdown();
  });

  it('stores the envelope, lookups, files, form version and claim on the escalation', async () => {
    const fields = {
      envelope: { formDefaults: { notes: 'prefilled' }, confidence: { notes: 0.4 } },
      lookups: [{ domain: 'catalog', key: 'sizes' }],
      files: [{ path: 'orders/42/scan.pdf', as: 'scan' }],
      schemaVersion: 1,
      assignee: stack.adminUserId,
      durationMinutes: 30,
    };
    const handle = await start('outcomeWait', ['fields', fields]);
    const row = await escalation((await stack.escalationFor(handle.workflowId)).id);
    const stored = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
    expect(stored).toMatchObject({ formDefaults: { notes: 'prefilled' }, confidence: { notes: 0.4 }, lookups: fields.lookups, files: fields.files });
    expect(row.metadata).toMatchObject({ schema_version: 1 });
    expect(row.assigned_to).toBe(stack.adminUserId);
    expect(Date.parse(row.assigned_until) - Date.now()).toBeGreaterThan(25 * 60_000);

    await stack.api('POST', `/api/escalations/${row.id}/resolve`, { resolverPayload: { approved: true } });
    expect(await handle.result()).toMatchObject({
      status: 'resolved', escalationId: row.id, data: { approved: true }, resolvedBy: stack.adminUserId,
    });
  });

  it('links a child wait to its parent and origin', async () => {
    const handle = await start('chainedWaits', []);
    const first = await stack.escalationFor(handle.workflowId);
    await stack.api('POST', `/api/escalations/${first.id}/resolve`, { resolverPayload: {} });
    const second = await stack.escalationFor(handle.workflowId, (row) => row.id !== first.id);
    expect(second).toMatchObject({ parent_id: first.id, origin_id: first.id });
    await stack.api('POST', `/api/escalations/${second.id}/resolve`, { resolverPayload: {} });
    expect(await handle.result()).toMatchObject({ first: { escalationId: first.id }, second: { escalationId: second.id } });
  });

  it('resolves a wait by its signal key and delivers the outcome', async () => {
    const signalKey = id('order-review');
    const handle = await start('outcomeWait', ['keyed', { signalKey }]);
    const row = await stack.escalationFor(handle.workflowId);
    const resolved = await stack.api('POST', '/api/escalations/resolve-by-signal-key', { signalKey, resolverPayload: { approved: true } });
    expect(resolved.status).toBe(200);
    expect(await handle.result()).toMatchObject({ status: 'resolved', escalationId: row.id, data: { approved: true } });
  });

  it('collects accumulator items added by signal key', async () => {
    const signalKey = id('approvals');
    const handle = await start('outcomeWait', ['acc', { signalKey, accumulate: { max: 2 } }]);
    await stack.escalationFor(handle.workflowId);
    for (const approver of ['ana', 'ben']) {
      const added = await stack.api('POST', '/api/escalations/accumulate-by-signal-key', { signalKey, itemKey: approver, payload: { approver } });
      expect(added.status).toBe(200);
    }
    const result = await handle.result();
    expect(result).toMatchObject({ status: 'resolved', data: { $trigger: 'count' } });
    expect(result.data.$accumulated.map((item: any) => item.itemKey)).toEqual(['ana', 'ben']);
  });

  it('fails the workflow at once when its signal key is held by another wait', async () => {
    const signalKey = id('held');
    const holder = await start('outcomeWait', ['first', { signalKey }]);
    await stack.escalationFor(holder.workflowId);
    const second = await start('outcomeWait', ['second', { signalKey }]);
    const err = await second.result().catch((e) => e);
    expect(err).toBeInstanceOf(WorkflowFailedError);
    const refusal = err.cause?.cause;
    expect(refusal).toMatchObject({ type: 'LongTailHttpError', nonRetryable: true });
    expect(refusal.details[0]).toMatchObject({ status: 409 });
    await stack.api('POST', '/api/escalations/resolve-by-signal-key', { signalKey, resolverPayload: {} });
    await holder.result();
  });

  it('tells a cancel from a resolve, and adds $resolution when asked', async () => {
    const cancelled = await start('outcomeWait', ['c']);
    const row = await stack.escalationFor(cancelled.workflowId);
    expect((await stack.api('POST', `/api/escalations/${row.id}/cancel`)).status).toBe(200);
    expect(await cancelled.result()).toMatchObject({ status: 'cancelled', escalationId: row.id });

    const resolved = await start('resolutionWait', ['r']);
    const asked = await stack.escalationFor(resolved.workflowId);
    await stack.api('POST', `/api/escalations/${asked.id}/resolve`, { resolverPayload: { approved: true } });
    const value = await resolved.result();
    expect(value).toMatchObject({ approved: true, $resolution: { escalationId: asked.id, resolvedBy: stack.adminUserId } });
    expect(Date.parse(value.$resolution.resolvedAt)).not.toBeNaN();
  });

  it('calls a built-in Long Tail MCP tool from a workflow', async () => {
    const handle = await start('toolCall', ['long-tail-admin', 'find_escalations', { role: 'reviewer', limit: 1 }]);
    const result = await handle.result();
    expect(result).toMatchObject({ total: expect.any(Number) });
  });
});
