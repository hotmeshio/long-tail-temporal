import { Client, Connection } from '@temporalio/client';

import { reviewOrder } from './workflows';
import { TASK_QUEUE } from './worker';

/** Starts one reviewOrder; the escalation shows up in Long Tail's reviewer queue. */
async function run() {
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233' });
  const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' });
  const orderId = process.argv[2] ?? `order-${Date.now()}`;
  const handle = await client.workflow.start(reviewOrder, { taskQueue: TASK_QUEUE, workflowId: orderId, args: [orderId] });
  console.log(`started ${handle.workflowId}; resolve it in Long Tail, then:`);
  console.log(await handle.result());
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
