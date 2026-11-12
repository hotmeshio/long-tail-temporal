# Long Tail for Temporal

## Temporal workflows can now wait on people with one call: `conditional()`

**Long Tail for Temporal gives every Temporal workflow a human queue, roles, forms, claims, SLAs and a dashboard. The workflow code changes by one import and one line.**

HotMeshIO today releases Long Tail for Temporal, a source-available package and container that sits next to an existing self-hosted Temporal deployment. A workflow calls `conditional()` where it needs a person (an approval, a review, a correction), and waits. Long Tail puts the work in the right role's queue, renders the form, tracks who claimed it, expires it on its SLA, and sends exactly one terminal outcome back to the workflow. Temporal keeps owning time, retries and history. Nothing about the Temporal deployment changes.

## The problem

Durable workflows are good at waiting. What they wait on is the hard part. When a step needs a person, Temporal teams build the same things again and again: a table of open tasks, a way to route each task to the right people, a UI to show and resolve it, claim locks so two people do not work the same item, SLA timers, an audit of who decided what, and the plumbing that signals the workflow when someone finishes. That code lives outside the workflow, it is rarely shared between teams, and it is where most of the bugs are.

## The solution: one step sideways

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

The worker adds the two Long Tail activities:

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

That is the whole integration on the workflow side.

### `conditional()` at a glance

```ts
const answer = await conditional<T>(key, ask);
```

- `key` names the wait within the workflow run. Opening the same key again returns the same escalation, so an activity retry never creates a second one.
- `ask` describes the escalation: `role` (the queue), `type`, `description`, `priority` (1 to 4), `metadata` (searchable facets), `data` (shown to the resolver) and `timeout` (the SLA, such as `'48h'`).
- `answer` is the resolver's payload, typed as `T`, or `null` when the escalation expired or was cancelled.

The same call works in HotMesh and DBOS workflows. Long Tail's documentation is at [hotmesh.io](https://hotmesh.io/docs/start/quickstart); [conditional()](https://hotmesh.io/docs/build/conditional) covers roles, forms and facets in depth.

## What the team gets

- **Role queues.** Each escalation lands in a role (`reviewer`, `finance`, `support-tier-2`). Members see their queues; admins see everything.
- **Forms and schema enforcement.** The role declares the form and the metadata schema. A resolution that does not match is refused before it reaches the workflow.
- **Claims.** A person claims an item before working it; the claim is a lock with a time window.
- **SLAs.** `timeout: '48h'` becomes the escalation's expiry. Long Tail expires it and the workflow receives `null`.
- **Facets and search.** `metadata` becomes queryable facets (`orderId`, `customerTier`), so queues can be filtered, grouped and counted.
- **A dashboard.** Queues, escalation detail, a list of Temporal workflow executions, each workflow's timeline read from Temporal history, and a link into the Temporal UI.
- **An API and MCP tools.** Everything a person can do in the dashboard, a service or an AI agent can do over HTTP or MCP, under the same RBAC.

## Getting started in five minutes

Everything runs locally with Docker: Postgres, a self-hosted Temporal server and its UI, Long Tail, and an example worker.

```bash
docker compose up -d --build                # Postgres, Temporal, Temporal UI, Long Tail and the example worker
docker compose exec worker npx tsx examples/review-order/start-workflow.ts order-1
```

Open http://localhost:3200, sign in as `superadmin` / `l0ngt@1l` (set `LT_ADMIN_PASSWORD` in `.env` to change it), open the **reviewer** queue, claim `Review order order-1` and approve it. The start script prints the workflow's result. Open the escalation's workflow to see the timeline, or follow the link into the Temporal UI at http://localhost:8080.

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

**What is out of scope for now?**
Batch and accumulate escalations (one escalation collecting many items), starting Temporal workflows from Long Tail, schedules, and running HotMesh and Temporal workflows in the same deployment. Temporal deployments that require an API key and TLS are a later follow-on; `TEMPORAL_API_KEY` is accepted today but not covered by this guide.

## Reference

**Entry points**

| Import | Use |
|---|---|
| `@hotmeshio/long-tail-temporal/workflow` | `conditional`, `ltOutcome`, `outcomeOf`. Imports only `@temporalio/workflow`, so the Temporal bundler accepts it. |
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
| `LT_START_CONFIG` | Optional JSON file with further `start()` settings, such as role titles or SSO. |

## Development

```bash
npm install
npm test                    # unit tests, including a local Temporal dev server
npm run test:integration    # Long Tail start() + Temporal + the reviewOrder example over HTTP
npm run build
```

The integration test uses this repo's Postgres (`docker compose up -d postgres`, port 5426; set `PG_PORT` to point elsewhere) and creates its own `lt_temporal_e2e` database. It runs Temporal in process with the SDK's test server.

The image installs `@hotmeshio/long-tail` from npm. To try an unreleased build, run `./scripts/pack-long-tail.sh ../long-tail`; the image then installs `vendor/*.tgz` instead.
