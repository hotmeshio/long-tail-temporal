import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { LT_OUTCOME_SIGNAL } from '../../src/constants';
import { outcome } from '../helpers/fake-activities';
import { startWorkflowEnv, type WorkflowEnv } from '../helpers/workflow-env';

// conditional() returns what HotMesh's conditional() returns, row for row.
let wf: WorkflowEnv;
const RESOLVER = { resolvedBy: 'user-1', resolvedAt: '2026-11-13T10:00:00.000Z' };

describe('the conditional() contract', () => {
  beforeAll(async () => {
    wf = await startWorkflowEnv(path.resolve(__dirname, '../workflows/conditional-workflows.ts'), 'contract-test');
  });

  afterAll(async () => {
    await wf.shutdown();
  });

  async function settle(key: string, extra: Record<string, unknown>, delivered: ReturnType<typeof outcome>) {
    const handle = await wf.start('configuredWait', [key, extra]);
    await wf.waitForOpen(handle.workflowId, key);
    await handle.signal(LT_OUTCOME_SIGNAL, delivered);
    return handle.result();
  }

  it('returns the payload when resolved, with $resolution when asked', async () => {
    expect(await settle('r1', {}, outcome('r1', 'resolved', { approved: true }))).toEqual({ approved: true });
    expect(await settle('r2', { withResolution: true }, outcome('r2', 'resolved', { approved: true }, RESOLVER)))
      .toEqual({ approved: true, $resolution: { escalationId: 'esc-r2', ...RESOLVER } });
  });

  it('returns false when a plain wait or a batch without partialOnTimeout expires', async () => {
    expect(await settle('e1', {}, outcome('e1', 'expired'))).toBe(false);
    expect(await settle('e2', { batch: ['left', 'right'] }, outcome('e2', 'expired'))).toBe(false);
  });

  it('returns the collection when an accumulator or a partialOnTimeout batch expires', async () => {
    const accumulated = { $accumulated: [{ itemKey: 'ana', payload: {}, at: RESOLVER.resolvedAt }], $trigger: 'timeout' };
    expect(await settle('c1', { accumulate: {} }, outcome('c1', 'expired', accumulated))).toEqual(accumulated);
    const sides = { left: { passed: true }, $trigger: 'timeout' };
    expect(await settle('c2', { batch: ['left', 'right'], partialOnTimeout: true }, outcome('c2', 'expired', sides))).toEqual(sides);
  });

  it('returns null when cancelled, for a plain wait and an accumulator', async () => {
    expect(await settle('x1', {}, outcome('x1', 'cancelled'))).toBeNull();
    expect(await settle('x2', { accumulate: {} }, outcome('x2', 'cancelled'))).toBeNull();
  });
});
