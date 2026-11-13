# Long Tail for Temporal

## Temporal solved reliability. Long Tail solves uncertainty.

Sooner or later your Temporal workflow waits on something it can't control: a reviewer's approval, a correction, a decision only a person can make. Call `conditional()` there. The workflow waits, the work lands in the right role's queue, and the answer comes back as a typed value.

```ts
import { proxyActivities } from '@temporalio/workflow';
import { conditional } from '@hotmeshio/long-tail-temporal/workflow';

export async function reviewOrder(orderId: string) {
  const { scoreOrder, shipOrder } = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute' });
  const risk = await scoreOrder(orderId);

  const decision = await conditional<{ approved: boolean; notes?: string }>(`review-${orderId}`, {
    role: 'reviewer',
    type: 'order-review',
    description: `Review order ${orderId}`,
    metadata: { orderId, risk },
    timeout: '48h',
  });

  if (!decision) return { status: 'expired-or-cancelled' };
  return decision.approved ? { status: await shipOrder(orderId) } : { status: 'rejected' };
}
```

The worker adds two Long Tail activities:

```ts
import { Worker } from '@temporalio/worker';
import { longTailActivities } from '@hotmeshio/long-tail-temporal/worker';

const worker = await Worker.create({
  taskQueue: 'orders',
  workflowsPath: require.resolve('./workflows'),
  activities: {
    ...activities,
    ...longTailActivities({ url: process.env.LT_URL!, apiKey: process.env.LT_API_KEY! }),
  },
});
```

A reviewer opens the `reviewer` queue in the Long Tail dashboard, claims the review, fills in the role's form and submits. The workflow resumes with their answer. Temporal keeps owning time, retries and history.

### Why build the wait yourself?

Every wait needs the same plumbing: a queue, routing to the right people, claims so two people never work one item, a form, permissions, a deadline, an audit trail, and the code that signals the workflow when someone answers. Teams rebuild it for every project, and it is never the product. One call covers all of it, and your Temporal deployment stays exactly as it is.

- **Role queues.** Each escalation lands in a role (`reviewer`, `finance`, `support-tier-2`). Members see their queues; admins see everything.
- **Forms and schema enforcement.** The role declares the form and the metadata schema. A resolution that fails it is refused before it reaches the workflow.
- **Claims.** A person claims an item before working it; the claim is a lock with a time window.
- **Deadlines.** `timeout: '48h'` becomes the escalation's expiry. Long Tail expires it and the workflow receives `null`.
- **Facets and search.** `metadata` becomes queryable facets (`orderId`, `customerTier`), so queues can be filtered, grouped and counted.
- **A dashboard.** Queues, escalation detail, a list of Temporal workflow executions, each workflow's timeline read from Temporal history, and a link into the Temporal UI.
- **An API and MCP tools.** Anything a person does in the dashboard, a service or an AI agent can do over HTTP or MCP, under the same permissions.
- **Invoke and schedules.** Register a Temporal workflow and people, services and agents start it from the dashboard's Invoke Tool, HTTP or MCP, or Long Tail starts it on a schedule.

### `conditional()` at a glance

```ts
const answer = await conditional<T>(key, ask);
```

- `key` names the wait within the workflow run. Opening the same key again returns the same escalation, so an activity retry reuses it.
- `ask` describes the escalation: `role` (the queue), `type`, `description`, `priority` (1 to 4), `metadata` (searchable facets), `data` (shown to the resolver) and `timeout` (the deadline, such as `'48h'`).
- `answer` is the resolver's payload, typed as `T`, or `null` when the escalation expired or was cancelled.

The same call works in HotMesh and DBOS workflows. Long Tail's documentation is at [hotmesh.io](https://hotmesh.io/docs/start/quickstart); [conditional()](https://hotmesh.io/docs/build/conditional) covers roles, forms and facets in depth.

## Collect many items in one escalation

One wait can gather many answers: both sides of an inspection, every box in a delivery, approvals from several people. Declare it in `conditional()` with the same fields HotMesh workflows use. `LTAccumulatorResult` and `LTBatchMarkers` come from `@hotmeshio/long-tail-temporal/workflow`.

```ts
// One fill per declared key; the last fill returns every item, keyed by item.
const sides = await conditional<Record<'left' | 'right', { passed: boolean }>>(`inspect-${orderId}`, {
  role: 'reviewer',
  type: 'order-inspection',
  metadata: { orderId },
  batch: ['left', 'right'],
  partialOnTimeout: true,          // on expiry, return the sides inspected so far
  timeout: '4h',
});

// Any item keys until `max` arrive, the deadline passes, or a person closes it.
const approvals = await conditional<LTAccumulatorResult<{ approver: string }>>(`approvals-${orderId}`, {
  role: 'reviewer',
  type: 'order-approvals',
  metadata: { orderId },
  accumulate: { max: 2 },
  timeout: '24h',
});
approvals?.$accumulated.map((item) => item.payload?.approver);   // in arrival order
approvals?.$trigger;                                               // 'count', 'timeout' or 'resolve'
```

People, services and agents fill items through `POST /api/escalations/:id/resolve-batch-item` and `POST /api/escalations/:id/accumulate`, the matching MCP tools, scan rules or the dashboard. Each batch item is validated against the role's form.

| Declaration | Returns |
|---|---|
| `batch` | Every item when the last key is filled |
| `batch` + `wakeOnFill` | The items so far when a listed key is filled, with `$filled` and `$trigger: 'fill'` |
| `batch` + `wakeOnFlag` | The items so far when someone flags an item, with `$flags` and `$trigger: 'flag'` |
| `batch` + `partialOnTimeout` | On expiry, the items so far with `$trigger: 'timeout'` |
| `batch` + `filled` | Starts with those items already satisfied |
| `accumulate` | `$accumulated` and `$trigger`: `count` at `max`, `timeout` on expiry, `resolve` (with the resolver's payload) when a person closes it |

Cancellation returns `null`, as for any wait. A batch without `partialOnTimeout` returns `null` on expiry.

## Getting started in five minutes

Everything runs locally with Docker: Postgres, a self-hosted Temporal server and its UI, Long Tail, and an example worker.

```bash
docker compose up -d --build                # Postgres, Temporal, Temporal UI, Long Tail and the example worker
docker compose exec worker npx tsx examples/review-order/start-workflow.ts order-1
```

Open http://localhost:3200, sign in as `superadmin` / `l0ngt@1l` (set `LT_ADMIN_PASSWORD` in `.env` to change it), open the **reviewer** queue, claim `Review order order-1` and approve it. The start script prints the workflow's result. Open the escalation's workflow to see the timeline, or follow the link into the Temporal UI at http://localhost:8080.

Start one from Long Tail instead: open **Invoke Tool**, choose `reviewOrderRequest`, enter an order id and submit. `inspectOrderRequest` and `collectApprovalsRequest` show batch and accumulate waits the same way. The review lands in the same **reviewer** queue; resolve it, and the Invoke Tool shows the result. `examples/review-order/long-tail.json` registers that workflow.

Try the worker restart while the review is waiting:

```bash
docker compose exec worker npx tsx examples/review-order/start-workflow.ts order-2
docker compose restart worker               # the worker goes away mid-wait
# resolve order-2 in the dashboard; Temporal holds the signal and the restarted worker completes the workflow
```

| Port | Service | Override |
|---|---|---|
| 3200 | Long Tail dashboard and API | `LT_PORT` |
| 8080 | Temporal UI | |
| 7233 | Temporal frontend (gRPC) | |
| 5426 | Postgres (`longtail`, `temporal`, `temporal_visibility`) | `PG_PORT` |

The example worker mints its own Long Tail bot key at startup by signing in as the admin. That is a local convenience; in production, create a bot with write access to your roles once in the dashboard and set `LT_API_KEY`.

### Developing against `temporal server start-dev`

If you already develop with the Temporal CLI's dev server, keep it, and run only Postgres and Long Tail from compose:

```bash
temporal server start-dev --ip 0.0.0.0      # Temporal on :7233, its UI on :8233
TEMPORAL_ADDRESS=host.docker.internal:7233 TEMPORAL_UI_URL=http://localhost:8233 \
  docker compose up -d --build --no-deps postgres long-tail
LT_URL=http://localhost:3200 LT_ADMIN_USER=superadmin LT_ADMIN_PASSWORD=l0ngt@1l \
  npx tsx examples/review-order/worker.ts   # your worker, on your machine, as usual
```

## Start workflows from Long Tail

Register a workflow, and people, services and agents can start it from the Invoke Tool, `POST /api/workflows/:type/invoke` or the `invoke_workflow` MCP tool. A config with a `cronSchedule` runs it on that schedule. Long Tail passes every workflow it starts one argument, the envelope:

```ts
import { conditional, type LTEnvelope } from '@hotmeshio/long-tail-temporal/workflow';

export async function reviewOrderRequest(envelope: LTEnvelope<{ orderId: string }>) {
  return { data: await reviewOrder(envelope.data.orderId) };
}
```

- `envelope.data` is the invoke input, checked against the config's `inputSchema` before anything starts.
- `envelope.metadata` carries the caller's metadata; `envelope.lt` says who started the run.
- Returning `{ data }` shows that payload in the Invoke Tool when the run completes.

Register the workflow in code, through `workers` in `start()` or `LT_START_CONFIG`; `taskQueue` is the Temporal task queue your workers poll:

```json
{
  "workers": [{
    "taskQueue": "orders",
    "workflow": "reviewOrderRequest",
    "config": {
      "invocable": true,
      "invocationRoles": ["reviewer"],
      "inputSchema": { "type": "object", "properties": { "orderId": { "type": "string" } }, "required": ["orderId"] }
    }
  }]
}
```

The dashboard's Registry page, `PUT /api/workflows/:type/config` and the `upsert_workflow_config` MCP tool register workflows too. The invoke checks match HotMesh's: `invocable`, invocation roles, bot key scopes, the input schema and `execute_as`. Long Tail starts the run with `client.workflow.start(type, { taskQueue, workflowId, args: [envelope] })`.

## How it works

```text
workflow                          Long Tail                                  people and services
────────                          ─────────                                  ───────────────────
conditional(key, config)
  ├─ lt.open activity ──────────► open the wait (idempotent) ─► escalation ─► queue, claim, form
  └─ wait for signal lt.outcome                                              resolve or cancel
                                  row reaches a terminal state ◄──────────── (or the SLA expires)
                                  relay ─► signal lt.outcome to the workflow
  ◄─ payload or null
```

Long Tail stores the escalation and a wait record in Postgres. A relay watches for escalations that reach a terminal state and signals the workflow, retrying until the signal lands or the workflow no longer exists.

## FAQ

**What does Temporal still own, and what does Long Tail own?**
Temporal owns the workflow: time, retries, history, determinism, task queues and workers. Long Tail owns everything between "a person needs to do this" and "here is the answer": the escalation row, role routing, RBAC, claims, forms, schema checks, facets, priority, SLA expiry, cancellation by a person, and delivery of the outcome.

**Do I run Temporal myself?**
Yes. Temporal is its own server cluster to operate: the frontend, history, matching and worker services, plus its persistence. Long Tail does not run it for you. It can share the same Postgres server as Long Tail, on separate databases: the compose file runs one Postgres with `longtail` for Long Tail and `temporal` plus `temporal_visibility` for Temporal. Production teams usually give Temporal its own database server once load grows.

**How is the outcome delivered?**
As the Temporal signal `lt.outcome`, sent to the workflow run that opened the wait. Signals are stored by Temporal even when no worker is running, so a resolution made overnight is waiting for the workflow in the morning. The relay retries failed deliveries with capped backoff. If the run no longer exists, the delivery is recorded as gone and not retried. A retry can deliver the same outcome twice; the workflow keeps the first one per key.

**What does the key mean?**
It names the wait within one workflow run, and opening the same key twice returns the same escalation, so an activity retry never creates a second one. Use a unique key per wait: in a loop, include the round (`review-${orderId}-${round}`). The key is scoped to the run, so after continue-as-new the same key opens a new escalation.

**How do SLAs and expiry work?**
`timeout` (`'30s'`, `'15m'`, `'48h'`, `'7d'`, `'2w'` or milliseconds) becomes the escalation's expiry, computed from workflow time. Long Tail expires the escalation when it passes and the workflow receives `null`. There is no engine timer in the workflow; Long Tail is the single owner of the SLA. A malformed timeout fails the workflow immediately rather than retrying.

**What happens on cancel?**
When a person cancels the escalation, the workflow receives `null`. When the workflow itself is cancelled while waiting, `conditional()` closes the escalation before rethrowing the cancellation. If a workflow ends some other way (terminated, timed out), Long Tail's reconcile pass finds the pending escalation and cancels it.

**What does the dashboard show?**
Everything about the human side: queues, escalation detail with the form, claims, facets, the pace board, roles, users and bots. **Executions** (under Workflows in the sidebar) lists Temporal workflows from Temporal's visibility store, filtered by workflow id prefix, workflow type and state, with the total from Temporal's count. Each workflow id appears once, as its latest run. For a workflow, it shows the execution timeline built from Temporal history (activities, timers, child workflows, and each escalation wait from open to outcome), plus a link into the Temporal UI. Pages specific to HotMesh, Long Tail's built-in engine, are hidden.

**What about continue-as-new?**
Each run is its own scope for keys. The timeline shows the latest run; the Temporal UI link reaches earlier runs.

**We use a custom data converter or payload codec.**
Pass the same `dataConverter` to `temporalProvider()` that the workers use. Long Tail uses it to decode history for the timeline and to encode the outcome signal.

**Which versions?**
The TypeScript SDK `@temporalio/*` 1.25. The compose file runs Temporal server 1.32.2 and UI 2.58.1.

**Can workers in other languages use it?**
The contract is small: `POST /api/escalations/waits` to open a wait, and a signal named `lt.outcome` carrying `{ waitKey, escalationId, status, data }`. A Go, Python or Java helper can implement `conditional()` against it. This package ships the TypeScript side today.

**How is it licensed?**
Source available, under Apache 2.0 with the Commons Clause. In plain words: use it, modify it and self-host it freely, in production and inside your organization, and build your own products on it. Selling Long Tail for Temporal itself, as a product or a hosted service, is reserved to HotMeshIO. See [LICENSE](./LICENSE).

**Which Long Tail features need HotMesh?**
HotMesh workflows running beside Temporal workflows in one Long Tail deployment, YAML pipelines, triage and the AI query surfaces.

**Temporal Cloud?**
`TEMPORAL_API_KEY` connects with an API key over TLS. This guide's examples use a self-hosted server.

## Reference

**Entry points**

| Import | Use |
|---|---|
| `@hotmeshio/long-tail-temporal/workflow` | `conditional`, `ltOutcome`, `outcomeOf`, and the `LTEnvelope`, `LTAccumulatorResult` and `LTBatchMarkers` types. Imports only `@temporalio/workflow`, so the Temporal bundler accepts it. |
| `@hotmeshio/long-tail-temporal/worker` | `longTailActivities({ url, apiKey, timeoutMs? })` returning `lt.open` and `lt.close`. |
| `@hotmeshio/long-tail-temporal/provider` | `temporalProvider({ address, namespace, dataConverter?, client? })` for Long Tail's `start({ durable: { provider } })`. |
| `@hotmeshio/long-tail-temporal` | All of the above plus `startLongTailTemporal()`, the container entry. |

**Container environment**

| Variable | Meaning |
|---|---|
| `TEMPORAL_ADDRESS` | Temporal frontend, e.g. `temporal:7233`. Required. |
| `TEMPORAL_NAMESPACE` | Default `default`. |
| `TEMPORAL_UI_URL` | Temporal UI base URL; enables the dashboard link. |
| `DATABASE_URL` or `POSTGRES_HOST/PORT/USER/PASSWORD/DB` | Long Tail's database. |
| `PORT`, `JWT_SECRET` | Long Tail's HTTP port and token secret. |
| `LT_ADMIN_USER`, `LT_ADMIN_PASSWORD`, `LT_ADMIN_EMAIL` | Seeds the first superadmin. |
| `LT_ROLES` | Comma-separated roles to declare at boot, e.g. `reviewer`. |
| `LT_START_CONFIG` | Optional JSON file with further `start()` settings, such as role titles, SSO, or `workers` that register workflows for invoke. |

## Development

```bash
npm install
npm test                    # unit tests, including a local Temporal dev server
npm run test:integration    # Long Tail start() + Temporal + the reviewOrder example over HTTP
./scripts/smoke.sh          # two reviews on the running compose stack, one started from Long Tail
npm run build
```

The integration test uses this repo's Postgres (`docker compose up -d postgres`, port 5426; set `PG_PORT` to point elsewhere) and creates its own `lt_temporal_e2e` database. It runs Temporal in process with the SDK's test server.

The image installs `@hotmeshio/long-tail` from npm. To try an unreleased build, run `./scripts/pack-long-tail.sh ../long-tail`; the image then installs `vendor/*.tgz` instead.

### Releasing

CI runs on every pull request and every push to `main`. To release, bump `version` in `package.json` and merge to `main`. The Release workflow runs CI again, publishes the version to npm with provenance, tags `v<version>` and creates a GitHub release. A version npm already has is skipped.
