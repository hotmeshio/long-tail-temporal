import { NativeConnection, Worker } from '@temporalio/worker';
import { longTailActivities } from '@hotmeshio/long-tail-temporal/worker';

import * as activities from './activities';

export const TASK_QUEUE = 'orders';

/** Runs the reviewOrder workflow and the Long Tail activities. */
async function run() {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233' });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities: {
      ...activities,
      ...longTailActivities({ url: process.env.LT_URL!, apiKey: process.env.LT_API_KEY! }),
    },
  });
  await worker.run();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
