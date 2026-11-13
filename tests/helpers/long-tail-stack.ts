import { Client as Pg } from 'pg';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { start, signToken } from '@hotmeshio/long-tail';

import { longTailActivities, longTailTools } from '../../src/worker';
import { temporalProvider } from '../../src/provider';
import { bundlerOptions } from './bundle';

// Postgres from this repo's docker compose; the integration suites own their own database.
const PG = { host: 'localhost', port: Number(process.env.PG_PORT ?? 5426), user: 'postgres', password: 'password' };
const DATABASE = 'lt_temporal_e2e';
const PORT = 4519;
export const BASE = `http://localhost:${PORT}`;
const JWT_SECRET = 'lt-temporal-e2e-secret';

type StartConfig = Parameters<typeof start>[0];

export interface StackOptions {
  taskQueue: string;
  workflowsPath: string;
  activities?: Record<string, (...args: any[]) => Promise<unknown>>;
  roles?: StartConfig['roles'];
  workers?: StartConfig['workers'];
}

async function ensureDatabase(): Promise<void> {
  const admin = new Pg({ ...PG, database: 'postgres' });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);
  if (!rowCount) await admin.query(`CREATE DATABASE ${DATABASE}`);
  await admin.end();
}

/** Long Tail in process on the Temporal provider, a local Temporal, and one worker with the Long Tail activities. */
export async function startLongTailStack(options: StackOptions) {
  await ensureDatabase();
  const env = await TestWorkflowEnvironment.createLocal();
  const longTail = await start({
    database: { ...PG, database: DATABASE },
    server: { port: PORT },
    auth: { secret: JWT_SECRET },
    seed: { admin: { externalId: 'e2e-admin', email: 'e2e-admin@example.com' } },
    roles: options.roles ?? [{ role: 'reviewer', title: 'Reviewer' }],
    workers: options.workers,
    durable: { provider: temporalProvider({ client: env.client }), relay: { sweepMs: 300, reconcileMs: 0 } },
  });
  const adminUserId = longTail.adminUserId!;
  const token = signToken({ userId: adminUserId, role: 'superadmin' });
  const worker = await Worker.create({
    connection: env.nativeConnection, taskQueue: options.taskQueue, bundlerOptions, workflowsPath: options.workflowsPath,
    activities: { ...options.activities, ...longTailActivities({ url: BASE, apiKey: token }), ...longTailTools({ url: BASE, apiKey: token }) },
  });
  const workerRun = worker.run();

  async function api<T = any>(method: string, route: string, body?: unknown): Promise<{ status: number; data: T }> {
    const response = await fetch(`${BASE}${route}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() as T };
  }

  /** The first escalation a workflow opened, once it exists. */
  async function escalationFor(workflowId: string, matches: (row: any) => boolean = () => true): Promise<any> {
    for (let i = 0; i < 200; i++) {
      const { data } = await api<any>('GET', `/api/escalations/by-workflow/${encodeURIComponent(workflowId)}`);
      const rows: any[] = Array.isArray(data) ? data : data?.escalations ?? [];
      const row = rows.find(matches);
      if (row) return row;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no escalation for ${workflowId}`);
  }

  async function shutdown() {
    worker.shutdown();
    await workerRun;
    await longTail.shutdown();
    await env.teardown();
  }

  return { env, adminUserId, api, escalationFor, shutdown };
}

export type LongTailStack = Awaited<ReturnType<typeof startLongTailStack>>;
