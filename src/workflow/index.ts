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
import type { LTActivities, LTConditionalConfig, LTOutcome } from '../types';

export type { LTConditionalConfig, LTOutcome } from '../types';
export { LT_OUTCOME_SIGNAL, OUTCOME_STATUS } from '../constants';

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
 * Park the workflow on a Long Tail escalation and return the resolver's
 * payload, or `null` when the escalation expired or was cancelled.
 *
 * `key` names the wait and is unique within one workflow run; loops add the
 * round (`review-${round}`). Long Tail owns the queue, claim, form and SLA.
 */
export async function conditional<T = Record<string, unknown>>(key: string, config: LTConditionalConfig): Promise<T | null> {
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
  const outcome = outcomes.get(key)!;
  return outcome.status === OUTCOME_STATUS.RESOLVED ? ((outcome.data ?? {}) as T) : null;
}

/** Workflow-time expiry; a malformed timeout fails the workflow instead of retrying the task. */
function expiresAt(timeout: string | number): string {
  try {
    return new Date(Date.now() + durationMs(timeout)).toISOString();
  } catch (err) {
    throw ApplicationFailure.nonRetryable((err as Error).message, INVALID_CONFIG);
  }
}

/** The full outcome for a key already returned by `conditional`, e.g. to read `status` or `resolvedBy`. */
export function outcomeOf(key: string): LTOutcome | undefined {
  return outcomes.get(key);
}
