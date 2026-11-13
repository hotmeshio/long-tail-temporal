import { describe, it, expect, afterEach } from 'vitest';
import { ApplicationFailure } from '@temporalio/common';

import { longTailTools, LongTailHttpError } from '../../src/worker';
import { startServer } from '../helpers/http-server';

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

async function failure(request: Promise<unknown>): Promise<any> {
  try {
    await request;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to fail');
}

describe('longTailTools', () => {
  it('posts the arguments to the MCP call route and returns the result', async () => {
    server = await startServer(() => ({ status: 200, body: { result: { total: 3 } } }));
    const { 'lt.tools.call': call } = longTailTools({ url: server.url, apiKey: 'lt_bot_k' });
    expect(await call({ server: 'long-tail-admin', tool: 'find_escalations', arguments: { role: 'reviewer' } })).toEqual({ total: 3 });
    expect(server.requests[0]).toMatchObject({
      method: 'POST', url: '/api/mcp/servers/long-tail-admin/tools/find_escalations/call', body: { arguments: { role: 'reviewer' } },
    });
    expect(server.requests[0].headers.authorization).toBe('Bearer lt_bot_k');
  });

  it('encodes the server and tool, sends execute_as, and defaults arguments to {}', async () => {
    server = await startServer(() => ({ status: 200, body: { result: null } }));
    const { 'lt.tools.call': call } = longTailTools({ url: server.url, apiKey: 'k' });
    expect(await call({ server: 'my tools', tool: 'a/b', executeAs: 'ops-bot' })).toBeNull();
    expect(server.requests[0]).toMatchObject({ url: '/api/mcp/servers/my%20tools/tools/a%2Fb/call', body: { arguments: {}, execute_as: 'ops-bot' } });
  });

  it('fails a refusal at once, with status, body and the HTTP error as cause', async () => {
    server = await startServer(() => ({ status: 403, body: { error: 'Forbidden: find_escalations is not available to you' } }));
    const { 'lt.tools.call': call } = longTailTools({ url: server.url, apiKey: 'k' });
    const err = await failure(call({ server: 'long-tail-admin', tool: 'find_escalations' }));
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(err).toMatchObject({ type: 'LongTailHttpError', nonRetryable: true });
    expect(err.details[0]).toEqual({ status: 403, body: { error: 'Forbidden: find_escalations is not available to you' } });
    expect(err.message).toMatch(/403: Forbidden/);
    expect(err.cause).toBeInstanceOf(LongTailHttpError);
  });

  it('throws a server error as is, so Temporal retries it', async () => {
    server = await startServer(() => ({ status: 500, body: { error: 'tool crashed' } }));
    const { 'lt.tools.call': call } = longTailTools({ url: server.url, apiKey: 'k' });
    const err = await failure(call({ server: 's', tool: 't' }));
    expect(err).toBeInstanceOf(LongTailHttpError);
    expect(err).toMatchObject({ status: 500, body: { error: 'tool crashed' } });
  });

  it('wraps a network failure with its cause', async () => {
    const { 'lt.tools.call': call } = longTailTools({ url: 'http://127.0.0.1:1', apiKey: 'k' });
    const err = await failure(call({ server: 's', tool: 't' }));
    expect(err).toBeInstanceOf(LongTailHttpError);
    expect(err.status).toBeUndefined();
    expect(err.cause).toBeDefined();
  });

  it('refuses a call without a server or tool, without retrying', async () => {
    const { 'lt.tools.call': call } = longTailTools({ url: 'http://x', apiKey: 'k' });
    const err = await failure(call({ server: '', tool: 't' }));
    expect(err).toMatchObject({ nonRetryable: true, type: 'LongTailInvalidInput' });
  });

  it('fails loud on missing or invalid config', () => {
    expect(() => longTailTools({ url: '', apiKey: 'k' })).toThrow(/longTailTools: `url`/);
    expect(() => longTailTools({ url: 'http://x', apiKey: '' })).toThrow(/apiKey/);
    expect(() => longTailTools({ url: 'http://x', apiKey: 'k', timeoutMs: -1 })).toThrow(/timeoutMs/);
  });
});
