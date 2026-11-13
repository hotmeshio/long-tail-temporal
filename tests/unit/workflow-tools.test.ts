import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { fakeActivities } from '../helpers/fake-activities';
import { startWorkflowEnv, type WorkflowEnv } from '../helpers/workflow-env';

let wf: WorkflowEnv;

describe('tools.call (workflow)', () => {
  beforeAll(async () => {
    const fake = fakeActivities((input) => ({ echoed: input.arguments, server: input.server }));
    wf = await startWorkflowEnv(path.resolve(__dirname, '../workflows/conditional-workflows.ts'), 'tools-test', fake);
  });

  afterAll(async () => {
    await wf.shutdown();
  });

  it('runs the lt.tools.call activity and returns its result', async () => {
    const handle = await wf.start('toolCall', ['long-tail-admin', 'find_escalations', { role: 'reviewer' }]);
    expect(await handle.result()).toEqual({ echoed: { role: 'reviewer' }, server: 'long-tail-admin' });
    expect(wf.fake.toolCalls.at(-1)).toEqual({ server: 'long-tail-admin', tool: 'find_escalations', arguments: { role: 'reviewer' } });
  });

  it('passes executeAs only when given', async () => {
    await (await wf.start('toolCall', ['invoice-tools', 'extract', {}, 'ops-bot'])).result();
    expect(wf.fake.toolCalls.at(-1)).toEqual({ server: 'invoice-tools', tool: 'extract', arguments: {}, executeAs: 'ops-bot' });
  });
});
