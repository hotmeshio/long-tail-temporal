import path from 'path';
import type { WorkerOptions } from '@temporalio/worker';

const ROOT = path.resolve(__dirname, '../..');

/** Resolve the package's own `/workflow` entry to source, so examples bundle without a build. */
export const bundlerOptions: WorkerOptions['bundlerOptions'] = {
  webpackConfigHook: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string> | undefined),
      '@hotmeshio/long-tail-temporal/workflow': path.join(ROOT, 'src/workflow/index.ts'),
    };
    return config;
  },
};

export const REVIEW_WORKFLOWS = path.join(ROOT, 'examples/review-order/workflows.ts');
