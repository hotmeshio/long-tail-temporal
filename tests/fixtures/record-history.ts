/**
 * Records a real reviewOrder history for the history-map tests:
 * npx tsx tests/fixtures/record-history.ts
 */
import fs from 'fs';
import path from 'path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { historyToJSON } from '@temporalio/common/proto-utils';

import * as activities from '../../examples/review-order/activities';
import { LT_OUTCOME_SIGNAL } from '../../src/constants';
import { bundlerOptions, REVIEW_WORKFLOWS } from '../helpers/bundle';
import { fakeActivities, outcome } from '../helpers/fake-activities';

async function record() {
  const env = await TestWorkflowEnvironment.createLocal();
  const fake = fakeActivities();
  const worker = await Worker.create({
    connection: env.nativeConnection, taskQueue: 'record', workflowsPath: REVIEW_WORKFLOWS, bundlerOptions,
    activities: { ...activities, ...fake.activities },
  });
  const result = await worker.runUntil(async () => {
    const handle = await env.client.workflow.start('reviewOrder', { taskQueue: 'record', workflowId: 'order-fixture', args: ['order-fixture'] });
    while (!fake.opened.length) await new Promise((r) => setTimeout(r, 50));
    await handle.signal(LT_OUTCOME_SIGNAL, outcome('review-order-fixture', 'resolved', { approved: true, notes: 'looks right' }));
    await handle.result();
    const description = await handle.describe();
    const history = await handle.fetchHistory();
    return {
      history: JSON.parse(historyToJSON(history)),
      description: {
        workflowId: description.workflowId, runId: description.runId, type: description.type, taskQueue: description.taskQueue,
        status: description.status, startTime: description.startTime, closeTime: description.closeTime,
      },
    };
  });
  fs.writeFileSync(path.join(__dirname, 'review-order-history.json'), JSON.stringify(result.history, null, 2));
  fs.writeFileSync(path.join(__dirname, 'review-order-description.json'), JSON.stringify(result.description, null, 2));
  await env.teardown();
}

record().catch((err) => {
  console.error(err);
  process.exit(1);
});
