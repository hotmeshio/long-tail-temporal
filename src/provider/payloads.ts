import type { LoadedDataConverter } from '@temporalio/common';
import { decodeArrayFromPayloads } from '@temporalio/common/internal/internal-non-workflow';
import type { temporal } from '@temporalio/proto';

type Payloads = temporal.api.common.v1.IPayloads | null | undefined;
type Failure = temporal.api.failure.v1.IFailure | null | undefined;
type Timestamp = temporal.api.history.v1.IHistoryEvent['eventTime'];

/** Marker for a payload the configured data converter cannot decode. */
export const UNDECODABLE = { undecodable: true } as const;

/** Decoded values of a Payloads field; one value comes back bare. */
export async function decodePayloads(converter: LoadedDataConverter, payloads: Payloads): Promise<unknown> {
  const list = payloads?.payloads;
  if (!list?.length) return undefined;
  try {
    const values = await decodeArrayFromPayloads(converter, list);
    return values.length === 1 ? values[0] : values;
  } catch {
    return UNDECODABLE;
  }
}

/** The parts of a failure worth showing: message, type and cause chain. */
export function describeFailure(failure: Failure): Record<string, unknown> | undefined {
  if (!failure) return undefined;
  return {
    message: failure.message ?? '',
    ...(failure.applicationFailureInfo?.type ? { type: failure.applicationFailureInfo.type } : {}),
    ...(failure.cause ? { cause: describeFailure(failure.cause) } : {}),
  };
}

/** A protobuf int64 (number or Long) as a number. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(String(value));
}

/** A protobuf timestamp in epoch milliseconds. */
export function toEpochMs(timestamp: Timestamp): number {
  if (!timestamp) return 0;
  return toNumber(timestamp.seconds) * 1000 + Math.floor((timestamp.nanos ?? 0) / 1_000_000);
}
