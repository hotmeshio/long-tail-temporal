import {
  summarizeExecution,
  type LTExecutionExportOptions,
  type LTWorkflowExecution,
  type LTWorkflowExecutionEvent,
} from '@hotmeshio/long-tail';
import type { WorkflowExecutionDescription } from '@temporalio/client';
import type { LoadedDataConverter } from '@temporalio/common';
import type { temporal } from '@temporalio/proto';

import { LT_ACTIVITY, LT_OUTCOME_SIGNAL } from '../constants';
import type { LTOpenInput, LTOutcome } from '../types';
import { decodePayloads, describeFailure, toEpochMs, toNumber } from './payloads';

type HistoryEvent = temporal.api.history.v1.IHistoryEvent;
type Event = LTWorkflowExecutionEvent;

const SYSTEM_ACTIVITIES: string[] = [LT_ACTIVITY.OPEN, LT_ACTIVITY.CLOSE];
const SYNTHETIC_ID_BASE = 1_000_000;
const RUNNING = ['RUNNING', 'PAUSED'];
const COMPLETED = ['COMPLETED', 'CONTINUED_AS_NEW'];

interface Started { event: Event; at: number; name?: string; input?: unknown }

/** Builds Long Tail's execution timeline from one Temporal run's history. */
export async function mapHistory(
  history: temporal.api.history.v1.IHistory,
  description: WorkflowExecutionDescription,
  converter: LoadedDataConverter,
  options: LTExecutionExportOptions = {},
): Promise<LTWorkflowExecution> {
  const events: Event[] = [];
  const activities = new Map<number, Started>();
  const timers = new Map<string, Started>();
  const children = new Map<number, Started>();
  const waits = new Map<string, Started>();
  let syntheticId = SYNTHETIC_ID_BASE;
  let result: unknown;
  const decode = async (payloads: temporal.api.common.v1.IPayloads | null | undefined) =>
    options.omitResults ? undefined : decodePayloads(converter, payloads);

  const push = (event_id: number, at: number, event_type: string, category: Event['category'],
    attributes: Record<string, unknown>, is_system = false, duration_ms: number | null = null): Event => {
    const event: Event = { event_id, event_type, category, event_time: new Date(at).toISOString(), duration_ms, is_system,
      attributes: { kind: event_type, ...attributes } };
    events.push(event);
    return event;
  };

  for (const ev of history.events ?? []) {
    const id = toNumber(ev.eventId);
    const at = toEpochMs(ev.eventTime);

    if (ev.workflowExecutionStartedEventAttributes) {
      const a = ev.workflowExecutionStartedEventAttributes;
      push(id, at, 'workflow_execution_started', 'workflow', {
        workflow_type: a.workflowType?.name, task_queue: a.taskQueue?.name, input: await decode(a.input),
      });
    } else if (ev.activityTaskScheduledEventAttributes) {
      const a = ev.activityTaskScheduledEventAttributes;
      const name = a.activityType?.name ?? '';
      const input = await decodePayloads(converter, a.input);
      const event = push(id, at, 'activity_task_scheduled', 'activity', {
        activity_type: name, timeline_key: `a:${id}`, ...(options.omitResults ? {} : { input }),
      }, SYSTEM_ACTIVITIES.includes(name));
      activities.set(id, { event, at, name, input });
    } else if (ev.activityTaskCompletedEventAttributes) {
      const a = ev.activityTaskCompletedEventAttributes;
      const scheduled = activities.get(toNumber(a.scheduledEventId));
      const value = await decode(a.result);
      push(id, at, 'activity_task_completed', 'activity', {
        activity_type: scheduled?.name, scheduled_event_id: toNumber(a.scheduledEventId),
        timeline_key: scheduled?.event.attributes.timeline_key, result: value,
      }, scheduled?.event.is_system ?? false, scheduled ? at - scheduled.at : null);
      if (scheduled?.name === LT_ACTIVITY.OPEN) {
        const open = (Array.isArray(scheduled.input) ? scheduled.input[0] : scheduled.input) as LTOpenInput | undefined;
        if (open?.waitKey) {
          const waitEvent = push(++syntheticId, at, 'signal_wait_started', 'signal', {
            signal_name: open.waitKey, timeline_key: `w:${open.waitKey}`, role: open.role,
          });
          waits.set(open.waitKey, { event: waitEvent, at });
        }
      }
    } else if (ev.activityTaskFailedEventAttributes || ev.activityTaskTimedOutEventAttributes || ev.activityTaskCanceledEventAttributes) {
      const a = (ev.activityTaskFailedEventAttributes ?? ev.activityTaskTimedOutEventAttributes ?? ev.activityTaskCanceledEventAttributes)!;
      const scheduled = activities.get(toNumber(a.scheduledEventId));
      push(id, at, 'activity_task_failed', 'activity', {
        activity_type: scheduled?.name, scheduled_event_id: toNumber(a.scheduledEventId),
        timeline_key: scheduled?.event.attributes.timeline_key,
        failure: describeFailure('failure' in a ? a.failure : undefined),
      }, scheduled?.event.is_system ?? false, scheduled ? at - scheduled.at : null);
    } else if (ev.timerStartedEventAttributes) {
      const timerId = ev.timerStartedEventAttributes.timerId ?? String(id);
      const event = push(id, at, 'timer_started', 'timer', { timer_id: timerId, timeline_key: `t:${timerId}` });
      timers.set(timerId, { event, at });
    } else if (ev.timerFiredEventAttributes || ev.timerCanceledEventAttributes) {
      const timerId = (ev.timerFiredEventAttributes ?? ev.timerCanceledEventAttributes)!.timerId ?? '';
      const started = timers.get(timerId);
      if (started) started.event.duration_ms = at - started.at;
      if (started && ev.timerCanceledEventAttributes) started.event.attributes.cancelled = true;
    } else if (ev.workflowExecutionSignaledEventAttributes) {
      const a = ev.workflowExecutionSignaledEventAttributes;
      const input = await decodePayloads(converter, a.input);
      if (a.signalName === LT_OUTCOME_SIGNAL) {
        const outcome = input as LTOutcome | undefined;
        const wait = outcome ? waits.get(outcome.waitKey) : undefined;
        if (wait) wait.event.duration_ms = at - wait.at;
        push(id, at, 'workflow_execution_signaled', 'signal', {
          signal_name: outcome?.waitKey ?? a.signalName, timeline_key: outcome ? `w:${outcome.waitKey}` : undefined,
          wait_event_id: wait?.event.event_id, status: outcome?.status, escalation_id: outcome?.escalationId,
          ...(options.omitResults ? {} : { input }),
        }, false, wait ? at - wait.at : null);
      } else {
        push(id, at, 'workflow_execution_signaled', 'signal', {
          signal_name: a.signalName, ...(options.omitResults ? {} : { input }),
        });
      }
    } else if (ev.startChildWorkflowExecutionInitiatedEventAttributes) {
      const a = ev.startChildWorkflowExecutionInitiatedEventAttributes;
      const event = push(id, at, 'child_workflow_execution_started', 'child_workflow', {
        child_workflow_id: a.workflowId, workflow_type: a.workflowType?.name, timeline_key: `c:${id}`,
      });
      children.set(id, { event, at });
    } else if (ev.childWorkflowExecutionCompletedEventAttributes) {
      const a = ev.childWorkflowExecutionCompletedEventAttributes;
      const initiated = children.get(toNumber(a.initiatedEventId));
      push(id, at, 'child_workflow_execution_completed', 'child_workflow', {
        child_workflow_id: a.workflowExecution?.workflowId, initiated_event_id: toNumber(a.initiatedEventId),
        timeline_key: initiated?.event.attributes.timeline_key, result: await decode(a.result),
      }, false, initiated ? at - initiated.at : null);
    } else if (ev.childWorkflowExecutionFailedEventAttributes || ev.childWorkflowExecutionTimedOutEventAttributes
      || ev.childWorkflowExecutionCanceledEventAttributes || ev.childWorkflowExecutionTerminatedEventAttributes) {
      const a = (ev.childWorkflowExecutionFailedEventAttributes ?? ev.childWorkflowExecutionTimedOutEventAttributes
        ?? ev.childWorkflowExecutionCanceledEventAttributes ?? ev.childWorkflowExecutionTerminatedEventAttributes)!;
      const initiated = children.get(toNumber(a.initiatedEventId));
      push(id, at, 'child_workflow_execution_failed', 'child_workflow', {
        child_workflow_id: a.workflowExecution?.workflowId, initiated_event_id: toNumber(a.initiatedEventId),
        timeline_key: initiated?.event.attributes.timeline_key,
        failure: describeFailure(('failure' in a ? a.failure : undefined) as temporal.api.failure.v1.IFailure | undefined),
      }, false, initiated ? at - initiated.at : null);
    } else if (ev.workflowExecutionCompletedEventAttributes) {
      result = await decode(ev.workflowExecutionCompletedEventAttributes.result);
      push(id, at, 'workflow_execution_completed', 'workflow', { result });
    } else if (ev.workflowExecutionContinuedAsNewEventAttributes) {
      push(id, at, 'workflow_execution_completed', 'workflow', {
        continued_as_new: true, new_run_id: ev.workflowExecutionContinuedAsNewEventAttributes.newExecutionRunId,
      });
    } else if (ev.workflowExecutionFailedEventAttributes) {
      push(id, at, 'workflow_execution_failed', 'workflow', { failure: describeFailure(ev.workflowExecutionFailedEventAttributes.failure) });
    } else if (ev.workflowExecutionTimedOutEventAttributes || ev.workflowExecutionCanceledEventAttributes || ev.workflowExecutionTerminatedEventAttributes) {
      const reason = ev.workflowExecutionTerminatedEventAttributes?.reason
        ?? (ev.workflowExecutionCanceledEventAttributes ? 'cancelled' : 'timed out');
      push(id, at, 'workflow_execution_failed', 'workflow', { failure: { message: reason } });
    } else if (options.mode === 'verbose') {
      pushPassThrough(ev, id, at, push);
    }
  }

  const visible = options.excludeSystem ? events.filter((e) => !e.is_system) : events;
  return toExecution(description, visible, result);
}

function pushPassThrough(ev: HistoryEvent, id: number, at: number,
  push: (id: number, at: number, type: string, category: Event['category'], attributes: Record<string, unknown>, isSystem?: boolean) => Event): void {
  if (ev.workflowExecutionUpdateAcceptedEventAttributes) {
    push(id, at, 'workflow_update_accepted', 'workflow', {
      update_name: ev.workflowExecutionUpdateAcceptedEventAttributes.acceptedRequest?.input?.name,
    }, true);
  } else if (ev.workflowExecutionUpdateCompletedEventAttributes) {
    push(id, at, 'workflow_update_completed', 'workflow', {}, true);
  } else if (ev.markerRecordedEventAttributes) {
    push(id, at, 'marker_recorded', 'workflow', { marker_name: ev.markerRecordedEventAttributes.markerName }, true);
  }
}

function toExecution(description: WorkflowExecutionDescription, events: Event[], result: unknown): LTWorkflowExecution {
  const statusName = description.status.name;
  const start = description.startTime ?? null;
  const close = description.closeTime ?? null;
  return {
    workflow_id: description.workflowId,
    workflow_type: description.type,
    workflow_name: description.type,
    task_queue: description.taskQueue,
    status: RUNNING.includes(statusName) ? 'running' : COMPLETED.includes(statusName) ? 'completed' : 'failed',
    provider_status: statusName,
    start_time: start ? start.toISOString() : null,
    close_time: close ? close.toISOString() : null,
    duration_ms: start && close ? close.getTime() - start.getTime() : null,
    ...(description.parentExecution?.workflowId ? { parent_workflow_id: description.parentExecution.workflowId } : {}),
    ...(result !== undefined ? { result } : {}),
    events,
    summary: summarizeExecution(events),
  };
}
