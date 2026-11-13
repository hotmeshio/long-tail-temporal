import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WorkflowFailedError } from '@temporalio/client';

import { LT_OUTCOME_SIGNAL } from '../../src/constants';
import { outcome } from '../helpers/fake-activities';
import { startWorkflowEnv, type WorkflowEnv } from '../helpers/workflow-env';

let wf: WorkflowEnv;
const fake = () => wf.fake;
const nextId = () => wf.nextId();
const waitForOpen = (workflowId: string, waitKey: string) => wf.waitForOpen(workflowId, waitKey);

describe('conditional (workflow)', () => {
  beforeAll(async () => {
    wf = await startWorkflowEnv(path.resolve(__dirname, '../workflows/conditional-workflows.ts'), 'conditional-test');
  });

  afterAll(async () => {
    await wf.shutdown();
  });

  const start = (args: unknown[], workflowId = nextId(), workflow = 'singleWait') => wf.start(workflow, args, workflowId);

  it('opens the wait with workflow identity and returns the resolved payload', async () => {
    const handle = await start(['review']);
    await waitForOpen(handle.workflowId, 'review');
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('review', 'resolved', { approved: true }));
    expect(await handle.result()).toEqual({ value: { approved: true }, status: 'resolved' });
    const open = fake().opened.find((o) => o.workflowId === handle.workflowId)!;
    expect(open).toMatchObject({ waitKey: 'review', workflowType: 'singleWait', role: 'reviewer', type: 'decision' });
    expect(open.runScope).toBe(handle.firstExecutionRunId);
  });

  it('keeps an outcome that arrives before the handler', async () => {
    const workflowId = nextId();
    const handle = await wf.env.client.workflow.signalWithStart('singleWait', {
      taskQueue: 'conditional-test', workflowId, args: ['early'],
      signal: LT_OUTCOME_SIGNAL, signalArgs: [outcome('early', 'resolved', { approved: false })],
    });
    expect(await handle.result()).toEqual({ value: { approved: false }, status: 'resolved' });
  });

  it('returns false when expired and null when cancelled', async () => {
    for (const [status, value] of [['expired', false], ['cancelled', null]] as const) {
      const handle = await start(['k']);
      await waitForOpen(handle.workflowId, 'k');
      await handle.signal(LT_OUTCOME_SIGNAL, outcome('k', status));
      expect(await handle.result()).toEqual({ value, status });
    }
  });

  it('sends the batch declaration to lt.open', async () => {
    const handle = await start(['batch'], nextId(), 'batchWait');
    await waitForOpen(handle.workflowId, 'batch');
    expect(fake().opened.find((o) => o.workflowId === handle.workflowId)).toMatchObject({ batch: ['left', 'right'], partialOnTimeout: true, wakeOnFill: ['left'] });
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('batch', 'resolved', { left: { passed: true }, right: { passed: false } }));
    expect(await handle.result()).toEqual({ value: { left: { passed: true }, right: { passed: false } }, status: 'resolved' });
  });

  it('returns the collection an expiry kept', async () => {
    const kept = await start(['partial'], nextId(), 'batchWait');
    await waitForOpen(kept.workflowId, 'partial');
    await kept.signal(LT_OUTCOME_SIGNAL, outcome('partial', 'expired', { left: { passed: true }, $trigger: 'timeout' }));
    expect(await kept.result()).toEqual({ value: { left: { passed: true }, $trigger: 'timeout' }, status: 'expired' });
  });

  it('keeps the first outcome and ignores a duplicate', async () => {
    const handle = await start(['dup']);
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('dup', 'resolved', { approved: true }));
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('dup', 'cancelled'));
    expect(await handle.result()).toEqual({ value: { approved: true }, status: 'resolved' });
  });

  it('matches outcomes to keys across sequential waits', async () => {
    const handle = await start([], nextId(), 'twoWaits');
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('second', 'resolved', { n: 2 }));
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('first', 'resolved', { n: 1 }));
    expect(await handle.result()).toEqual({ first: { n: 1 }, second: { n: 2 } });
  });

  it('keeps outcomes per workflow: the same key in two workflows stays separate', async () => {
    const a = await start(['shared']);
    const b = await start(['shared']);
    await waitForOpen(a.workflowId, 'shared');
    await waitForOpen(b.workflowId, 'shared');
    await a.signal(LT_OUTCOME_SIGNAL, outcome('shared', 'resolved', { approved: true }));
    await b.signal(LT_OUTCOME_SIGNAL, outcome('shared', 'expired'));
    expect(await a.result()).toEqual({ value: { approved: true }, status: 'resolved' });
    expect(await b.result()).toEqual({ value: false, status: 'expired' });
  });

  it('turns the timeout into expiresAt and fails on a malformed timeout', async () => {
    const handle = await start(['sla', '48h']);
    await waitForOpen(handle.workflowId, 'sla');
    const open = fake().opened.find((o) => o.workflowId === handle.workflowId)!;
    const hours = (Date.parse(open.expiresAt!) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(40);
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('sla', 'resolved', {}));
    await handle.result();

    const bad = await start(['bad', 'soon']);
    await expect(bad.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fake().opened.some((o) => o.workflowId === bad.workflowId)).toBe(false);
  });

  it('closes the escalation when the workflow is cancelled', async () => {
    const handle = await start(['bye']);
    await waitForOpen(handle.workflowId, 'bye');
    await handle.cancel();
    await expect(handle.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fake().closed).toContainEqual({ escalationId: `esc-${handle.workflowId}-bye` });
  });
});
