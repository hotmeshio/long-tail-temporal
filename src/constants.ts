/** Signal the Long Tail relay sends to a waiting workflow. */
export const LT_OUTCOME_SIGNAL = 'lt.outcome';

/** Activity names registered by `longTailActivities` and `longTailTools`. */
export const LT_ACTIVITY = {
  OPEN: 'lt.open',
  CLOSE: 'lt.close',
  TOOL_CALL: 'lt.tools.call',
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
  toolCall: (server: string, tool: string) =>
    `/api/mcp/servers/${encodeURIComponent(server)}/tools/${encodeURIComponent(tool)}/call`,
} as const;

/** Long Tail SDK operations the activities call when Long Tail runs in process. */
export const LT_OPERATIONS = {
  OPEN_WAIT: 'escalations.openWait',
  CANCEL: 'escalations.cancel',
  TOOL_CALL: 'mcp.callTool',
} as const;

/** Largest visibility page the executions list requests. */
export const LIST_MAX_PAGE_SIZE = 1000;

export const DEFAULTS = {
  HTTP_TIMEOUT_MS: 15_000,
  ACTIVITY_START_TO_CLOSE: '30s',
  ACTIVITY_MAX_ATTEMPTS: 10,
  TOOL_HTTP_TIMEOUT_MS: 120_000,
  TOOL_START_TO_CLOSE: '3m',
  TOOL_MAX_ATTEMPTS: 3,
  PRIORITY: 2,
} as const;
