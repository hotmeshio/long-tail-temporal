import { NativeConnection, Worker } from '@temporalio/worker';
import { longTailActivities, longTailTools } from '@hotmeshio/long-tail-temporal/worker';

import { connectLongTail } from '../long-tail';
import * as activities from './activities';

export const TASK_QUEUE = 'orders';
const BOT = { name: 'temporal-workflows', roles: [{ role: 'reviewer', type: 'admin' as const }] };

/** Runs the review workflows, the Long Tail activities and the MCP tool activity. */
async function run() {
  const lt = await connectLongTail(BOT);
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233' });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities: {
      ...activities,
      ...longTailActivities(lt),
      ...longTailTools(lt),
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
