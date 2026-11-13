/**
 * machineCommand: one step that asks a machine to start, stop, pause, resume
 * or change over. It parks a machine-command row on the machine's role and
 * waits, as it would for a person; the gateway sends the command and resolves
 * the row with the machine's reply. changeover is the same step for a recipe.
 */

import { conditional, type LTEnvelope } from '@hotmeshio/long-tail-temporal/workflow';
import { COMMAND_STATUS, type CommandResolution, type CommandTarget } from '@hotmeshio/long-tail/machines/contracts';

import { OP, commandWait } from './route';

const DEFAULT_COMMAND_TIMEOUT = '10m';

export interface MachineCommandInput extends CommandTarget {
  /** Names this request; part of the signal key. */
  requestKey: string;
  /** A control op, `snapshot`, or one the line's codec declares. */
  op: string;
  args?: Record<string, unknown>;
  /** How long to wait for the row to resolve. */
  timeout?: string;
}

export interface ChangeoverInput extends CommandTarget {
  requestKey: string;
  recipe: { id: string; version: string };
  timeout?: string;
}

export const commandSignalKey = (requestKey: string) => `machine-command-${requestKey}`;

/** Ask the machine for `op` and read its reply; no reply before the timeout reads as `no-reply`. */
async function askMachine(target: CommandTarget, requestKey: string, op: string, args: Record<string, unknown>, timeout = DEFAULT_COMMAND_TIMEOUT): Promise<CommandResolution> {
  const key = commandSignalKey(requestKey);
  const reply = await conditional<CommandResolution>(key, { ...commandWait(target, op, args), signalKey: key, timeout });
  return reply ?? {
    accepted: false, machineId: target.machineId, op, status: COMMAND_STATUS.NO_REPLY, reason: 'the row did not resolve before the timeout',
  };
}

export async function machineCommand(envelope: LTEnvelope<MachineCommandInput>) {
  const { requestKey, op, args = {}, timeout, ...target } = envelope.data;
  return { data: await askMachine(target, requestKey, op, args, timeout) };
}

export async function changeover(envelope: LTEnvelope<ChangeoverInput>) {
  const { requestKey, recipe, timeout, ...target } = envelope.data;
  return { data: await askMachine(target, requestKey, OP.CHANGEOVER, { recipe }, timeout) };
}
