import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { WorkflowFailedError } from '@temporalio/client';

import { LT_OUTCOME_SIGNAL } from '../../src/constants';
import { fakeActivities, outcome } from '../helpers/fake-activities';

const TASK_QUEUE = 'conditional-test';
let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
const fake = fakeActivities();
let n = 0;
const nextId = () => `wf-${Date.now()}-${++n}`;

describe('conditional (workflow)', () => {
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: path.resolve(__dirname, '../workflows/conditional-workflows.ts'),
      activities: fake.activities,
    });
    running = worker.run();
  });

  afterAll(async () => {
    worker.shutdown();
    await running;
    await env.teardown();
  });

  const start = (args: unknown[], workflowId = nextId(), workflow = 'singleWait') =>
    env.client.workflow.start(workflow, { taskQueue: TASK_QUEUE, workflowId, args });

  it('opens the wait with workflow identity and returns the resolved payload', async () => {
    const handle = await start(['review']);
    await waitForOpen(handle.workflowId, 'review');
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('review', 'resolved', { approved: true }));
    expect(await handle.result()).toEqual({ value: { approved: true }, status: 'resolved' });
    const open = fake.opened.find((o) => o.workflowId === handle.workflowId)!;
    expect(open).toMatchObject({ waitKey: 'review', workflowType: 'singleWait', role: 'reviewer', type: 'decision' });
    expect(open.runScope).toBe(handle.firstExecutionRunId);
  });

  it('keeps an outcome that arrives before the handler', async () => {
    const workflowId = nextId();
    const handle = await env.client.workflow.signalWithStart('singleWait', {
      taskQueue: TASK_QUEUE, workflowId, args: ['early'],
      signal: LT_OUTCOME_SIGNAL, signalArgs: [outcome('early', 'resolved', { approved: false })],
    });
    expect(await handle.result()).toEqual({ value: { approved: false }, status: 'resolved' });
  });

  it('returns null when expired or cancelled', async () => {
    for (const status of ['expired', 'cancelled'] as const) {
      const handle = await start(['k']);
      await waitForOpen(handle.workflowId, 'k');
      await handle.signal(LT_OUTCOME_SIGNAL, outcome('k', status));
      expect(await handle.result()).toEqual({ value: null, status });
    }
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
    expect(await b.result()).toEqual({ value: null, status: 'expired' });
  });

  it('turns the timeout into expiresAt and fails on a malformed timeout', async () => {
    const handle = await start(['sla', '48h']);
    await waitForOpen(handle.workflowId, 'sla');
    const open = fake.opened.find((o) => o.workflowId === handle.workflowId)!;
    const hours = (Date.parse(open.expiresAt!) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(40);
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('sla', 'resolved', {}));
    await handle.result();

    const bad = await start(['bad', 'soon']);
    await expect(bad.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fake.opened.some((o) => o.workflowId === bad.workflowId)).toBe(false);
  });

  it('closes the escalation when the workflow is cancelled', async () => {
    const handle = await start(['bye']);
    await waitForOpen(handle.workflowId, 'bye');
    await handle.cancel();
    await expect(handle.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(fake.closed).toContainEqual({ escalationId: `esc-${handle.workflowId}-bye` });
  });
});

async function waitForOpen(workflowId: string, waitKey: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (fake.opened.some((o) => o.workflowId === workflowId && o.waitKey === waitKey)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`ltOpen never ran for ${workflowId}/${waitKey}`);
}
