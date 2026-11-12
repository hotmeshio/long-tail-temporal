/** Signal the Long Tail relay sends to a waiting workflow. */
export const LT_OUTCOME_SIGNAL = 'lt.outcome';

/** Activity names registered by `longTailActivities`. */
export const LT_ACTIVITY = {
  OPEN: 'ltOpen',
  CLOSE: 'ltClose',
} as const;

/** Provider name stored on every wait this package opens. */
export const TEMPORAL_PROVIDER = 'temporal';

/** Terminal outcome statuses. Mirrors Long Tail's WAIT_OUTCOME_STATUS. */
export const OUTCOME_STATUS = {
  RESOLVED: 'resolved',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

/** Long Tail HTTP routes the activities call. */
export const LT_ROUTES = {
  OPEN_WAIT: '/api/escalations/waits',
  cancel: (escalationId: string) => `/api/escalations/${encodeURIComponent(escalationId)}/cancel`,
} as const;

export const DEFAULTS = {
  HTTP_TIMEOUT_MS: 15_000,
  ACTIVITY_START_TO_CLOSE: '30s',
  ACTIVITY_MAX_ATTEMPTS: 10,
  PRIORITY: 2,
} as const;
