import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Pg } from 'pg';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { start, signToken } from '@hotmeshio/long-tail';

import * as exampleActivities from '../../examples/review-order/activities';
import { longTailActivities } from '../../src/worker';
import { temporalProvider } from '../../src/provider';
import { bundlerOptions, REVIEW_WORKFLOWS } from '../helpers/bundle';

// Postgres from this repo's docker compose; this suite owns its own database.
const PG = { host: 'localhost', port: Number(process.env.PG_PORT ?? 5426), user: 'postgres', password: 'password' };
const DATABASE = 'lt_temporal_e2e';
const PORT = 4519;
const BASE = `http://localhost:${PORT}`;
const TASK_QUEUE = 'orders-e2e';
const JWT_SECRET = 'lt-temporal-e2e-secret';

let env: TestWorkflowEnvironment;
let worker: Worker;
let workerRun: Promise<void>;
let longTail: Awaited<ReturnType<typeof start>>;
let token: string;

async function ensureDatabase(): Promise<void> {
  const admin = new Pg({ ...PG, database: 'postgres' });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);
  if (!rowCount) await admin.query(`CREATE DATABASE ${DATABASE}`);
  await admin.end();
}

async function api<T = any>(method: string, route: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() as T };
}

async function escalationFor(workflowId: string): Promise<any> {
  for (let i = 0; i < 200; i++) {
    const { data } = await api<any>('GET', `/api/escalations/by-workflow/${encodeURIComponent(workflowId)}`);
    const rows = Array.isArray(data) ? data : data?.escalations ?? [];
    if (rows.length) return rows[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no escalation for ${workflowId}`);
}

describe('reviewOrder on Temporal with Long Tail (end to end)', () => {
  beforeAll(async () => {
    await ensureDatabase();
    env = await TestWorkflowEnvironment.createLocal();
    longTail = await start({
      database: { ...PG, database: DATABASE },
      server: { port: PORT },
      auth: { secret: JWT_SECRET },
      seed: { admin: { externalId: 'e2e-admin', email: 'e2e-admin@example.com' } },
      roles: [{ role: 'reviewer', title: 'Reviewer' }],
      workers: [{
        taskQueue: TASK_QUEUE,
        workflow: 'reviewOrderRequest',
        config: {
          invocable: true,
          invocationRoles: ['reviewer'],
          inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
        },
      }],
      durable: {
        provider: temporalProvider({ client: env.client }),
        relay: { sweepMs: 300, reconcileMs: 0 },
      },
    });
    token = signToken({ userId: longTail.adminUserId!, role: 'superadmin' });
    worker = await Worker.create({
      connection: env.nativeConnection, taskQueue: TASK_QUEUE, bundlerOptions,
      workflowsPath: REVIEW_WORKFLOWS,
      activities: { ...exampleActivities, ...longTailActivities({ url: BASE, apiKey: token }) },
    });
    workerRun = worker.run();
  });

  afterAll(async () => {
    worker?.shutdown();
    await workerRun;
    await longTail?.shutdown();
    await env?.teardown();
  });

  it('resolves through the API and the workflow completes with the payload', async () => {
    const workflowId = `order-${Date.now()}`;
    const handle = await env.client.workflow.start('reviewOrder', { taskQueue: TASK_QUEUE, workflowId, args: [workflowId] });

    const escalation = await escalationFor(workflowId);
    expect(escalation).toMatchObject({ role: 'reviewer', type: 'order-review', status: 'pending', workflow_type: 'reviewOrder' });
    expect(escalation.metadata).toMatchObject({ orderId: workflowId });

    const resolved = await api('POST', `/api/escalations/${escalation.id}/resolve`, { resolverPayload: { approved: true, notes: 'ok to ship' } });
    expect(resolved.status).toBe(200);

    expect(await handle.result()).toEqual({ orderId: workflowId, status: `shipped ${workflowId}`, notes: 'ok to ship' });

    const execution = await api<any>('GET', `/api/workflow-states/${workflowId}/execution`);
    expect(execution.status).toBe(200);
    const types = execution.data.events.map((e: any) => e.event_type);
    expect(types).toEqual(expect.arrayContaining(['signal_wait_started', 'workflow_execution_signaled']));
    expect(execution.data.status).toBe('completed');

    const described = await api<any>('GET', `/api/workflows/${workflowId}/describe`);
    expect(described.data).toMatchObject({ workflowId, state: 'completed', workflowType: 'reviewOrder' });
  });

  it('expires the escalation after its SLA and the workflow receives null', async () => {
    const workflowId = `order-sla-${Date.now()}`;
    const handle = await env.client.workflow.start('reviewOrder', { taskQueue: TASK_QUEUE, workflowId, args: [workflowId, '2s'] });
    const escalation = await escalationFor(workflowId);
    expect(await handle.result()).toEqual({ orderId: workflowId, status: 'expired-or-cancelled' });
    const { data } = await api<any>('GET', `/api/escalations/${escalation.id}`);
    expect((data.escalation ?? data).status).toBe('expired');
  });

  it('closes the workflow wait when a person cancels the escalation', async () => {
    const workflowId = `order-cancel-${Date.now()}`;
    const handle = await env.client.workflow.start('reviewOrder', { taskQueue: TASK_QUEUE, workflowId, args: [workflowId] });
    const escalation = await escalationFor(workflowId);
    expect((await api('POST', `/api/escalations/${escalation.id}/cancel`)).status).toBe(200);
    expect(await handle.result()).toEqual({ orderId: workflowId, status: 'expired-or-cancelled' });
  });

  it('registers a workflow from start() and invokes it with the envelope', async () => {
    const workflowId = `order-invoked-${Date.now()}`;

    const configs = await api<any>('GET', '/api/workflows/config');
    expect(configs.status).toBe(200);
    expect(JSON.stringify(configs.data)).toContain('reviewOrderRequest');

    const invoked = await api<any>('POST', '/api/workflows/reviewOrderRequest/invoke', {
      data: { orderId: workflowId }, metadata: { source: 'e2e' }, workflowId,
    });
    expect(invoked).toEqual({ status: 202, data: { workflowId, message: 'Workflow started' } });

    const escalation = await escalationFor(workflowId);
    expect(escalation).toMatchObject({ role: 'reviewer', status: 'pending', workflow_type: 'reviewOrderRequest' });
    expect((await api<any>('GET', `/api/workflows/${workflowId}/result`)).status).toBe(202);

    await api('POST', `/api/escalations/${escalation.id}/resolve`, { resolverPayload: { approved: true } });
    const result = await env.client.workflow.getHandle(workflowId).result();
    expect(result).toEqual({ data: { orderId: workflowId, status: `shipped ${workflowId}` } });

    const history = await env.client.workflow.getHandle(workflowId).fetchHistory();
    const input = history.events?.[0]?.workflowExecutionStartedEventAttributes?.input?.payloads?.[0]?.data;
    const envelope = JSON.parse(Buffer.from(input as Uint8Array).toString());
    expect(envelope).toMatchObject({ data: { orderId: workflowId }, metadata: { source: 'e2e' }, lt: { scopes: ['workflow:invoke'] } });

    const read = await api<any>('GET', `/api/workflows/${workflowId}/result`);
    expect(read).toMatchObject({ status: 200, data: { state: 'completed', result: { data: { status: `shipped ${workflowId}` } } } });
  });

  const envelope = (data: Record<string, unknown>) => ({ data, metadata: {}, lt: {} });
  const startCollection = (workflow: string, data: Record<string, unknown>) =>
    env.client.workflow.start(workflow, { taskQueue: TASK_QUEUE, workflowId: String(data.orderId), args: [envelope(data)] });

  it('fills a batch wait one item at a time and returns every item', async () => {
    const orderId = `inspect-${Date.now()}`;
    const handle = await startCollection('inspectOrderRequest', { orderId });
    const escalation = await escalationFor(orderId);
    expect(escalation.metadata).toMatchObject({ orderId, batch_pending: ['left', 'right'] });

    const left = await api<any>('POST', `/api/escalations/${escalation.id}/resolve-batch-item`, { itemKey: 'left', resolverPayload: { passed: true } });
    expect(left.status).toBe(200);
    await api('POST', `/api/escalations/${escalation.id}/resolve-batch-item`, { itemKey: 'right', resolverPayload: { passed: false } });
    expect(await handle.result()).toEqual({ data: { orderId, sides: { left: { passed: true }, right: { passed: false } } } });
  });

  it('returns the sides inspected so far when the batch expires', async () => {
    const orderId = `inspect-partial-${Date.now()}`;
    const handle = await startCollection('inspectOrderRequest', { orderId, timeout: '3s' });
    const escalation = await escalationFor(orderId);
    await api('POST', `/api/escalations/${escalation.id}/resolve-batch-item`, { itemKey: 'left', resolverPayload: { passed: true } });
    expect(await handle.result()).toEqual({ data: { orderId, sides: { left: { passed: true }, $trigger: 'timeout' } } });
  });

  it('accumulates approvals until the count is reached', async () => {
    const orderId = `approvals-${Date.now()}`;
    const handle = await startCollection('collectApprovalsRequest', { orderId, approvals: 2 });
    const escalation = await escalationFor(orderId);
    for (const approver of ['ana', 'ben']) {
      const added = await api<any>('POST', `/api/escalations/${escalation.id}/accumulate`, { itemKey: approver, payload: { approver } });
      expect(added.status).toBe(200);
    }
    expect(await handle.result()).toEqual({ data: { orderId, trigger: 'count', approvers: ['ana', 'ben'] } });
  });

  it('returns the approvals so far when the accumulator expires', async () => {
    const orderId = `approvals-timeout-${Date.now()}`;
    const handle = await startCollection('collectApprovalsRequest', { orderId, approvals: 5, timeout: '3s' });
    const escalation = await escalationFor(orderId);
    await api('POST', `/api/escalations/${escalation.id}/accumulate`, { itemKey: 'ana', payload: { approver: 'ana' } });
    expect(await handle.result()).toEqual({ data: { orderId, trigger: 'timeout', approvers: ['ana'] } });
  });

  it('refuses to invoke a workflow with no registered config', async () => {
    const { status, data } = await api<any>('POST', '/api/workflows/reviewOrder/invoke', { data: { orderId: 'x' } });
    expect(status).toBe(404);
    expect(data.error).toMatch(/register a config/);
  });

  it('hides HotMesh-only routes', async () => {
    const { status, data } = await api<any>('GET', '/api/controlplane/apps');
    expect(status).toBe(501);
    expect(data.error).toMatch(/runs temporal/);
  });
});

