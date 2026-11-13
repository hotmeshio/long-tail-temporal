# Long Tail for Temporal

## Temporal solves reliability. Long Tail solves uncertainty.

Sooner or later, your workflow waits on something outside its control: a reviewer's approval, an agent's answer, a machine's finished cycle. Call `conditional()` there. The work lands in a role's queue, someone resolves it, and the answer comes back to your workflow as a typed value. Temporal keeps owning time, retries and history.

```bash
npm install @hotmeshio/long-tail-temporal
```

```ts
// workflows.ts
import { conditional } from '@hotmeshio/long-tail-temporal/workflow';

export async function reviewOrder(orderId: string) {
  const decision = await conditional<{ approved: boolean }>(`review-${orderId}`, {
    role: 'reviewer',
    type: 'order-review',
    metadata: { orderId },
    timeout: '48h',
  });
  if (!decision) return 'expired or cancelled';
  return decision.approved ? 'approved' : 'rejected';
}

// worker.ts: register the Long Tail activities beside your own
activities: { ...activities, ...longTailActivities({ url: LT_URL, apiKey: LT_API_KEY }) }
```

## What you get

- **Queues by role.** Each wait lands in a role's queue, filtered and counted by its `metadata` facets.
- **Forms.** The role's schema renders the form and validates every answer before it reaches the workflow.
- **Claims.** A person claims an item before working it, so two people never work one item.
- **Deadlines.** `timeout` becomes the escalation's SLA; on expiry the workflow gets `null`.
- **A dashboard.** Queues, escalation detail, your Temporal executions and their timelines, and a link into the Temporal UI.
- **API and MCP.** Anything a person does, a service or an agent can do over HTTP or MCP, under the same permissions. Workflows call MCP tools with `tools.call(server, tool, args)`.
- **Invoke and schedules.** Register a workflow and start it from the dashboard, HTTP, MCP or a cron schedule.

`conditionalOutcome()` returns the whole outcome: `status`, `data`, `escalationId`, `resolvedBy` and `resolvedAt`. Batches, accumulators, signal keys, assignment, lineage and form prefill are options on the same call. Machine line workflows import their contracts from `@hotmeshio/long-tail/machines/contracts`, which fits the workflow bundle.

## Run it

```bash
docker compose up -d --build
```

This runs Postgres, Temporal, the Temporal UI (http://localhost:8080), Long Tail (http://localhost:3200, `superadmin` / `l0ngt@1l`) and two example workers:

- [`examples/review-order`](examples/review-order): a review, a two-sided inspection, an approvals accumulator, and a count of pending reviews through an MCP tool.
- [`examples/machine-line`](examples/machine-line): units moving station to station as handoff rows, and machine commands such as a changeover.

Start a review, resolve it in the dashboard, and the workflow finishes:

```bash
docker compose exec worker npx tsx examples/review-order/start-workflow.ts order-1
```

The Long Tail image reads `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_UI_URL`, `DATABASE_URL` (or `POSTGRES_*`), `JWT_SECRET`, `LT_ADMIN_USER`, `LT_ADMIN_PASSWORD` and `LT_START_CONFIG`: JSON files, comma separated, that register workflows and declare roles.

## Learn more

- [hotmesh.io](https://hotmesh.io)
- [Temporal](https://hotmesh.io/docs/engines/temporal): setup, workers, invoke and schedules
- [conditional()](https://hotmesh.io/docs/build/conditional): options, return values and signal keys
- [Batches and accumulators](https://hotmesh.io/docs/build/batches-and-accumulators)
- [Forms](https://hotmesh.io/docs/build/forms), [MCP](https://hotmesh.io/docs/build/mcp) and [Machines](https://hotmesh.io/docs/build/machines)
- [Durable providers](https://hotmesh.io/docs/engines/providers): the contract between Long Tail and an engine

## Development

```bash
npm install
npm test                    # unit tests, with the Temporal test server
npm run test:integration    # Long Tail and Temporal in process; uses the compose Postgres on port 5426
npm run test:e2e            # the compose stack over HTTP: machine line, MCP tools and schedules
./scripts/smoke.sh          # two reviews on the compose stack
npm run build
```

To release, bump `version` in `package.json` and merge to `main`. CI publishes it to npm, tags it and creates a GitHub release.

## License

See [LICENSE](LICENSE).
