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

/** Input of the `ltOpen` activity. */
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
  ltOpen(input: LTOpenInput): Promise<LTOpenResult>;
  ltClose(input: LTCloseInput): Promise<void>;
}
