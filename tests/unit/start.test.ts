import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const start = vi.fn().mockResolvedValue({ shutdown: vi.fn() });
vi.mock('@hotmeshio/long-tail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hotmeshio/long-tail')>()),
  start: (...args: unknown[]) => start(...args),
}));

import { startLongTailTemporal } from '../../src/start';

function writeConfig(body: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'lt-temporal-')), 'longtail.json');
  writeFileSync(path, JSON.stringify(body));
  return path;
}

describe('startLongTailTemporal', () => {
  beforeEach(() => start.mockClear());

  it('starts Long Tail with the Temporal provider and a namespaced console link', async () => {
    await startLongTailTemporal({
      TEMPORAL_ADDRESS: 'temporal:7233', TEMPORAL_NAMESPACE: 'orders', TEMPORAL_UI_URL: 'http://localhost:8233/',
      DATABASE_URL: 'postgres://u:p@db/lt', PORT: '3000', JWT_SECRET: 's',
    });
    const config = start.mock.calls[0][0];
    expect(config.durable.provider.name).toBe('temporal');
    expect(config.durable.consoleUrl).toBe('http://localhost:8233/namespaces/orders/workflows/{workflowId}');
    expect(config.database).toEqual({ connectionString: 'postgres://u:p@db/lt' });
    expect(config.server).toEqual({ port: 3000 });
    expect(config.auth).toEqual({ secret: 's' });
    expect(config.workers).toBeUndefined();
  });

  it('builds the database from POSTGRES_* and omits the console link without a UI', async () => {
    await startLongTailTemporal({ TEMPORAL_ADDRESS: 'temporal:7233', POSTGRES_HOST: 'db', POSTGRES_PORT: '5432', POSTGRES_DB: 'lt' });
    const config = start.mock.calls[0][0];
    expect(config.database).toMatchObject({ host: 'db', port: 5432, database: 'lt' });
    expect(config.durable.consoleUrl).toBeUndefined();
  });

  it('seeds the admin and declares roles from the environment', async () => {
    await startLongTailTemporal({ TEMPORAL_ADDRESS: 't:7233', LT_ADMIN_PASSWORD: 'pw', LT_ROLES: 'reviewer, approver' });
    const config = start.mock.calls[0][0];
    expect(config.seed).toEqual({ admin: { externalId: 'superadmin', email: undefined, password: 'pw' } });
    expect(config.roles).toEqual([{ role: 'reviewer' }, { role: 'approver' }]);
  });

  it('merges LT_START_CONFIG and lets the environment win', async () => {
    const path = writeConfig({ roles: [{ role: 'reviewer', title: 'Reviewer' }], seed: { admin: { externalId: 'ops', password: 'pw' } } });
    await startLongTailTemporal({ TEMPORAL_ADDRESS: 't:7233', LT_START_CONFIG: path, LT_ROLES: 'approver' });
    const config = start.mock.calls[0][0];
    expect(config.seed).toEqual({ admin: { externalId: 'ops', password: 'pw' } });
    expect(config.roles).toEqual([{ role: 'approver' }]);
  });

  it('passes workers from LT_START_CONFIG through, to register workflows for invoke', async () => {
    const workers = [{ taskQueue: 'orders', workflow: 'reviewOrderRequest', config: { invocable: true } }];
    await startLongTailTemporal({ TEMPORAL_ADDRESS: 't:7233', LT_START_CONFIG: writeConfig({ workers }) });
    expect(start.mock.calls[0][0].workers).toEqual(workers);
  });

  it('rejects LT_START_CONFIG keys the environment owns', async () => {
    const path = writeConfig({ examples: true });
    await expect(startLongTailTemporal({ TEMPORAL_ADDRESS: 't:7233', LT_START_CONFIG: path })).rejects.toThrow(/examples/);
    expect(start).not.toHaveBeenCalled();
  });

  it('fails loud without TEMPORAL_ADDRESS', async () => {
    await expect(startLongTailTemporal({})).rejects.toThrow(/TEMPORAL_ADDRESS/);
    expect(start).not.toHaveBeenCalled();
  });
});
