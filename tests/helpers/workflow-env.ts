import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';

import { bundlerOptions } from './bundle';
import { fakeActivities } from './fake-activities';

let n = 0;

/** A time-skipping Temporal environment running `workflowsPath` against fake Long Tail activities. */
export async function startWorkflowEnv(workflowsPath: string, taskQueue: string, fake = fakeActivities()) {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const worker = await Worker.create({
    connection: env.nativeConnection, taskQueue, workflowsPath, bundlerOptions, activities: fake.activities,
  });
  const running = worker.run();
  const nextId = () => `wf-${Date.now()}-${++n}`;
  return {
    env,
    fake,
    nextId,
    start: (workflow: string, args: unknown[], workflowId = nextId()) =>
      env.client.workflow.start(workflow, { taskQueue, workflowId, args }),
    /** Resolves once lt.open ran for the wait. */
    async waitForOpen(workflowId: string, waitKey: string) {
      for (let i = 0; i < 200; i++) {
        const open = fake.opened.find((o) => o.workflowId === workflowId && o.waitKey === waitKey);
        if (open) return open;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`lt.open never ran for ${workflowId}/${waitKey}`);
    },
    async shutdown() {
      worker.shutdown();
      await running;
      await env.teardown();
    },
  };
}

export type WorkflowEnv = Awaited<ReturnType<typeof startWorkflowEnv>>;
