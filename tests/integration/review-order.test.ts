import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Pg } from 'pg';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { start, signToken } from '@hotmeshio/long-tail';

import * as exampleActivities from '../../examples/review-order/activities';
import { longTailActivities } from '../../src/worker';
import { temporalProvider } from '../../src/provider';
import { bundlerOptions, REVIEW_WORKFLOWS } from '../helpers/bundle';

// Postgres from long-tail's docker compose; this suite owns its own database.
const PG = { host: 'localhost', port: 5415, user: 'postgres', password: 'password' };
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

  it('hides HotMesh-only routes', async () => {
    const { status, data } = await api<any>('GET', '/api/controlplane/apps');
    expect(status).toBe(501);
    expect(data.error).toMatch(/runs temporal/);
  });
});

