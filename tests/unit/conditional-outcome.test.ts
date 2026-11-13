import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { LT_OUTCOME_SIGNAL } from '../../src/constants';
import { outcome } from '../helpers/fake-activities';
import { startWorkflowEnv, type WorkflowEnv } from '../helpers/workflow-env';

let wf: WorkflowEnv;
const RESOLVER = { resolvedBy: 'user-1', resolvedAt: '2026-11-13T10:00:00.000Z' };

describe('conditionalOutcome and withResolution (workflow)', () => {
  beforeAll(async () => {
    wf = await startWorkflowEnv(path.resolve(__dirname, '../workflows/conditional-workflows.ts'), 'outcome-test');
  });

  afterAll(async () => {
    await wf.shutdown();
  });

  async function settle(workflow: string, key: string, delivered: ReturnType<typeof outcome>, args: unknown[] = [key]) {
    const handle = await wf.start(workflow, args);
    await wf.waitForOpen(handle.workflowId, key);
    await handle.signal(LT_OUTCOME_SIGNAL, delivered);
    return handle.result();
  }

  it('returns the whole outcome on a resolve', async () => {
    const result = await settle('outcomeWait', 'k', outcome('k', 'resolved', { approved: true }, RESOLVER));
    expect(result).toEqual({ waitKey: 'k', escalationId: 'esc-k', status: 'resolved', data: { approved: true }, ...RESOLVER });
  });

  it('tells expired from cancelled', async () => {
    expect(await settle('outcomeWait', 'k', outcome('k', 'expired'))).toMatchObject({ status: 'expired', escalationId: 'esc-k' });
    expect(await settle('outcomeWait', 'k', outcome('k', 'cancelled'))).toMatchObject({ status: 'cancelled', escalationId: 'esc-k' });
  });

  it('returns the items an expired accumulator kept', async () => {
    const kept = { $accumulated: [{ itemKey: 'ana', at: '2026-11-13T10:00:00.000Z' }], $trigger: 'timeout' };
    const result = await settle('outcomeWait', 'acc', outcome('acc', 'expired', kept), ['acc', { accumulate: { max: 3 } }]);
    expect(result).toMatchObject({ status: 'expired', data: kept });
  });

  it('merges $resolution into a resolved payload when asked', async () => {
    const result = await settle('resolutionWait', 'r', outcome('r', 'resolved', { approved: true }, RESOLVER));
    expect(result).toEqual({ approved: true, $resolution: { escalationId: 'esc-r', ...RESOLVER } });
  });

  it('leaves the payload alone without withResolution, and returns false on expiry with it', async () => {
    expect(await settle('singleWait', 'p', outcome('p', 'resolved', { approved: false }, RESOLVER)))
      .toEqual({ value: { approved: false }, status: 'resolved' });
    expect(await settle('resolutionWait', 'x', outcome('x', 'expired'))).toBe(false);
  });

  it('forwards every wait field to lt.open and keeps withResolution off the wire', async () => {
    const fields = {
      envelope: { formDefaults: { notes: 'prefilled' }, confidence: { notes: 0.4 } },
      lookups: [{ domain: 'catalog', key: 'sizes', version: 2, as: 'sizes' }],
      files: [{ path: 'orders/42/scan.pdf', as: 'scan', name: 'Scan', contentType: 'application/pdf', expiresIn: 600 }],
      schemaVersion: 3,
      assignee: 'user-7',
      durationMinutes: 15,
      originId: '00000000-0000-4000-8000-000000000001',
      parentId: '00000000-0000-4000-8000-000000000002',
      signalKey: 'order-42-review',
    };
    const handle = await wf.start('outcomeWait', ['fields', fields]);
    const open = await wf.waitForOpen(handle.workflowId, 'fields');
    expect(open).toMatchObject({ ...fields, role: 'reviewer', type: 'decision', waitKey: 'fields' });
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('fields', 'resolved', {}));
    await handle.result();

    const asked = await wf.start('resolutionWait', ['wire']);
    expect(await wf.waitForOpen(asked.workflowId, 'wire')).not.toHaveProperty('withResolution');
    await asked.signal(LT_OUTCOME_SIGNAL, outcome('wire', 'cancelled'));
    await asked.result();
  });

  it('links a second wait to the first by the escalation id from its outcome', async () => {
    const handle = await wf.start('chainedWaits', []);
    await wf.waitForOpen(handle.workflowId, 'first');
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('first', 'resolved', {}));
    const second = await wf.waitForOpen(handle.workflowId, 'second');
    expect(second).toMatchObject({ parentId: 'esc-first', originId: 'esc-first' });
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('second', 'resolved', {}));
    expect(await handle.result()).toMatchObject({ first: { status: 'resolved' }, second: { status: 'resolved' } });
  });
});
