import { NativeConnection, Worker } from '@temporalio/worker';
import { longTailActivities, longTailTools } from '@hotmeshio/long-tail-temporal/worker';

import { bootstrapApiKey } from '../bootstrap';
import * as activities from './activities';

export const TASK_QUEUE = 'orders';
const BOT = { name: 'temporal-workflows', roles: [{ role: 'reviewer', type: 'admin' as const }] };

/** Runs the review workflows, the Long Tail activities and the MCP tool activity. */
async function run() {
  const url = process.env.LT_URL ?? 'http://localhost:3200';
  const apiKey = process.env.LT_API_KEY || (await bootstrapApiKey(url, BOT));
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233' });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities: {
      ...activities,
      ...longTailActivities({ url, apiKey }),
      ...longTailTools({ url, apiKey }),
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
