import { JOB_STATE, type LTJobState, type LTJobStatus } from '@hotmeshio/long-tail';
import type { WorkflowExecutionDescription } from '@temporalio/client';

const STATE_BY_STATUS: Record<string, LTJobState> = {
  RUNNING: JOB_STATE.RUNNING,
  PAUSED: JOB_STATE.RUNNING,
  COMPLETED: JOB_STATE.COMPLETED,
  CONTINUED_AS_NEW: JOB_STATE.COMPLETED,
  FAILED: JOB_STATE.FAILED,
  TIMED_OUT: JOB_STATE.FAILED,
  CANCELLED: JOB_STATE.CANCELLED,
  TERMINATED: JOB_STATE.TERMINATED,
};

/** A Temporal description in Long Tail's engine-neutral shape. */
export function toJobStatus(description: WorkflowExecutionDescription): LTJobStatus {
  const name = description.status.name;
  return {
    workflowId: description.workflowId,
    workflowType: description.type,
    state: STATE_BY_STATUS[name] ?? JOB_STATE.UNKNOWN,
    providerState: name,
    startedAt: description.startTime?.toISOString(),
    ...(description.closeTime ? { closedAt: description.closeTime.toISOString() } : {}),
  };
}

/** The status for a workflow Temporal does not know. */
export function unknownJobStatus(workflowId: string): LTJobStatus {
  return { workflowId, state: JOB_STATE.UNKNOWN, providerState: 'NOT_FOUND' };
}
