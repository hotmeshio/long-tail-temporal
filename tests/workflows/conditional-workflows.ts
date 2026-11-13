import { conditional, conditionalOutcome, outcomeOf, tools } from '../../src/workflow';
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

/** One batch wait that keeps its partial items on expiry. */
export async function batchWait(key: string) {
  const value = await conditional(key, { ...CONFIG, batch: ['left', 'right'], partialOnTimeout: true, wakeOnFill: ['left'] });
  return { value, status: outcomeOf(key)?.status ?? null };
}

/** The whole outcome of one wait, for any config. */
export async function outcomeWait(key: string, extra: Partial<LTConditionalConfig> = {}) {
  return conditionalOutcome(key, { ...CONFIG, ...extra });
}

/** What `conditional()` returns for one wait, for any config. */
export async function configuredWait(key: string, extra: Partial<LTConditionalConfig> & { withResolution?: boolean } = {}) {
  return conditional(key, { ...CONFIG, ...extra });
}

/** One wait that asks for `$resolution` on its payload. */
export async function resolutionWait(key: string) {
  return conditional<{ approved: boolean }>(key, { ...CONFIG, withResolution: true });
}

/** A first wait, then a second one linked to it as parent and origin. */
export async function chainedWaits() {
  const first = await conditionalOutcome('first', CONFIG);
  const second = await conditionalOutcome('second', { ...CONFIG, parentId: first.escalationId, originId: first.escalationId });
  return { first, second };
}

/** One MCP tool call, returned as is. */
export async function toolCall(server: string, tool: string, args: Record<string, unknown>, executeAs?: string) {
  return tools.call(server, tool, args, executeAs ? { executeAs } : {});
}
