/** The docker compose stack, through Long Tail's HTTP API as the seeded admin. */
const LT_URL = process.env.LT_URL ?? 'http://localhost:3200';
const USERNAME = process.env.LT_ADMIN_USER ?? 'superadmin';
const PASSWORD = process.env.LT_ADMIN_PASSWORD ?? 'l0ngt@1l';
const POLL_MS = 500;

let token: string | undefined;

export async function login(): Promise<void> {
  const response = await fetch(`${LT_URL}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login to ${LT_URL} answered ${response.status}; is the compose stack up?`);
  token = ((await response.json()) as { token: string }).token;
}

export async function api<T = any>(method: string, route: string, body?: unknown): Promise<{ status: number; data: T }> {
  if (!token) throw new Error('call login() first');
  const response = await fetch(`${LT_URL}${route}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() as T };
}

/** Polls `read` until it returns a value, or throws after `timeoutMs`. */
export async function waitFor<T>(what: string, read: () => Promise<T | undefined | null>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== null) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** A pending escalation a workflow opened that `matches`. */
export function pendingEscalation(workflowId: string, matches: (row: any) => boolean = () => true): Promise<any> {
  return waitFor(`a pending escalation on ${workflowId}`, async () => {
    const { data } = await api<any>('GET', `/api/escalations/by-workflow/${encodeURIComponent(workflowId)}`);
    return (data?.escalations ?? []).find((row: any) => row.status === 'pending' && matches(row));
  });
}

export async function invoke(workflowType: string, workflowId: string, data: Record<string, unknown>): Promise<void> {
  const invoked = await api('POST', `/api/workflows/${workflowType}/invoke`, { data, workflowId });
  if (invoked.status !== 202) throw new Error(`invoke ${workflowType} answered ${invoked.status}: ${JSON.stringify(invoked.data)}`);
}

/** What a workflow returned, once it completes. */
export function workflowResult<T = any>(workflowId: string, timeoutMs = 60_000): Promise<T> {
  return waitFor(`${workflowId} to complete`, async () => {
    const { status, data } = await api<any>('GET', `/api/workflows/${encodeURIComponent(workflowId)}/result`);
    if (status === 200 && data.state !== 'completed') throw new Error(`${workflowId} ended ${data.state}: ${JSON.stringify(data)}`);
    return status === 200 ? data.result as T : undefined;
  }, timeoutMs);
}

export const uniqueId = (name: string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
