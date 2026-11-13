import { ApplicationFailure } from '@temporalio/common';

import { LongTailHttpError } from './http';

const HTTP_CLIENT_ERROR = { MIN: 400, MAX: 499 } as const;
/** Client errors a later attempt can succeed on. */
const RETRYABLE_CLIENT_STATUS = [408, 425, 429];

/** Status and body of a Long Tail refusal, as the failure's first detail. */
export interface LongTailFailureDetails {
  status: number;
  body: unknown;
}

/**
 * Throw a Long Tail error from an activity. A refusal (4xx) will not change
 * on retry, so it becomes a non-retryable failure of type `LongTailHttpError`
 * whose first detail is `{ status, body }`, with the HTTP error as its cause.
 * Server errors, timeouts and network failures are thrown as they are, so
 * Temporal retries them.
 */
export function throwActivityFailure(err: unknown): never {
  if (err instanceof LongTailHttpError && isRefusal(err.status)) {
    const details: LongTailFailureDetails = { status: err.status!, body: err.body };
    throw ApplicationFailure.create({ type: err.name, message: err.message, nonRetryable: true, details: [details], cause: err });
  }
  throw err;
}

function isRefusal(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status >= HTTP_CLIENT_ERROR.MIN && status <= HTTP_CLIENT_ERROR.MAX && !RETRYABLE_CLIENT_STATUS.includes(status);
}
