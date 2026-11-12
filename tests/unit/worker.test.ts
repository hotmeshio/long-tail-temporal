import { describe, it, expect, afterEach } from 'vitest';

import { longTailActivities } from '../../src/worker';
import { startServer } from '../helpers/http-server';

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

const OPEN = { workflowId: 'wf', runScope: 'run', workflowType: 'reviewOrder', waitKey: 'k', role: 'reviewer', type: 'review' };

describe('longTailActivities', () => {
  it('ltOpen posts the wait and returns the escalation', async () => {
    server = await startServer(() => ({ status: 201, body: { escalationId: 'e1', status: 'pending', created: true } }));
    const { ltOpen } = longTailActivities({ url: server.url, apiKey: 'lt_bot_k' });
    expect(await ltOpen(OPEN)).toEqual({ escalationId: 'e1', status: 'pending', created: true });
    expect(server.requests[0]).toMatchObject({ url: '/api/escalations/waits', body: OPEN });
  });

  it('ltOpen throws on refusal so Temporal retries or fails the activity', async () => {
    server = await startServer(() => ({ status: 400, body: { error: 'role is required' } }));
    const { ltOpen } = longTailActivities({ url: server.url, apiKey: 'k' });
    await expect(ltOpen(OPEN)).rejects.toThrow(/role is required/);
  });

  it('ltClose cancels the escalation and treats 409 (already closed) as done', async () => {
    server = await startServer((req) => ({ status: req.url.includes('closed') ? 409 : 200, body: {} }));
    const { ltClose } = longTailActivities({ url: server.url, apiKey: 'k' });
    await ltClose({ escalationId: 'e/1' });
    await ltClose({ escalationId: 'closed' });
    expect(server.requests.map((r) => r.url)).toEqual(['/api/escalations/e%2F1/cancel', '/api/escalations/closed/cancel']);
  });

  it('ltClose throws on other failures', async () => {
    server = await startServer(() => ({ status: 500, body: { error: 'boom' } }));
    const { ltClose } = longTailActivities({ url: server.url, apiKey: 'k' });
    await expect(ltClose({ escalationId: 'e' })).rejects.toThrow(/500/);
  });

  it('fails loud on missing or invalid config', () => {
    expect(() => longTailActivities({ url: '', apiKey: 'k' })).toThrow(/url/);
    expect(() => longTailActivities({ url: 'http://x', apiKey: '' })).toThrow(/apiKey/);
    expect(() => longTailActivities({ url: 'not a url', apiKey: 'k' })).toThrow();
    expect(() => longTailActivities({ url: 'http://x', apiKey: 'k', timeoutMs: 0 })).toThrow(/timeoutMs/);
  });
});
