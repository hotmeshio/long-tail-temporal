import { describe, it, expect } from 'vitest';

import { durationMs } from '../../src/duration';

describe('durationMs', () => {
  it.each([
    ['500ms', 500], ['30s', 30_000], ['15m', 900_000], ['48h', 172_800_000], ['7d', 604_800_000], ['2w', 1_209_600_000], ['1.5h', 5_400_000],
  ])('reads %s', (value, ms) => {
    expect(durationMs(value)).toBe(ms);
  });

  it('takes milliseconds as a number', () => {
    expect(durationMs(1234)).toBe(1234);
  });

  it.each(['soon', '10', '5 minutes', '-1h', '0s'])('rejects %s', (value) => {
    expect(() => durationMs(value)).toThrow();
  });

  it('rejects non-positive numbers', () => {
    expect(() => durationMs(0)).toThrow();
    expect(() => durationMs(Number.NaN)).toThrow();
  });
});
