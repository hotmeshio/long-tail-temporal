import { describe, it, expect } from 'vitest';

import {
  commandWait, hopRow, jobIdFor, planHops, readHopOutcome, reworkHop, roleOf, stationKey, type UnitRouteInput,
} from '../../examples/machine-line/route';

const PRINT = { machineId: 'print-01', process: 'print', recipe: { id: 'RCP-PRINT-A', version: '1' } };
const BOND = { machineId: 'bond-01', process: 'bond', recipe: { id: 'RCP-BOND-B', version: '2' }, role: 'line-bonder' };
const INPUT: UnitRouteInput = {
  siteId: 'site-1', lineId: 'line-1', routeKey: 'r1', orderRef: 'order-42',
  units: [{ unitId: 'U1', carrierId: null }, { unitId: 'U2', carrierId: 'C9' }],
  steps: [PRINT, BOND],
};

describe('machine-line route', () => {
  it('plans one hop per step plus the exit', () => {
    const hops = planHops(INPUT.steps);
    expect(hops.map((h) => [h.from && stationKey(h.from), h.to && stationKey(h.to)]))
      .toEqual([[null, 'print-01'], ['print-01', 'bond-01'], ['bond-01', null]]);
  });

  it('names a job per station and attempt, and roles by step', () => {
    expect(jobIdFor('r1', PRINT)).toBe('r1-print-01');
    expect(jobIdFor('r1', PRINT, 2)).toBe('r1-print-01-a2');
    expect(jobIdFor('r1', null)).toBe('r1-exit');
    expect(roleOf(INPUT, PRINT)).toBe('line-print');
    expect(roleOf(INPUT, BOND)).toBe('line-bonder');
    expect(roleOf(INPUT, null)).toBe('line-exit');
    expect(roleOf({ ...INPUT, exitRole: 'packing' }, null)).toBe('packing');
  });

  it('parks a handoff row on the receiver with the facets the gateway reads', () => {
    const [, hop] = planHops(INPUT.steps);
    const row = hopRow(INPUT, hop, 1, 1);
    expect(row).toMatchObject({ role: 'line-bonder', type: 'handoff', subtype: 'bond', description: 'U1, U2: print-01 → bond-01' });
    expect(row.metadata).toMatchObject({
      siteId: 'site-1', lineId: 'line-1', jobId: 'r1-bond-01', senderJobId: 'r1-print-01', fromMachine: 'print-01',
      toMachine: 'bond-01', recipeId: 'RCP-BOND-B', recipeVersion: '2', process: 'bond', attempt: 1, orderRef: 'order-42',
    });
  });

  it('reads a finished handoff: receipt, error, cancel and timeouts', () => {
    const units = ['U1', 'U2'];
    expect(readHopOutcome({ received: true }, units)).toEqual({ received: true });
    expect(readHopOutcome(null, units)).toMatchObject({ received: false, errorCode: 'cancelled' });
    expect(readHopOutcome({ received: false, errorCode: 'dispatch-refused', reason: 'busy', $trigger: 'resolve' }, units))
      .toMatchObject({ errorCode: 'dispatch-refused', detail: 'busy', missing: ['U1', 'U2'] });
    expect(readHopOutcome({ $trigger: 'timeout', $accumulated: [] }, units)).toMatchObject({ errorCode: 'handoff-timeout' });
    expect(readHopOutcome({ $trigger: 'timeout', $accumulated: [{ itemKey: 'arrived:U1' }] }, units))
      .toMatchObject({ errorCode: 'partial-arrival', arrived: ['U1'], missing: ['U2'] });
  });

  it('reworks from the hop into the named station, or the holding hop', () => {
    const hops = planHops(INPUT.steps);
    expect(reworkHop(hops, hops[2], 'print-01').index).toBe(0);
    expect(reworkHop(hops, hops[2]).index).toBe(2);
    expect(reworkHop(hops, hops[2], 'nowhere').index).toBe(2);
  });

  it('turns a command row into a wait config', () => {
    const target = { siteId: 'site-1', lineId: 'line-1', machineId: 'bond-01', role: 'line-bond' };
    expect(commandWait(target, 'changeover', { recipe: { id: 'RCP-BOND-B', version: '2' } })).toMatchObject({
      role: 'line-bond', type: 'machine-command', subtype: 'changeover', priority: 2,
      metadata: { machineId: 'bond-01', op: 'changeover', args: { recipe: { id: 'RCP-BOND-B', version: '2' } } },
    });
  });
});
