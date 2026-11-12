import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';

import * as exampleActivities from '../../examples/review-order/activities';
import { temporalProvider } from '../../src/provider';
import { bundlerOptions } from '../helpers/bundle';
import { fakeActivities, outcome } from '../helpers/fake-activities';

const TASK_QUEUE = 'provider-test';
let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
const fake = fakeActivities();
let n = 0;
const nextId = () => `p-${Date.now()}-${++n}`;

async function waitForOpen(workflowId: string) {
  for (let i = 0; i < 200; i++) {
    const open = fake.opened.find((o) => o.workflowId === workflowId);
    if (open) return open;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no ltOpen for ${workflowId}`);
}

describe('temporalProvider (local dev server)', () => {
  let provider: ReturnType<typeof temporalProvider>;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
    worker = await Worker.create({
      connection: env.nativeConnection, taskQueue: TASK_QUEUE, bundlerOptions,
      workflowsPath: path.resolve(__dirname, '../workflows/all.ts'),
      activities: { ...exampleActivities, ...fake.activities },
    });
    running = worker.run();
    provider = temporalProvider({ client: env.client });
  });

  afterAll(async () => {
    worker.shutdown();
    await running;
    await env.teardown();
  });

  it('is a non-native provider with execution and terminate', () => {
    expect(provider.name).toBe('temporal');
    expect(provider.capabilities).toEqual({ native: false, execution: true, terminate: true });
  });

  it('delivers an outcome as the lt.outcome signal to the waiting run', async () => {
    const handle = await env.client.workflow.start('singleWait', { taskQueue: TASK_QUEUE, workflowId: nextId(), args: ['k'] });
    const open = await waitForOpen(handle.workflowId);
    const ref = { provider: 'temporal', workflowId: open.workflowId, runScope: open.runScope, waitKey: 'k' };
    expect(await provider.deliver(ref, outcome('k', 'resolved', { approved: true }))).toBe('delivered');
    expect(await handle.result()).toEqual({ value: { approved: true }, status: 'resolved' });
  });

  it('reports gone for a closed run and an unknown workflow', async () => {
    const handle = await env.client.workflow.start('singleWait', { taskQueue: TASK_QUEUE, workflowId: nextId(), args: ['k'] });
    const open = await waitForOpen(handle.workflowId);
    await handle.terminate('done');
    const ref = { provider: 'temporal', workflowId: open.workflowId, runScope: open.runScope, waitKey: 'k' };
    expect(await provider.deliver(ref, outcome('k', 'resolved'))).toBe('gone');
    expect(await provider.deliver({ ...ref, workflowId: 'never-started', runScope: '' }, outcome('k', 'resolved'))).toBe('gone');
  });

  it('describes running, terminated and unknown workflows', async () => {
    const handle = await env.client.workflow.start('singleWait', { taskQueue: TASK_QUEUE, workflowId: nextId(), args: ['k'] });
    await waitForOpen(handle.workflowId);
    expect(await provider.describe(handle.workflowId)).toMatchObject({ state: 'running', workflowType: 'singleWait', providerState: 'RUNNING' });
    await provider.terminate!(handle.workflowId, 'test');
    expect((await provider.describe(handle.workflowId)).state).toBe('terminated');
    expect((await provider.describe('never-started')).state).toBe('unknown');
  });

  it('exports a reviewOrder run as a timeline with the escalation wait', async () => {
    const workflowId = nextId();
    const handle = await env.client.workflow.start('reviewOrder', { taskQueue: TASK_QUEUE, workflowId, args: [workflowId] });
    const open = await waitForOpen(workflowId);
    await provider.deliver({ provider: 'temporal', workflowId, runScope: open.runScope, waitKey: open.waitKey },
      outcome(open.waitKey, 'resolved', { approved: true }));
    await handle.result();
    const execution = await provider.export!(workflowId);
    expect(execution).toMatchObject({ workflow_id: workflowId, workflow_type: 'reviewOrder', status: 'completed' });
    const types = execution.events.map((e) => e.event_type);
    expect(types).toEqual(expect.arrayContaining(['workflow_execution_started', 'activity_task_scheduled', 'timer_started',
      'signal_wait_started', 'workflow_execution_signaled', 'workflow_execution_completed']));
  });

  it('fails loud without an address', () => {
    expect(() => temporalProvider({})).toThrow(/address/);
  });
});
