import { NativeConnection, Worker } from '@temporalio/worker';
import { LINE_ROLE } from '@hotmeshio/long-tail/machines/contracts';
import { longTailActivities } from '@hotmeshio/long-tail-temporal/worker';

import { bootstrapApiKey } from '../bootstrap';

export const TASK_QUEUE = 'machine-line';
/** The roles the example line parks rows on: two stations, the exit, the operator and quality. */
export const LINE_ROLES = ['line-print', 'line-bond', LINE_ROLE.EXIT, LINE_ROLE.OPERATOR, LINE_ROLE.QUALITY];
const BOT = { name: 'temporal-machine-line', roles: LINE_ROLES.map((role) => ({ role, type: 'admin' as const })) };

/** Runs the machine line workflows and the Long Tail activities. */
async function run() {
  const url = process.env.LT_URL ?? 'http://localhost:3200';
  const apiKey = process.env.LT_API_KEY || (await bootstrapApiKey(url, BOT));
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233' });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities: longTailActivities({ url, apiKey }),
  });
  await worker.run();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
