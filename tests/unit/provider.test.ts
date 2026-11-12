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
  throw new Error(`no lt.open for ${workflowId}`);
}

async function eventually<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for visibility');
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

  it('is a non-native provider with execution, terminate and list', () => {
    expect(provider.name).toBe('temporal');
    expect(provider.capabilities).toEqual({ native: false, execution: true, terminate: true, list: true });
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

  it('lists by id prefix, type and state, with a total from the count', async () => {
    const prefix = `list-${Date.now()}`;
    const ids = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`];
    for (const id of ids) await env.client.workflow.start('singleWait', { taskQueue: TASK_QUEUE, workflowId: id, args: ['k'] });
    await Promise.all(ids.map(waitForOpen));
    await env.client.workflow.getHandle(ids[0]).terminate('done');

    // Visibility is eventually consistent.
    const all = await eventually(async () => {
      const page = await provider.list!({ limit: 10, offset: 0, idPrefix: prefix });
      return page.total === 3 && page.workflows.some((w) => w.state === 'terminated') ? page : undefined;
    });
    expect(all.workflows.map((w) => w.workflowId).sort()).toEqual(ids);
    expect(all.workflows.every((w) => w.workflowType === 'singleWait')).toBe(true);

    const running = await provider.list!({ limit: 10, offset: 0, idPrefix: prefix, state: 'running' });
    expect(running.total).toBe(2);
    expect(running.workflows.every((w) => w.providerState === 'RUNNING')).toBe(true);
    expect(await provider.list!({ limit: 10, offset: 0, idPrefix: prefix, state: 'failed' })).toMatchObject({ total: 1, workflows: [{ workflowId: ids[0] }] });
    expect((await provider.list!({ limit: 10, offset: 0, idPrefix: prefix, workflowType: 'reviewOrder' })).total).toBe(0);

    const first = await provider.list!({ limit: 2, offset: 0, idPrefix: prefix });
    const second = await provider.list!({ limit: 2, offset: 2, idPrefix: prefix });
    expect([...first.workflows, ...second.workflows].map((w) => w.workflowId).sort()).toEqual(ids);
    expect([first.workflows.length, second.workflows.length, second.total]).toEqual([2, 1, 3]);
  });

  it('fails loud without an address', () => {
    expect(() => temporalProvider({})).toThrow(/address/);
  });
});
