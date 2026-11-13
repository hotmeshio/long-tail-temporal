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
export interface LTConditionalConfig extends LTCollectionConfig {
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

/** A batch item already satisfied when the wait opens. */
export interface LTFilledEntry {
  payload: Record<string, unknown>;
  /** ISO time the item was satisfied, from the source of record. */
  at: string;
  actor?: string;
}

/** Collect any item keys until `max`, the deadline or a resolve. */
export interface LTAccumulateConfig {
  /** Count that ends the wait. Absent: only the deadline or a resolve ends it. */
  max?: number;
  /** Default true. False makes `max` a cap: further adds answer `full`. */
  resolveAtMax?: boolean;
  /** Default true. False replaces a repeated item key in place. */
  unique?: boolean;
}

/** One escalation that collects many items, as HotMesh's `conditional()` declares it. */
export interface LTCollectionConfig {
  /** Item keys, filled once each. The last fill returns every item, keyed by item. */
  batch?: string[];
  /** Batch items already satisfied when the wait opens. */
  filled?: Record<string, LTFilledEntry>;
  /** A fill returns the items so far with `$filled` and `$trigger: 'fill'`: every key (`true`) or the listed keys. */
  wakeOnFill?: boolean | string[];
  /** A flagged item returns the items so far with `$flags` and `$trigger: 'flag'`. */
  wakeOnFlag?: boolean;
  /** On expiry, return the items filled so far with `$trigger: 'timeout'` instead of null. */
  partialOnTimeout?: boolean;
  /** Collect items into `$accumulated`. Exclusive with `batch`. */
  accumulate?: LTAccumulateConfig;
}

/** What ended a batch wait early; absent when every item was filled. */
export interface LTBatchMarkers {
  $trigger?: 'fill' | 'flag' | 'timeout';
  $filled?: string[];
  $filledAt?: Record<string, string>;
  $filledBy?: Record<string, string>;
  $flags?: Record<string, unknown>;
}

/** One accumulated item, in arrival order. */
export interface LTAccumulatedItem<P = Record<string, unknown>> {
  itemKey: string;
  payload?: P;
  at: string;
  actor?: string;
}

/** An accumulate wait's result: the items, what ended the wait, and a resolver's payload when a person resolved it. */
export type LTAccumulatorResult<P = Record<string, unknown>, R extends Record<string, unknown> = Record<string, unknown>> =
  Partial<R> & {
    $accumulated: LTAccumulatedItem<P>[];
    $trigger: 'count' | 'timeout' | 'resolve';
  };
