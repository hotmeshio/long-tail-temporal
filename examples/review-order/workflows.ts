import { proxyActivities, sleep } from '@temporalio/workflow';
import { conditional } from '@hotmeshio/long-tail-temporal/workflow';

import type * as activities from './activities';

export interface ReviewDecision {
  approved: boolean;
  notes?: string;
}

const { scoreOrder, shipOrder } = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute' });

/** Score an order, ask a reviewer, ship when approved. */
export async function reviewOrder(orderId: string, timeout = '48h') {
  const risk = await scoreOrder(orderId);
  await sleep('1s');

  const decision = await conditional<ReviewDecision>(`review-${orderId}`, {
    role: 'reviewer',
    type: 'order-review',
    description: `Review order ${orderId}`,
    metadata: { orderId, risk },
    timeout,
  });

  if (!decision) return { orderId, status: 'expired-or-cancelled' };
  if (!decision.approved) return { orderId, status: 'rejected', notes: decision.notes };
  return { orderId, status: await shipOrder(orderId), notes: decision.notes };
}
