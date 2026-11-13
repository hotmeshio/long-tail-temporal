import {
  ApplicationFailure,
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';

import { DEFAULTS, LT_ACTIVITY, LT_OUTCOME_SIGNAL, OUTCOME_STATUS } from '../constants';
import { durationMs } from '../duration';
import type { LTActivities, LTConditionalConfig, LTOutcome, LTResolution, LTWithResolution } from '../types';

/** The signal Long Tail delivers each terminal outcome on. */
export const ltOutcome = defineSignal<[LTOutcome]>(LT_OUTCOME_SIGNAL);

const INVALID_CONFIG = 'LongTailInvalidConfig';

// Module state is per workflow execution: the sandbox keeps a module cache per workflow.
const outcomes = new Map<string, LTOutcome>();
let handlerInstalled = false;

function installHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  setHandler(ltOutcome, (outcome) => {
    if (!outcomes.has(outcome.waitKey)) outcomes.set(outcome.waitKey, outcome);
  });
}

const activities = proxyActivities<LTActivities>({
  startToCloseTimeout: DEFAULTS.ACTIVITY_START_TO_CLOSE,
  retry: { maximumAttempts: DEFAULTS.ACTIVITY_MAX_ATTEMPTS },
});
const ltOpen = activities[LT_ACTIVITY.OPEN];
const ltClose = activities[LT_ACTIVITY.CLOSE];

/**
 * Park the workflow on a Long Tail escalation and return its terminal
 * outcome: `status` (resolved, expired or cancelled), `data`, `escalationId`,
 * and on a resolve `resolvedBy` and `resolvedAt`.
 *
 * `key` names the wait and is unique within one workflow run; loops add the
 * round (`review-${round}`). Long Tail owns the queue, claim, form and SLA.
 */
export async function conditionalOutcome<T = Record<string, unknown>>(key: string, config: LTConditionalConfig): Promise<LTOutcome<T>> {
  // 1. Listen first so an early outcome is kept
  installHandler();
  const info = workflowInfo();
  const { timeout, ...human } = config;

  // 2. Open the escalation (idempotent on workflowId + runId + key)
  const opened = await ltOpen({
    ...human,
    workflowId: info.workflowId,
    runScope: info.runId,
    workflowType: info.workflowType,
    waitKey: key,
    ...(timeout !== undefined ? { expiresAt: expiresAt(timeout) } : {}),
  });

  // 3. Wait for the terminal outcome; close the row if this workflow is cancelled
  try {
    await condition(() => outcomes.has(key));
  } catch (err) {
    if (isCancellation(err)) {
      await CancellationScope.nonCancellable(() => ltClose({ escalationId: opened.escalationId }));
    }
    throw err;
  }
  return outcomes.get(key)! as LTOutcome<T>;
}

/**
 * Park the workflow on a Long Tail escalation and return what HotMesh's
 * `conditional()` returns: the resolver's payload when resolved, `false`
 * when it expired, `null` when it was cancelled. A `batch` or `accumulate`
 * wait returns its collection, also on an expiry that kept one (an
 * accumulator, or `partialOnTimeout`), so an accumulator never returns
 * `false`.
 *
 * `withResolution: true` adds `$resolution` (`escalationId`, `resolvedBy`,
 * `resolvedAt`) to a resolved payload.
 */
export async function conditional<T = Record<string, unknown>>(
  key: string, config: LTConditionalConfig & { accumulate: object; withResolution?: false }): Promise<T | null>;
export async function conditional<T = Record<string, unknown>>(
  key: string, config: LTConditionalConfig & { withResolution: true }): Promise<LTWithResolution<T> | false | null>;
export async function conditional<T = Record<string, unknown>>(
  key: string, config: LTConditionalConfig & { withResolution?: boolean }): Promise<T | false | null>;
export async function conditional<T = Record<string, unknown>>(
  key: string, config: LTConditionalConfig & { withResolution?: boolean }): Promise<T | LTWithResolution<T> | false | null> {
  const { withResolution = false, ...wait } = config;
  return valueOf(await conditionalOutcome<T>(key, wait), withResolution);
}

/** The full outcome for a key a `conditional` call in this run already returned. */
export function outcomeOf(key: string): LTOutcome | undefined {
  return outcomes.get(key);
}

function valueOf<T>(outcome: LTOutcome<T>, withResolution: boolean): T | LTWithResolution<T> | false | null {
  if (outcome.status === OUTCOME_STATUS.RESOLVED) {
    const data = (outcome.data ?? {}) as T;
    return withResolution ? { ...data, $resolution: resolutionOf(outcome) } : data;
  }
  if (outcome.status === OUTCOME_STATUS.EXPIRED) return outcome.data ?? false;
  return null;
}

function resolutionOf(outcome: LTOutcome<unknown>): LTResolution {
  return {
    escalationId: outcome.escalationId,
    ...(outcome.resolvedBy ? { resolvedBy: outcome.resolvedBy } : {}),
    ...(outcome.resolvedAt ? { resolvedAt: outcome.resolvedAt } : {}),
  };
}

/** Workflow-time expiry; a malformed timeout fails the workflow instead of retrying the task. */
function expiresAt(timeout: string | number): string {
  try {
    return new Date(Date.now() + durationMs(timeout)).toISOString();
  } catch (err) {
    throw ApplicationFailure.nonRetryable((err as Error).message, INVALID_CONFIG);
  }
}
