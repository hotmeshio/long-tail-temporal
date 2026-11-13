/**
 * machineUnitRoute: one set of units through the line. Each hop parks a
 * handoff row for the receiver and collects its items; a machine resolves it
 * through the gateway, a person resolves the last one on the dashboard. A hop
 * that ends without a receipt asks the line's operator: retry the hop, finish
 * the units by hand, or scrap them. Units the sender finished as not ok, or
 * split by a partial arrival, are no longer all at the sender, so those rows
 * offer only manual and scrap. Units finished on hold ask the quality role:
 * release, rework from a station, or scrap.
 */

import { conditional, type LTAccumulatorResult, type LTConditionalConfig, type LTEnvelope } from '@hotmeshio/long-tail-temporal/workflow';
import {
  DECISION, HANDOFF_ERROR, HOLD_DECISIONS, LINE_ROLE, ROW_TYPE, handoffDecisions, signalKeys,
  type Decision, type HandoffUnit, type OperatorResolution, type QualityResolution,
} from '@hotmeshio/long-tail/machines/contracts';

import {
  JOB_RESULT_HOLD, OP, commandWait, hopFacets, hopRow, isMachineStep, jobIdFor, pickupRow, planHops, readHopOutcome, reworkHop, roleOf,
  stationName, type Hop, type HopOutcome, type RouteStep, type UnitRouteInput,
} from './route';

const DEFAULT_HANDOFF_TIMEOUT = '30m';
const OPERATOR_TIMEOUT = '7d';

/** Every row is addressable by its signal key, as on HotMesh. */
const ask = <T>(key: string, config: LTConditionalConfig) => conditional<T>(key, { ...config, signalKey: key });
/** An accumulator wait: it returns its collection on expiry, never `false`. */
const collect = <T>(key: string, config: LTConditionalConfig & { accumulate: object }) => conditional<T>(key, { ...config, signalKey: key });

async function handoff(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt: number): Promise<HopOutcome> {
  const result = await collect<LTAccumulatorResult>(signalKeys.handoff(input.routeKey, hop.index, attempt), {
    ...hopRow(input, hop, attempt, senderAttempt),
    priority: 2,
    accumulate: {},
    timeout: input.handoffTimeout ?? DEFAULT_HANDOFF_TIMEOUT,
  });
  return readHopOutcome(result, input.units.map((u) => u.unitId));
}

/** End a station's job through a command row on its role: `stop` for started work, `cancel` for a job still queued. */
async function stopJob(input: UnitRouteInput, hop: Hop, attempt: number, step: RouteStep | null, jobAttempt: number, op: string): Promise<void> {
  if (!isMachineStep(step)) return;
  const target = { siteId: input.siteId, lineId: input.lineId, machineId: step.machineId, role: roleOf(input, step) };
  await ask(signalKeys.jobStop(input.routeKey, hop.index, attempt), commandWait(target, op, { jobId: jobIdFor(input.routeKey, step, jobAttempt) }));
}

/** Units split by a partial arrival: one group at the receiver, the rest where the hop started. */
function splitGroups(input: UnitRouteInput, hop: Hop, outcome: HopOutcome): { at: RouteStep; units: HandoffUnit[] }[] {
  const of = (ids: string[] = []) => input.units.filter((u) => ids.includes(u.unitId));
  return [{ at: hop.to!, units: of(outcome.arrived) }, ...(hop.from ? [{ at: hop.from, units: of(outcome.missing) }] : [])]
    .filter((g) => g.units.length);
}

/** A person collects each group where it stopped; the route ends once every group is off the line. */
async function collectSplit(input: UnitRouteInput, firstIndex: number, groups: { at: RouteStep; units: HandoffUnit[] }[]) {
  const results = await Promise.all(groups.map((g, i) => collect<LTAccumulatorResult>(signalKeys.handoff(input.routeKey, firstIndex + i, 1), {
    ...pickupRow(input, firstIndex + i, g.at, g.units), priority: 2, accumulate: {},
  })));
  return groups.map((g, i) => ({ at: stationName(g.at), units: g.units.map((u) => u.unitId), received: results[i]?.received === true }));
}

/** Ask a role until it picks one of `decisions`; no answer before the timeout scraps the units. */
async function decide<T extends OperatorResolution>(key: (round: number) => string, decisions: readonly Decision[],
  row: (refused: string, round: number) => LTConditionalConfig): Promise<T> {
  let refused = '';
  for (let round = 1; ; round++) {
    const answer = await ask<T>(key(round), row(refused, round));
    if (!answer) return { decision: DECISION.SCRAP, note: 'no decision before the timeout' } as T;
    if (decisions.includes(answer.decision)) return answer;
    refused = `${answer.decision} is not available here. `;
  }
}

function askOperator(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt: number, outcome: HopOutcome): Promise<OperatorResolution> {
  const decisions = handoffDecisions(outcome.errorCode);
  const units = input.units.map((u) => u.unitId).join(', ');
  return decide((round) => signalKeys.handoffError(input.routeKey, hop.index, attempt, round), decisions, (refused, round) => ({
    role: input.operatorRole ?? LINE_ROLE.OPERATOR,
    type: ROW_TYPE.HANDOFF_ERROR,
    subtype: outcome.errorCode,
    description: `${refused}${units} stopped at ${stationName(hop.from, 'line entry')}: ${outcome.errorCode}. ${outcome.detail ?? ''} Choose ${decisions.join(', ')}.`.replace(/\s+/g, ' ').trim(),
    priority: 1,
    metadata: { ...hopFacets(input, hop, attempt, senderAttempt), errorCode: outcome.errorCode, detail: outcome.detail ?? null, decisions, round },
    timeout: input.operatorTimeout ?? OPERATOR_TIMEOUT,
  }));
}

function askQuality(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt: number, outcome: HopOutcome): Promise<QualityResolution> {
  const units = input.units.map((u) => u.unitId).join(', ');
  return decide<QualityResolution>((round) => signalKeys.hold(input.routeKey, hop.index, attempt, round), HOLD_DECISIONS, (refused, round) => ({
    role: input.qualityRole ?? LINE_ROLE.QUALITY,
    type: ROW_TYPE.QUALITY_HOLD,
    subtype: JOB_RESULT_HOLD,
    description: `${refused}${units} held at ${stationName(hop.from, 'line entry')}. ${outcome.detail ?? ''} Choose ${HOLD_DECISIONS.join(', ')}.`.replace(/\s+/g, ' ').trim(),
    priority: 1,
    metadata: { ...hopFacets(input, hop, attempt, senderAttempt), errorCode: outcome.errorCode, result: outcome.result, detail: outcome.detail ?? null, decisions: HOLD_DECISIONS, round },
    timeout: input.operatorTimeout ?? OPERATOR_TIMEOUT,
  }));
}

/** Tell the holding machine the decision, when its codec has a command for it. */
async function sendDisposition(input: UnitRouteInput, hop: Hop, attempt: number, senderAttempt: number, quality: QualityResolution): Promise<void> {
  if (!input.dispositionOp || !isMachineStep(hop.from)) return;
  const target = { siteId: input.siteId, lineId: input.lineId, machineId: hop.from.machineId, role: roleOf(input, hop.from) };
  const args = { jobId: jobIdFor(input.routeKey, hop.from, senderAttempt), unitIds: input.units.map((u) => u.unitId), decision: quality.decision, note: quality.note ?? null };
  await ask(signalKeys.disposition(input.routeKey, hop.index, attempt), commandWait(target, input.dispositionOp, args));
}

export async function machineUnitRoute(envelope: LTEnvelope<UnitRouteInput>) {
  const input = envelope.data;
  const hops = planHops(input.steps);
  const history: Record<string, unknown>[] = [];
  const ended = (status: string, from: RouteStep | null, extra: Record<string, unknown> = {}) =>
    ({ data: { status, at: stationName(from, 'entry'), ...extra, history } });

  // The attempt that brought the units to the current sender: its job is the one to release them.
  let senderAttempt = 1;
  // Every attempt of a hop has its own signal key, across reruns of the hop after a rework.
  const attempts = new Map<number, number>();
  const nextAttempt = (hop: Hop) => {
    const n = (attempts.get(hop.index) ?? 0) + 1;
    attempts.set(hop.index, n);
    return n;
  };
  for (let h = 0; h < hops.length; ) {
    const hop = hops[h];
    let next = h + 1;
    for (;;) {
      const attempt = nextAttempt(hop);
      const outcome = await handoff(input, hop, attempt, senderAttempt);
      history.push({ hop: hop.index, to: stationName(hop.to), attempt, ...outcome });
      if (outcome.received) {
        senderAttempt = attempt;
        break;
      }
      if (outcome.errorCode === HANDOFF_ERROR.SENDER_REJECTED && outcome.result === JOB_RESULT_HOLD && hop.from) {
        const quality = await askQuality(input, hop, attempt, senderAttempt, outcome);
        await sendDisposition(input, hop, attempt, senderAttempt, quality);
        history.push({ hop: hop.index, held: true, decision: quality.decision, station: quality.station ?? null });
        if (quality.decision === DECISION.RELEASE) continue;
        if (quality.decision === DECISION.REWORK) {
          // The units run again from the station named, carried there from the holding machine.
          const again = reworkHop(hops, hop, quality.station);
          if (again.index === hop.index) continue;
          hops[again.index] = { ...again, from: hop.from };
          next = again.index;
          break;
        }
        return ended('scrapped', hop.from, { note: quality.note });
      }
      // The sender's job is started work: its units are there. The receiver's never started: not every unit arrived.
      if (outcome.errorCode === HANDOFF_ERROR.CANCELLED) await stopJob(input, hop, attempt, hop.from, senderAttempt, OP.STOP);
      const { decision, note } = await askOperator(input, hop, attempt, senderAttempt, outcome);
      if (decision === DECISION.RETRY) continue;
      if (outcome.errorCode === HANDOFF_ERROR.PARTIAL_ARRIVAL && hop.to) {
        await stopJob(input, hop, attempt, hop.to, attempt, OP.CANCEL);
        if (decision === DECISION.SCRAP) return ended('scrapped', hop.from, { note });
        const pickups = await collectSplit(input, hops.length, splitGroups(input, hop, outcome));
        return ended('manual', hop.from, { received: pickups.every((p) => p.received), pickups, note });
      }
      if (decision === DECISION.MANUAL) {
        // The units leave automation; a person takes them from where they stopped.
        const manual = await handoff(input, { index: hops.length, from: hop.from, to: null }, 1, senderAttempt);
        return ended('manual', hop.from, { received: manual.received, note });
      }
      return ended('scrapped', hop.from, { note });
    }
    h = next;
  }
  return { data: { status: 'complete', units: input.units.map((u) => u.unitId), history } };
}
