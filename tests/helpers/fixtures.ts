import fs from 'fs';
import path from 'path';
import { historyFromJSON } from '@temporalio/common/proto-utils';
import type { WorkflowExecutionDescription } from '@temporalio/client';

const DIR = path.resolve(__dirname, '../fixtures');

/** The recorded reviewOrder run: its history and description. */
export function reviewOrderFixture() {
  const history = historyFromJSON(JSON.parse(fs.readFileSync(path.join(DIR, 'review-order-history.json'), 'utf-8')));
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'review-order-description.json'), 'utf-8'));
  const description = {
    ...raw,
    startTime: new Date(raw.startTime),
    closeTime: raw.closeTime ? new Date(raw.closeTime) : undefined,
  } as WorkflowExecutionDescription;
  return { history, description };
}
