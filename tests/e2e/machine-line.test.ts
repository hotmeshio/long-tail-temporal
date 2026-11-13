import { describe, it, expect, beforeAll } from 'vitest';

import { api, invoke, login, pendingEscalation, uniqueId, workflowResult } from '../helpers/compose-stack';

// The test plays the machine gateway: it adds hop items and resolves rows over HTTP, as the gateway does.
const LINE = { siteId: 'site-1', lineId: 'line-1' };
const PRINT = { machineId: 'print-01', process: 'print', recipe: { id: 'RCP-PRINT-A', version: '1' } };
const UNITS = [{ unitId: 'U1', carrierId: 'C1' }, { unitId: 'U2', carrierId: 'C1' }];

async function addItem(escalationId: string, itemKey: string, payload: Record<string, unknown>) {
  const added = await api<any>('POST', `/api/escalations/${escalationId}/accumulate`, { itemKey, payload });
  expect(added.status).toBe(200);
}

async function resolve(escalationId: string, resolverPayload: Record<string, unknown>) {
  const resolved = await api('POST', `/api/escalations/${escalationId}/resolve`, { resolverPayload });
  expect(resolved.status).toBe(200);
}

describe('machine line on Temporal (compose stack)', () => {
  beforeAll(login);

  it('changes a machine over: the command row resolves with the reply', async () => {
    const requestKey = uniqueId('co');
    const workflowId = uniqueId('changeover');
    await invoke('changeover', workflowId, { ...LINE, machineId: 'bond-01', role: 'line-bond', requestKey, recipe: { id: 'RCP-BOND-B', version: '1' } });
    const row = await pendingEscalation(workflowId);
    expect(row).toMatchObject({ role: 'line-bond', type: 'machine-command', subtype: 'changeover' });
    expect(row.metadata).toMatchObject({ ...LINE, machineId: 'bond-01', op: 'changeover', args: { recipe: { id: 'RCP-BOND-B', version: '1' } } });

    const reply = { accepted: true, machineId: 'bond-01', op: 'changeover', status: 'accepted', reason: 'changing over to RCP-BOND-B v1' };
    const resolved = await api('POST', '/api/escalations/resolve-by-signal-key', { signalKey: `machine-command-${requestKey}`, resolverPayload: reply });
    expect(resolved.status).toBe(200);
    expect(await workflowResult(workflowId)).toEqual({ data: reply });
  });

  it('moves units through a machine and off the line', async () => {
    const routeKey = uniqueId('route');
    const workflowId = uniqueId('unit-route');
    await invoke('machineUnitRoute', workflowId, { ...LINE, routeKey, orderRef: 'order-42', units: UNITS, steps: [PRINT] });

    // 1. Line entry to print-01: the machine reports each arrival, then resolves its handoff
    const intoPrint = await pendingEscalation(workflowId, (row) => row.role === 'line-print');
    expect(intoPrint).toMatchObject({ type: 'handoff', subtype: 'print' });
    expect(intoPrint.metadata).toMatchObject({ ...LINE, jobId: `${routeKey}-print-01`, toMachine: 'print-01', recipeId: 'RCP-PRINT-A' });
    for (const unit of UNITS) await addItem(intoPrint.id, `arrived:${unit.unitId}`, { carrierId: unit.carrierId });
    const items = await api<any>('GET', `/api/escalations/items-by-signal-key?signalKey=${encodeURIComponent(`handoff-${routeKey}-s0-a1`)}`);
    expect(items.status).toBe(200);
    expect(JSON.stringify(items.data)).toContain('arrived:U2');
    await resolve(intoPrint.id, { received: true, receiver: 'print-01', units: ['U1', 'U2'] });

    // 2. print-01 to line exit: the machine releases the units, a person receives them
    const exit = await pendingEscalation(workflowId, (row) => row.role === 'line-exit');
    expect(exit.metadata).toMatchObject({ senderJobId: `${routeKey}-print-01`, fromMachine: 'print-01' });
    for (const unit of UNITS) await addItem(exit.id, `released:${unit.unitId}`, { result: 'ok' });
    await resolve(exit.id, { received: true, receiver: 'line exit' });

    const result = await workflowResult(workflowId);
    expect(result.data).toMatchObject({ status: 'complete', units: ['U1', 'U2'] });
    expect(result.data.history.map((h: any) => [h.to, h.received])).toEqual([['print-01', true], ['exit', true]]);
  });

  it('asks the operator after a refused dispatch and runs the hop again', async () => {
    const routeKey = uniqueId('retry');
    const workflowId = uniqueId('unit-route');
    await invoke('machineUnitRoute', workflowId, { ...LINE, routeKey, orderRef: 'order-43', units: UNITS.slice(0, 1), steps: [PRINT] });

    const refused = await pendingEscalation(workflowId, (row) => row.role === 'line-print');
    await resolve(refused.id, { received: false, errorCode: 'dispatch-refused', reason: 'busy' });
    const decision = await pendingEscalation(workflowId, (row) => row.role === 'line-operator');
    expect(decision).toMatchObject({ type: 'handoff-error', subtype: 'dispatch-refused' });
    expect(decision.metadata.decisions).toEqual(['retry', 'manual', 'scrap']);
    await resolve(decision.id, { decision: 'retry' });

    const again = await pendingEscalation(workflowId, (row) => row.role === 'line-print' && row.id !== refused.id);
    expect(again.metadata).toMatchObject({ jobId: `${routeKey}-print-01-a2`, attempt: 2 });
    await resolve(again.id, { received: true });
    await resolve((await pendingEscalation(workflowId, (row) => row.role === 'line-exit')).id, { received: true });
    expect((await workflowResult(workflowId)).data).toMatchObject({ status: 'complete' });
  });
});
