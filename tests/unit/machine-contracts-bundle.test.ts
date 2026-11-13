import { describe, it, expect } from 'vitest';
import { bundleWorkflowCode } from '@temporalio/worker';

import { bundlerOptions, MACHINE_LINE_WORKFLOWS } from '../helpers/bundle';

describe('machine line contracts in the Temporal workflow bundle', () => {
  it('bundles the machine-line workflows with @hotmeshio/long-tail/machines/contracts', async () => {
    const { code } = await bundleWorkflowCode({ workflowsPath: MACHINE_LINE_WORKFLOWS, ...bundlerOptions });
    expect(code).toContain('machine-command');
    expect(code).toContain('handoff-error-');
    // Nothing server side rides along: no database driver, no HotMesh engine.
    expect(code).not.toMatch(/require\(["']pg["']\)/);
    expect(code).not.toContain('@hotmeshio/hotmesh');
  });
});
