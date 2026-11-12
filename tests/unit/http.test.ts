import { describe, it, expect, afterEach } from 'vitest';

import { postJson, LongTailHttpError } from '../../src/worker/http';
import { startServer } from '../helpers/http-server';

async function failure(request: Promise<unknown>): Promise<LongTailHttpError> {
  try {
    await request;
  } catch (err) {
    return err as LongTailHttpError;
  }
  throw new Error('expected the request to fail');
}

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe('postJson', () => {
  it('posts JSON with the bearer key and parses the reply', async () => {
    server = await startServer(() => ({ status: 201, body: { ok: true } }));
    const result = await postJson<{ ok: boolean }>({ url: `${server.url}/`, apiKey: 'lt_bot_x', timeoutMs: 2000 }, '/api/x', { a: 1 });
    expect(result).toEqual({ ok: true });
    expect(server.requests[0]).toMatchObject({ method: 'POST', url: '/api/x', body: { a: 1 } });
    expect(server.requests[0].headers.authorization).toBe('Bearer lt_bot_x');
  });

  it('returns text for a non-JSON reply', async () => {
    server = await startServer(() => ({ status: 200, text: 'fine' }));
    expect(await postJson({ url: server.url, apiKey: 'k', timeoutMs: 2000 }, '/t', {})).toBe('fine');
  });

  it('throws a typed error with status, body and context on non-2xx', async () => {
    server = await startServer(() => ({ status: 403, body: { error: 'no write access' } }));
    const err = await failure(postJson({ url: server.url, apiKey: 'k', timeoutMs: 2000 }, '/api/x', {}));
    expect(err).toBeInstanceOf(LongTailHttpError);
    expect(err.status).toBe(403);
    expect(err.body).toEqual({ error: 'no write access' });
    expect(err.message).toMatch(/403: no write access/);
    expect(err.context).toMatchObject({ method: 'POST', url: `${server.url}/api/x` });
  });

  it('aborts on timeout', async () => {
    server = await startServer(() => ({ status: 200, body: {}, delayMs: 500 }));
    const err = await failure(postJson({ url: server.url, apiKey: 'k', timeoutMs: 50 }, '/slow', {}));
    expect(err).toBeInstanceOf(LongTailHttpError);
    expect(err.status).toBeUndefined();
    expect(err.message).toMatch(/timed out after 50ms/);
  });

  it('wraps a network failure with its cause', async () => {
    const err = await failure(postJson({ url: 'http://127.0.0.1:1', apiKey: 'k', timeoutMs: 2000 }, '/x', {}));
    expect(err).toBeInstanceOf(LongTailHttpError);
    expect(err.cause).toBeDefined();
  });
});
