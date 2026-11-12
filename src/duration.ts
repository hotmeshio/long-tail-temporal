const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/;

/** Milliseconds for '30s', '15m', '48h', '7d', '2w', '500ms' or a number of milliseconds. */
export function durationMs(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`timeout must be a positive number of milliseconds, got ${value}`);
    return value;
  }
  const match = DURATION.exec(value.trim());
  if (!match) throw new Error(`timeout "${value}" must look like 30s, 15m, 48h, 7d, 2w or 500ms`);
  const ms = Number(match[1]) * UNIT_MS[match[2]];
  if (ms <= 0) throw new Error(`timeout "${value}" must be positive`);
  return ms;
}
