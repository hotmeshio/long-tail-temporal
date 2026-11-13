import { describe, it, expect, afterEach } from 'vitest';

import { ApplicationFailure } from '@temporalio/common';

import { longTailActivities, LongTailHttpError } from '../../src/worker';
import { startServer } from '../helpers/http-server';

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

const OPEN = { workflowId: 'wf', runScope: 'run', workflowType: 'reviewOrder', waitKey: 'k', role: 'reviewer', type: 'review' };

describe('longTailActivities', () => {
  it('lt.open posts the wait and returns the escalation', async () => {
    server = await startServer(() => ({ status: 201, body: { escalationId: 'e1', status: 'pending', created: true } }));
    const { 'lt.open': ltOpen } = longTailActivities({ url: server.url, apiKey: 'lt_bot_k' });
    expect(await ltOpen(OPEN)).toEqual({ escalationId: 'e1', status: 'pending', created: true });
    expect(server.requests[0]).toMatchObject({ url: '/api/escalations/waits', body: OPEN });
  });

  it('lt.open forwards the escalation fields as given', async () => {
    server = await startServer(() => ({ status: 201, body: { escalationId: 'e2', status: 'pending', created: true } }));
    const { 'lt.open': ltOpen } = longTailActivities({ url: server.url, apiKey: 'k' });
    const fields = {
      envelope: { formDefaults: { notes: 'x' } }, lookups: [{ domain: 'd', key: 'k' }], files: [{ path: 'a.pdf', as: 'doc' }],
      schemaVersion: 2, assignee: 'u1', durationMinutes: 5, originId: 'o', parentId: 'p', signalKey: 'sk',
    };
    await ltOpen({ ...OPEN, ...fields });
    expect(server.requests[0].body).toEqual({ ...OPEN, ...fields });
  });

  it('lt.open fails a refusal at once with its status and body', async () => {
    server = await startServer(() => ({ status: 409, body: { error: 'signal key sk is held by another escalation' } }));
    const { 'lt.open': ltOpen } = longTailActivities({ url: server.url, apiKey: 'k' });
    const err = await ltOpen(OPEN).catch((e) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(err).toMatchObject({ nonRetryable: true, type: 'LongTailHttpError' });
    expect(err.details[0]).toEqual({ status: 409, body: { error: 'signal key sk is held by another escalation' } });
  });

  it('lt.open throws a server error as is, so Temporal retries it', async () => {
    server = await startServer(() => ({ status: 503, body: { error: 'starting' } }));
    const { 'lt.open': ltOpen } = longTailActivities({ url: server.url, apiKey: 'k' });
    await expect(ltOpen(OPEN)).rejects.toBeInstanceOf(LongTailHttpError);
  });

  it('lt.close cancels the escalation and treats 409 (already closed) as done', async () => {
    server = await startServer((req) => ({ status: req.url.includes('closed') ? 409 : 200, body: {} }));
    const { 'lt.close': ltClose } = longTailActivities({ url: server.url, apiKey: 'k' });
    await ltClose({ escalationId: 'e/1' });
    await ltClose({ escalationId: 'closed' });
    expect(server.requests.map((r) => r.url)).toEqual(['/api/escalations/e%2F1/cancel', '/api/escalations/closed/cancel']);
  });

  it('lt.close throws on other failures', async () => {
    server = await startServer(() => ({ status: 500, body: { error: 'boom' } }));
    const { 'lt.close': ltClose } = longTailActivities({ url: server.url, apiKey: 'k' });
    await expect(ltClose({ escalationId: 'e' })).rejects.toThrow(/500/);
  });

  it('fails loud on missing or invalid config', () => {
    expect(() => longTailActivities({ url: '', apiKey: 'k' })).toThrow(/url/);
    expect(() => longTailActivities({ url: 'http://x', apiKey: '' })).toThrow(/apiKey/);
    expect(() => longTailActivities({ url: 'not a url', apiKey: 'k' })).toThrow();
    expect(() => longTailActivities({ url: 'http://x', apiKey: 'k', timeoutMs: 0 })).toThrow(/timeoutMs/);
  });
});
