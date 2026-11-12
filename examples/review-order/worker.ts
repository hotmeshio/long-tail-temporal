import { NativeConnection, Worker } from '@temporalio/worker';
import { longTailActivities } from '@hotmeshio/long-tail-temporal/worker';

import * as activities from './activities';
import { bootstrapApiKey } from './bootstrap';

export const TASK_QUEUE = 'orders';

/** Runs the reviewOrder workflow and the Long Tail activities. */
async function run() {
  const url = process.env.LT_URL ?? 'http://localhost:3200';
  const apiKey = process.env.LT_API_KEY || (await bootstrapApiKey(url));
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233' });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities: {
      ...activities,
      ...longTailActivities({ url, apiKey }),
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
