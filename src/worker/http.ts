/** A non-2xx answer or a failed request to Long Tail, over HTTP or its in-process SDK. */
export class LongTailHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly body: unknown,
    readonly context: { url: string; method: string; elapsedMs: number },
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LongTailHttpError';
  }
}

export interface LongTailHttpOptions {
  url: string;
  apiKey: string;
  timeoutMs: number;
}

/** POST JSON to Long Tail; parses the reply; throws `LongTailHttpError` on non-2xx, timeout or network failure. */
export async function postJson<T>(options: LongTailHttpOptions, path: string, body: unknown): Promise<T> {
  const url = `${options.url.replace(/\/+$/, '')}${path}`;
  const method = 'POST';
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await response.text();
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
    const parsed: unknown = isJson && text ? JSON.parse(text) : text;
    if (!response.ok) {
      const reason = (parsed as { error?: string })?.error ?? response.statusText;
      throw new LongTailHttpError(`Long Tail ${method} ${path} answered ${response.status}: ${reason}`, response.status, parsed,
        { url, method, elapsedMs: performance.now() - started });
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof LongTailHttpError) throw err;
    const elapsedMs = performance.now() - started;
    const timedOut = controller.signal.aborted;
    const message = timedOut ? `Long Tail ${method} ${path} timed out after ${options.timeoutMs}ms` : `Long Tail ${method} ${path} failed`;
    throw new LongTailHttpError(message, undefined, undefined, { url, method, elapsedMs }, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/** The context method of an in-process call's LongTailHttpError; its url names the SDK operation. */
export const IN_PROCESS_METHOD = 'SDK';

/** An SDK call; a non-2xx result throws `LongTailHttpError` as an HTTP answer would. */
export async function callInProcess<T>(operation: string, call: () => Promise<{ status: number; data?: unknown; error?: string }>): Promise<T> {
  const started = performance.now();
  const context = () => ({ url: operation, method: IN_PROCESS_METHOD, elapsedMs: performance.now() - started });
  let result: { status: number; data?: unknown; error?: string };
  try {
    result = await call();
  } catch (err) {
    throw new LongTailHttpError(`Long Tail ${operation} failed`, undefined, undefined, context(), { cause: err });
  }
  if (result.status < 200 || result.status >= 300) {
    throw new LongTailHttpError(`Long Tail ${operation} answered ${result.status}: ${result.error ?? 'error'}`, result.status, { error: result.error }, context());
  }
  return result.data as T;
}
