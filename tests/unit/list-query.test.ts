import { describe, it, expect } from 'vitest';

import { buildListQuery } from '../../src/provider/list-query';

describe('buildListQuery', () => {
  it('leaves out runs that continued as new', () => {
    expect(buildListQuery({ limit: 10, offset: 0 })).toBe(`ExecutionStatus != 'ContinuedAsNew'`);
  });

  it('filters by type, id prefix and state', () => {
    expect(buildListQuery({ limit: 10, offset: 0, workflowType: 'reviewOrder', idPrefix: 'order-', state: 'running' })).toBe(
      `ExecutionStatus != 'ContinuedAsNew' AND WorkflowType = 'reviewOrder' AND WorkflowId STARTS_WITH 'order-' AND ExecutionStatus = 'Running'`,
    );
  });

  it('maps failed to every unsuccessful close', () => {
    expect(buildListQuery({ limit: 10, offset: 0, state: 'failed' })).toContain(`ExecutionStatus IN ('Failed', 'TimedOut', 'Canceled', 'Terminated')`);
  });

  it('refuses quotes and backslashes in values', () => {
    for (const bad of [`x' OR WorkflowType = 'y`, 'a"b', 'a\\b']) {
      expect(() => buildListQuery({ limit: 1, offset: 0, idPrefix: bad })).toThrow(/quotes or backslashes/);
    }
  });
});
