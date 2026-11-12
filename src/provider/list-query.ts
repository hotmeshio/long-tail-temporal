import { WORKFLOW_LIST_STATE, type LTWorkflowListQuery, type LTWorkflowListState } from '@hotmeshio/long-tail';

const STATE_FILTER: Record<LTWorkflowListState, string> = {
  [WORKFLOW_LIST_STATE.RUNNING]: `ExecutionStatus = 'Running'`,
  [WORKFLOW_LIST_STATE.COMPLETED]: `ExecutionStatus = 'Completed'`,
  [WORKFLOW_LIST_STATE.FAILED]: `ExecutionStatus IN ('Failed', 'TimedOut', 'Canceled', 'Terminated')`,
};

const UNSAFE_LITERAL = /['"\\]/;

/**
 * The visibility query for an executions-list query. Runs that continued as
 * new are left out, so each workflow id appears once, as its latest run.
 */
export function buildListQuery(query: LTWorkflowListQuery): string {
  const clauses = [`ExecutionStatus != 'ContinuedAsNew'`];
  if (query.workflowType) clauses.push(`WorkflowType = '${literal(query.workflowType)}'`);
  if (query.idPrefix) clauses.push(`WorkflowId STARTS_WITH '${literal(query.idPrefix)}'`);
  if (query.state) clauses.push(STATE_FILTER[query.state]);
  return clauses.join(' AND ');
}

function literal(value: string): string {
  if (UNSAFE_LITERAL.test(value)) throw new Error(`List filter may not contain quotes or backslashes: ${value}`);
  return value;
}
