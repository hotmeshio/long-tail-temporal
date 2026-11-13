import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { api, login, waitFor, workflowResult } from '../helpers/compose-stack';

// Passes on a fresh stack and on one reused from an earlier run: every arming is a new cron job.
const TYPE = 'countPendingReviews';
const EVERY_MINUTE = '* * * * *';
const EVERY_MINUTE_RESTATED = '*/1 * * * *';
const RUN_WAIT_MS = 150_000;
const SAVED_KEYS = [
  'invocable', 'task_queue', 'default_role', 'description', 'roles', 'invocation_roles', 'consumes', 'tool_tags',
  'envelope_schema', 'input_schema', 'icon', 'input_lookups', 'resolver_schema',
] as const;

let base: Record<string, unknown>;

async function saveConfig(changes: Record<string, unknown>): Promise<void> {
  const saved = await api('PUT', `/api/workflows/${TYPE}/config`, { ...base, ...changes });
  expect(saved.status).toBe(200);
}

/** The first scheduled run that started after `since`, once it has completed. */
async function scheduledRunAfter(since: number): Promise<{ workflowId: string; result: any }> {
  const workflowId = await waitFor(`a scheduled ${TYPE} run after ${new Date(since).toISOString()}`, async () => {
    const { data } = await api<any>('GET', `/api/workflow-states/jobs?search=${TYPE}-cron-&limit=100`);
    const runs: any[] = (data.jobs ?? []).filter((job: any) => Date.parse(job.created_at) > since);
    runs.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return runs[0]?.workflow_id as string | undefined;
  }, RUN_WAIT_MS);
  return { workflowId, result: await workflowResult(workflowId) };
}

async function cronActive(): Promise<boolean> {
  const { data } = await api<any>('GET', '/api/workflows/cron/status');
  return (data.schedules ?? []).some((s: any) => s.workflow_type === TYPE && s.active);
}

describe('workflow schedules on Temporal (compose stack)', () => {
  beforeAll(async () => {
    await login();
    const { status, data } = await api<any>('GET', `/api/workflows/${TYPE}/config`);
    expect(status).toBe(200);
    base = Object.fromEntries(SAVED_KEYS.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
  });

  afterAll(async () => {
    await saveConfig({ cron_schedule: null });
  });

  it('runs on its schedule, and the run calls the MCP tool', async () => {
    const since = Date.now();
    await saveConfig({ cron_schedule: EVERY_MINUTE });
    expect(await cronActive()).toBe(true);
    const { workflowId, result } = await scheduledRunAfter(since);
    expect(workflowId).toMatch(new RegExp(`^${TYPE}-cron-`));
    expect(result).toEqual({ data: { role: 'reviewer', pending: expect.any(Number) } });
  });

  it('keeps running after a save that leaves the schedule as it was', async () => {
    const since = Date.now();
    await saveConfig({ cron_schedule: EVERY_MINUTE, description: `Saved ${new Date(since).toISOString()}` });
    await scheduledRunAfter(since);
  });

  it('runs again after the schedule is turned off and on', async () => {
    await saveConfig({ cron_schedule: null });
    expect(await cronActive()).toBe(false);
    const since = Date.now();
    await saveConfig({ cron_schedule: EVERY_MINUTE });
    await scheduledRunAfter(since);
  });

  it('runs on a changed schedule', async () => {
    const since = Date.now();
    await saveConfig({ cron_schedule: EVERY_MINUTE_RESTATED });
    await scheduledRunAfter(since);
  });
});
