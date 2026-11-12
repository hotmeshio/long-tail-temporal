import { conditional, outcomeOf } from '../../src/workflow';
import type { LTConditionalConfig } from '../../src/types';

const CONFIG: LTConditionalConfig = { role: 'reviewer', type: 'decision' };

/** One wait; returns the value and the outcome status. */
export async function singleWait(key: string, timeout?: string) {
  const value = await conditional<{ approved: boolean }>(key, { ...CONFIG, ...(timeout ? { timeout } : {}) });
  return { value, status: outcomeOf(key)?.status ?? null };
}

/** Two waits in order. */
export async function twoWaits() {
  const first = await conditional('first', CONFIG);
  const second = await conditional('second', CONFIG);
  return { first, second };
}
