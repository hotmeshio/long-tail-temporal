import { describe, it, expect } from 'vitest';
import { ApplicationFailure } from '@temporalio/common';

import { throwActivityFailure } from '../../src/worker/failure';
import { LongTailHttpError } from '../../src/worker/http';

const CONTEXT = { url: 'http://lt/api/x', method: 'POST', elapsedMs: 3 };
const httpError = (status: number | undefined) => new LongTailHttpError(`answered ${status}`, status, { error: 'why' }, CONTEXT);

function thrown(err: unknown): any {
  try {
    throwActivityFailure(err);
  } catch (caught) {
    return caught;
  }
}

describe('throwActivityFailure', () => {
  it('turns a refusal into a non-retryable failure carrying status, body and cause', () => {
    for (const status of [400, 403, 404, 409, 422]) {
      const source = httpError(status);
      const err = thrown(source);
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect(err).toMatchObject({ type: 'LongTailHttpError', nonRetryable: true, message: `answered ${status}` });
      expect(err.details).toEqual([{ status, body: { error: 'why' } }]);
      expect(err.cause).toBe(source);
    }
  });

  it('rethrows retryable client errors, server errors and network failures unchanged', () => {
    for (const status of [408, 425, 429, 500, 503, undefined]) {
      const source = httpError(status);
      expect(thrown(source)).toBe(source);
    }
  });

  it('rethrows anything that is not a Long Tail HTTP error', () => {
    const source = new TypeError('bad');
    expect(thrown(source)).toBe(source);
  });
});
