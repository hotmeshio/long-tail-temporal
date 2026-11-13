import type { OUTCOME_STATUS } from './constants';

export type LTOutcomeStatus = typeof OUTCOME_STATUS[keyof typeof OUTCOME_STATUS];

/** The single message a waiting workflow receives. Same shape as Long Tail's LTWaitOutcome. */
export interface LTOutcome<T = Record<string, unknown>> {
  waitKey: string;
  escalationId: string;
  status: LTOutcomeStatus;
  data?: T;
  resolvedBy?: string;
  resolvedAt?: string;
}

/** What the human side of a wait looks like. */
export interface LTConditionalConfig {
  /** Role (queue) that owns the escalation. */
  role: string;
  /** Escalation category, e.g. 'order-review'. */
  type: string;
  subtype?: string;
  description?: string;
  /** 1 (critical) to 4 (low). Default 2. */
  priority?: 1 | 2 | 3 | 4;
  /** Queryable facets; validated against the role's metadata schema. */
  metadata?: Record<string, unknown>;
  /** Shown to the resolver. */
  data?: Record<string, unknown>;
  /** SLA: '30s', '15m', '48h', '7d', '2w' or milliseconds. Long Tail expires the row after it. */
  timeout?: string | number;
}

/** Input of the `lt.open` activity. */
export interface LTOpenInput extends Omit<LTConditionalConfig, 'timeout'> {
  workflowId: string;
  runScope: string;
  workflowType: string;
  waitKey: string;
  expiresAt?: string;
}

export interface LTOpenResult {
  escalationId: string;
  status: string;
  created: boolean;
}

export interface LTCloseInput {
  escalationId: string;
}

/** The activities a worker registers with `longTailActivities`. */
export interface LTActivities {
  'lt.open'(input: LTOpenInput): Promise<LTOpenResult>;
  'lt.close'(input: LTCloseInput): Promise<void>;
}

/**
 * The one argument Long Tail passes a workflow it invokes or schedules: the
 * form's `data`, the caller's `metadata`, and who started it in `lt`.
 */
export interface LTEnvelope<D = Record<string, unknown>> {
  data: D;
  metadata: Record<string, unknown>;
  lt: {
    userId?: string;
    principal?: { id: string; type?: string; displayName?: string; roles?: unknown[] };
    scopes?: string[];
    initiatedBy?: string;
  };
}
