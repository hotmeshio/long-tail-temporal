import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { LT_OUTCOME_SIGNAL } from '../../src/constants';
import { MACHINE_LINE_WORKFLOWS } from '../helpers/bundle';
import { outcome } from '../helpers/fake-activities';
import { startWorkflowEnv, type WorkflowEnv } from '../helpers/workflow-env';

let wf: WorkflowEnv;
const PRINT = { machineId: 'print-01', process: 'print', recipe: { id: 'RCP-PRINT-A', version: '1' } };
const TARGET = { siteId: 'site-1', lineId: 'line-1', machineId: 'bond-01', role: 'line-bond' };
const envelope = (data: Record<string, unknown>) => ({ data, metadata: {}, lt: {} });
const route = (routeKey: string) => envelope({
  siteId: 'site-1', lineId: 'line-1', routeKey, orderRef: 'order-42', units: [{ unitId: 'U1', carrierId: null }], steps: [PRINT],
});
const received = { received: true, $accumulated: [{ itemKey: 'arrived:U1', at: '2026-11-13T10:00:00.000Z' }], $trigger: 'resolve' };

describe('machine-line workflows (fake Long Tail)', () => {
  beforeAll(async () => {
    wf = await startWorkflowEnv(MACHINE_LINE_WORKFLOWS, 'machine-line-test');
  });

  afterAll(async () => {
    await wf.shutdown();
  });

  async function answer(workflowId: string, key: string, data?: Record<string, unknown>, status: 'resolved' | 'expired' = 'resolved') {
    const open = await wf.waitForOpen(workflowId, key);
    await wf.env.client.workflow.getHandle(workflowId).signal(LT_OUTCOME_SIGNAL, outcome(key, status, data));
    return open;
  }

  it('walks every hop as an accumulator addressed by its signal key', async () => {
    const handle = await wf.start('machineUnitRoute', [route('r1')]);
    const first = await answer(handle.workflowId, 'handoff-r1-s0-a1', received);
    expect(first).toMatchObject({ role: 'line-print', type: 'handoff', accumulate: {}, signalKey: 'handoff-r1-s0-a1', metadata: { jobId: 'r1-print-01' } });
    const exit = await answer(handle.workflowId, 'handoff-r1-s1-a1', received);
    expect(exit).toMatchObject({ role: 'line-exit', subtype: 'exit', metadata: { senderJobId: 'r1-print-01' } });
    expect((await handle.result()).data).toMatchObject({ status: 'complete', units: ['U1'] });
  });

  it('asks the operator after a refusal and retries the hop as a new job', async () => {
    const handle = await wf.start('machineUnitRoute', [route('r2')]);
    await answer(handle.workflowId, 'handoff-r2-s0-a1', { received: false, errorCode: 'dispatch-refused', reason: 'busy' });
    const asked = await answer(handle.workflowId, 'handoff-error-r2-s0-a1', { decision: 'retry' });
    expect(asked).toMatchObject({ role: 'line-operator', type: 'handoff-error', priority: 1, metadata: { decisions: ['retry', 'manual', 'scrap'] } });
    const retried = await answer(handle.workflowId, 'handoff-r2-s0-a2', received);
    expect(retried.metadata).toMatchObject({ jobId: 'r2-print-01-a2', attempt: 2 });
    await answer(handle.workflowId, 'handoff-r2-s1-a1', received);
    expect((await handle.result()).data).toMatchObject({ status: 'complete' });
  });

  it('asks again for a decision the failure does not allow, then hands the units to a person', async () => {
    const handle = await wf.start('machineUnitRoute', [route('r3')]);
    await answer(handle.workflowId, 'handoff-r3-s0-a1', { received: true });
    await answer(handle.workflowId, 'handoff-r3-s1-a1', { received: false, errorCode: 'sender-rejected', result: 'reject' });
    await answer(handle.workflowId, 'handoff-error-r3-s1-a1', { decision: 'retry' });
    const again = await answer(handle.workflowId, 'handoff-error-r3-s1-a1-r2', { decision: 'manual', note: 'by hand' });
    expect(again.description).toMatch(/^retry is not available here/);
    await answer(handle.workflowId, 'handoff-r3-s2-a1', received);
    expect((await handle.result()).data).toMatchObject({ status: 'manual', at: 'print-01', received: true, note: 'by hand' });
  });

  it('stops the sender job when a handoff is cancelled, and scraps on the operator timeout', async () => {
    const handle = await wf.start('machineUnitRoute', [route('r4')]);
    await answer(handle.workflowId, 'handoff-r4-s0-a1', { received: true });
    await wf.env.client.workflow.getHandle(handle.workflowId).signal(LT_OUTCOME_SIGNAL, outcome('handoff-r4-s1-a1', 'cancelled'));
    const stop = await answer(handle.workflowId, 'job-stop-r4-s1-a1', { accepted: true });
    expect(stop).toMatchObject({ role: 'line-print', type: 'machine-command', metadata: { op: 'stop', args: { jobId: 'r4-print-01' } } });
    await answer(handle.workflowId, 'handoff-error-r4-s1-a1', undefined, 'expired');
    expect((await handle.result()).data).toMatchObject({ status: 'scrapped', note: 'no decision before the timeout' });
  });

  it('changes a machine over with a command row and reads the reply', async () => {
    const handle = await wf.start('changeover', [envelope({ ...TARGET, requestKey: 'co-1', recipe: { id: 'RCP-BOND-B', version: '2' } })]);
    const reply = { accepted: true, machineId: 'bond-01', op: 'changeover', status: 'accepted' };
    const row = await answer(handle.workflowId, 'machine-command-co-1', reply);
    expect(row).toMatchObject({ role: 'line-bond', type: 'machine-command', subtype: 'changeover', signalKey: 'machine-command-co-1' });
    expect(await handle.result()).toEqual({ data: reply });
  });

  it('reads no reply before the timeout as no-reply', async () => {
    const handle = await wf.start('machineCommand', [envelope({ ...TARGET, requestKey: 'snap-1', op: 'snapshot', timeout: '1m' })]);
    const row = await answer(handle.workflowId, 'machine-command-snap-1', undefined, 'expired');
    expect(row.expiresAt).toBeDefined();
    expect((await handle.result()).data).toMatchObject({ accepted: false, op: 'snapshot', status: 'no-reply' });
  });
});
