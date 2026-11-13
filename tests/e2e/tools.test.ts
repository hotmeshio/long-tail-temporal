import { describe, it, expect, beforeAll } from 'vitest';

import { api, invoke, login, pendingEscalation, uniqueId, workflowResult } from '../helpers/compose-stack';

describe('longTailTools on the compose stack', () => {
  beforeAll(login);

  it('counts pending reviews with the built-in find_escalations tool', async () => {
    const orderId = uniqueId('tools-order');
    await invoke('reviewOrderRequest', orderId, { orderId });
    const review = await pendingEscalation(orderId);

    const counted = uniqueId('count');
    await invoke('countPendingReviews', counted, { role: 'reviewer' });
    const result = await workflowResult(counted);
    expect(result).toEqual({ data: { role: 'reviewer', pending: expect.any(Number) } });
    expect(result.data.pending).toBeGreaterThanOrEqual(1);

    await api('POST', `/api/escalations/${review.id}/resolve`, { resolverPayload: { approved: true } });
    expect((await workflowResult(orderId)).data).toMatchObject({ status: `shipped ${orderId}` });
  });
});
