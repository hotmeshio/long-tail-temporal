import { describe, it, expect } from 'vitest';
import { ApplicationFailure } from '@temporalio/common';
import type { createClient } from '@hotmeshio/long-tail';

import { longTailActivities, longTailTools, LongTailHttpError, type LongTailInProcessActivityConfig } from '../../src/worker';
import { fakeClient } from '../helpers/fake-client';

const OPEN = { workflowId: 'wf', runScope: 'run', workflowType: 'reviewOrder', waitKey: 'k', role: 'reviewer', type: 'review' };

// Compile-time: Long Tail's own SDK client is accepted as the in-process config.
const accepts = (client: ReturnType<typeof createClient>): LongTailInProcessActivityConfig => ({ client });

describe('longTailActivities, Long Tail in process', () => {
  it('lt.open opens the wait through the SDK and returns its data', async () => {
    const client = fakeClient();
    client.escalations.openWait.mockResolvedValue({ status: 201, data: { escalationId: 'e1', status: 'pending', created: true } });
    const { 'lt.open': ltOpen } = longTailActivities({ client });
    expect(await ltOpen(OPEN)).toEqual({ escalationId: 'e1', status: 'pending', created: true });
    expect(client.escalations.openWait).toHaveBeenCalledWith(OPEN);
    expect(typeof accepts).toBe('function');
  });

  it('lt.open fails a refusal at once, as over HTTP', async () => {
    const client = fakeClient();
    client.escalations.openWait.mockResolvedValue({ status: 403, error: 'no write access' });
    const err = await longTailActivities({ client })['lt.open'](OPEN).catch((e) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(err).toMatchObject({ nonRetryable: true, type: 'LongTailHttpError' });
    expect(err.details[0]).toEqual({ status: 403, body: { error: 'no write access' } });
    expect(err.cause.context).toMatchObject({ method: 'SDK', url: 'escalations.openWait' });
  });

  it('lt.open throws a server error or a thrown call as is, so Temporal retries it', async () => {
    const client = fakeClient();
    client.escalations.openWait.mockResolvedValueOnce({ status: 500, error: 'boom' });
    client.escalations.openWait.mockRejectedValueOnce(new Error('pool ended'));
    const { 'lt.open': ltOpen } = longTailActivities({ client });
    await expect(ltOpen(OPEN)).rejects.toBeInstanceOf(LongTailHttpError);
    const err = await ltOpen(OPEN).catch((e) => e);
    expect(err).toBeInstanceOf(LongTailHttpError);
    expect(err.cause.message).toBe('pool ended');
  });

  it('lt.close cancels and treats 409 (already closed) as done', async () => {
    const client = fakeClient();
    const { 'lt.close': ltClose } = longTailActivities({ client });
    await ltClose({ escalationId: 'e1' });
    client.escalations.cancel.mockResolvedValue({ status: 409, error: 'already terminal' });
    await ltClose({ escalationId: 'e2' });
    expect(client.escalations.cancel.mock.calls).toEqual([[{ id: 'e1' }], [{ id: 'e2' }]]);
  });

  it('lt.tools.call calls the tool with execute_as and returns its result', async () => {
    const client = fakeClient();
    client.mcp.callTool.mockResolvedValue({ status: 200, data: { result: { total: 1 } } });
    const { 'lt.tools.call': call } = longTailTools({ client });
    expect(await call({ server: 'long-tail-admin', tool: 'find_escalations', arguments: { search: 'o' }, executeAs: 'ana' })).toEqual({ total: 1 });
    expect(client.mcp.callTool).toHaveBeenCalledWith({ id: 'long-tail-admin', toolName: 'find_escalations', arguments: { search: 'o' }, execute_as: 'ana' });
  });

  it('fails loud on a client without the calls the activities make', () => {
    const client = fakeClient() as any;
    delete client.escalations.openWait;
    expect(() => longTailActivities({ client })).toThrow(/`client` lacks escalations.openWait; pass createClient\(\) from @hotmeshio\/long-tail 0.37.0/);
    delete client.mcp;
    expect(() => longTailTools({ client })).toThrow(/lacks escalations.openWait, mcp.callTool/);
  });
});
