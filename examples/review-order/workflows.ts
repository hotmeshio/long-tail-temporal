import { proxyActivities, sleep } from '@temporalio/workflow';
import {
  conditional, tools, type LTAccumulatorResult, type LTBatchMarkers, type LTEnvelope,
} from '@hotmeshio/long-tail-temporal/workflow';

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

  if (decision === false) return { orderId, status: 'expired' };
  if (decision === null) return { orderId, status: 'cancelled' };
  if (!decision.approved) return { orderId, status: 'rejected', notes: decision.notes };
  return { orderId, status: await shipOrder(orderId), notes: decision.notes };
}

/** Invoked from Long Tail: the envelope carries the order id from the invoke form. */
export async function reviewOrderRequest(envelope: LTEnvelope<{ orderId: string }>) {
  return { data: await reviewOrder(envelope.data.orderId) };
}

export type InspectedSides = Partial<Record<'left' | 'right', { passed: boolean }>> & LTBatchMarkers;

/** Invoked from Long Tail: one escalation, one fill per side. On expiry it returns the sides inspected so far. */
export async function inspectOrderRequest(envelope: LTEnvelope<{ orderId: string; timeout?: string }>) {
  const { orderId, timeout = '48h' } = envelope.data;
  const sides = await conditional<InspectedSides>(`inspect-${orderId}`, {
    role: 'reviewer',
    type: 'order-inspection',
    description: `Inspect both sides of order ${orderId}`,
    metadata: { orderId },
    batch: ['left', 'right'],
    partialOnTimeout: true,
    timeout,
  });
  return { data: { orderId, sides } };
}

/** Invoked from Long Tail: collects approvals until `approvals` arrive, the deadline passes, or a person closes it. */
export async function collectApprovalsRequest(envelope: LTEnvelope<{ orderId: string; approvals?: number; timeout?: string }>) {
  const { orderId, approvals = 2, timeout = '48h' } = envelope.data;
  const collected = await conditional<LTAccumulatorResult<{ approver: string }>>(`approvals-${orderId}`, {
    role: 'reviewer',
    type: 'order-approvals',
    description: `Collect ${approvals} approvals for order ${orderId}`,
    metadata: { orderId },
    accumulate: { max: approvals },
    timeout,
  });
  if (!collected) return { data: { orderId, status: 'cancelled' } };
  return { data: { orderId, trigger: collected.$trigger, approvers: collected.$accumulated.map((item) => item.payload?.approver) } };
}

/** Invoked or scheduled from Long Tail: counts a role's pending reviews with a built-in MCP tool. */
export async function countPendingReviews(envelope: LTEnvelope<{ role?: string }>) {
  const role = envelope.data?.role ?? 'reviewer';
  const found = await tools.call<{ total: number }>('long-tail-admin', 'find_escalations', { role, status: 'pending', limit: 1 });
  return { data: { role, pending: found.total } };
}
