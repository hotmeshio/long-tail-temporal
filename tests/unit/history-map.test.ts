import { describe, it, expect } from 'vitest';
import { loadDataConverter } from '@temporalio/common/internal/internal-non-workflow';
import type { WorkflowExecutionDescription } from '@temporalio/client';

import { mapHistory } from '../../src/provider/history-map';
import { reviewOrderFixture } from '../helpers/fixtures';

const converter = loadDataConverter();

describe('mapHistory (recorded reviewOrder)', () => {
  it('maps the run header, result and summary', async () => {
    const { history, description } = reviewOrderFixture();
    const execution = await mapHistory(history, description, converter);
    expect(execution).toMatchObject({
      workflow_id: 'order-fixture', workflow_type: 'reviewOrder', task_queue: 'record',
      status: 'completed', provider_status: 'COMPLETED',
      result: { orderId: 'order-fixture', status: 'shipped order-fixture', notes: 'looks right' },
    });
    expect(execution.duration_ms).toBeGreaterThan(0);
    expect(execution.summary.activities).toMatchObject({ total: 3, completed: 3, system: 1, user: 2 });
    expect(execution.summary.timers).toBe(1);
    expect(execution.summary.signals).toBe(1);
  });

  it('pairs each activity by timeline key with decoded input and result', async () => {
    const { history, description } = reviewOrderFixture();
    const { events } = await mapHistory(history, description, converter);
    const scheduled = events.find((e) => e.event_type === 'activity_task_scheduled' && e.attributes.activity_type === 'scoreOrder')!;
    const completed = events.find((e) => e.event_type === 'activity_task_completed' && e.attributes.timeline_key === scheduled.attributes.timeline_key)!;
    expect(scheduled.attributes.input).toBe('order-fixture');
    expect(completed.attributes.result).toBe('order-fixture'.length % 10);
    expect(completed.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('marks ltOpen as system and opens a signal wait closed by lt.outcome', async () => {
    const { history, description } = reviewOrderFixture();
    const { events } = await mapHistory(history, description, converter);
    const open = events.find((e) => e.attributes.activity_type === 'ltOpen')!;
    expect(open.is_system).toBe(true);
    const wait = events.find((e) => e.event_type === 'signal_wait_started')!;
    const signal = events.find((e) => e.event_type === 'workflow_execution_signaled')!;
    expect(wait.attributes).toMatchObject({ signal_name: 'review-order-fixture', timeline_key: 'w:review-order-fixture', role: 'reviewer' });
    expect(signal.attributes).toMatchObject({ signal_name: 'review-order-fixture', wait_event_id: wait.event_id, status: 'resolved' });
    expect(wait.duration_ms).toBe(signal.duration_ms);
    expect(Date.parse(signal.event_time)).toBeGreaterThanOrEqual(Date.parse(wait.event_time));
  });

  it('gives the timer its fired duration', async () => {
    const { history, description } = reviewOrderFixture();
    const { events } = await mapHistory(history, description, converter);
    const timer = events.find((e) => e.event_type === 'timer_started')!;
    expect(timer.duration_ms).toBeGreaterThanOrEqual(900);
  });

  it('drops system events and payloads on request', async () => {
    const { history, description } = reviewOrderFixture();
    const sparse = await mapHistory(history, description, converter, { excludeSystem: true, omitResults: true });
    expect(sparse.events.some((e) => e.is_system)).toBe(false);
    expect(sparse.events.every((e) => e.attributes.input === undefined && e.attributes.result === undefined)).toBe(true);
    expect(sparse.result).toBeUndefined();
  });

  it('maps a running run with no close time', async () => {
    const { history, description } = reviewOrderFixture();
    const running = { ...description, status: { code: 1, name: 'RUNNING' }, closeTime: undefined } as unknown as WorkflowExecutionDescription;
    const execution = await mapHistory({ events: history.events!.slice(0, 8) }, running, converter);
    expect(execution).toMatchObject({ status: 'running', close_time: null, duration_ms: null });
  });
});
