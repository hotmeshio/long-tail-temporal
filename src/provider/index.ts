import {
  DELIVERY_RESULT,
  JOB_STATE,
  type LTDeliveryResult,
  type LTDurableProvider,
  type LTExecutionExportOptions,
  type LTJobStatus,
  type LTWaitOutcome,
  type LTWaitRef,
  type LTWorkflowExecution,
} from '@hotmeshio/long-tail';
import { Client, Connection, WorkflowNotFoundError, type ConnectionOptions } from '@temporalio/client';
import type { DataConverter } from '@temporalio/common';

import { LT_OUTCOME_SIGNAL, TEMPORAL_PROVIDER } from '../constants';
import { mapHistory } from './history-map';
import { toJobStatus, unknownJobStatus } from './status';

export { mapHistory } from './history-map';
export { toJobStatus } from './status';

export interface TemporalProviderConfig {
  /** Temporal frontend, e.g. localhost:7233 or temporal:7233 */
  address?: string;
  namespace?: string;
  /** Optional API key for a Temporal deployment that requires one. */
  apiKey?: string;
  tls?: ConnectionOptions['tls'];
  /** Must match the workers' converter (and codec) so payloads decode and signals encode the same way. */
  dataConverter?: DataConverter;
  /** An existing client; the other connection fields are ignored. */
  client?: Client;
}

/**
 * Temporal as Long Tail's durable provider. Long Tail calls it to deliver
 * each terminal outcome as the `lt.outcome` signal, to describe workflows,
 * export their history as a timeline, and terminate them.
 */
export function temporalProvider(config: TemporalProviderConfig = {}): LTDurableProvider {
  const client = config.client ?? createClient(config);
  const handle = (workflowId: string, runId?: string) => client.workflow.getHandle(workflowId, runId || undefined);

  return {
    name: TEMPORAL_PROVIDER,
    capabilities: { native: false, execution: true, terminate: true },

    async deliver(ref: LTWaitRef, outcome: LTWaitOutcome): Promise<LTDeliveryResult> {
      try {
        await handle(ref.workflowId, ref.runScope).signal(LT_OUTCOME_SIGNAL, outcome);
        return DELIVERY_RESULT.DELIVERED;
      } catch (err) {
        if (err instanceof WorkflowNotFoundError) return DELIVERY_RESULT.GONE;
        throw err;
      }
    },

    async describe(workflowId: string): Promise<LTJobStatus> {
      try {
        return toJobStatus(await handle(workflowId).describe());
      } catch (err) {
        if (err instanceof WorkflowNotFoundError) return unknownJobStatus(workflowId);
        throw err;
      }
    },

    async export(workflowId: string, options?: LTExecutionExportOptions): Promise<LTWorkflowExecution> {
      const workflow = handle(workflowId);
      const description = await workflow.describe();
      const history = await client.workflow.getHandle(workflowId, description.runId).fetchHistory();
      return mapHistory(history, description, client.workflow.options.loadedDataConverter, options);
    },

    async terminate(workflowId: string, reason: string): Promise<void> {
      await handle(workflowId).terminate(reason);
    },
  };
}

function createClient(config: TemporalProviderConfig): Client {
  if (!config.address) throw new Error('temporalProvider: `address` is required (TEMPORAL_ADDRESS)');
  const connection = Connection.lazy({
    address: config.address,
    ...(config.apiKey ? { apiKey: config.apiKey, tls: config.tls ?? true } : config.tls ? { tls: config.tls } : {}),
  });
  return new Client({ connection, namespace: config.namespace ?? 'default', dataConverter: config.dataConverter });
}

export { JOB_STATE };
