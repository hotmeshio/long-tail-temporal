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

That is the whole integration on the workflow side. `conditional()` returns the resolver's payload, or `null` when the escalation expired or was cancelled.

## What the team gets

- **Role queues.** Each escalation lands in a role (`reviewer`, `finance`, `support-tier-2`). Members see their queues; admins see everything.
- **Forms and schema enforcement.** The role declares the form and the metadata schema. A resolution that does not match is refused before it reaches the workflow.
- **Claims.** A person claims an item before working it; the claim is a lock with a time window.
- **SLAs.** `timeout: '48h'` becomes the escalation's expiry. Long Tail expires it and the workflow receives `null`.
- **Facets and search.** `metadata` becomes queryable facets (`orderId`, `customerTier`), so queues can be filtered, grouped and counted.
- **A dashboard.** Queues, escalation detail, the workflow's execution timeline read from Temporal history, and a link into the Temporal UI.
- **An API and MCP tools.** Everything a person can do in the dashboard, a service or an AI agent can do over HTTP or MCP, under the same RBAC.

## Getting started in five minutes

Everything runs locally with Docker: Postgres, a self-hosted Temporal server and its UI, Long Tail, and an example worker.

1. **Start the stack.**

   ```bash
   git clone https://github.com/hotmeshio/long-tail-temporal.git
   cd long-tail-temporal
   docker compose up -d
   ```

   Until `@hotmeshio/long-tail` 0.35.0 is on npm, first pack a local long-tail checkout: `./scripts/pack-long-tail.sh ../long-tail`. The image installs it from `vendor/`.

2. **Sign in.** Open http://localhost:3200 and sign in as `superadmin` with the password in `LT_ADMIN_PASSWORD` (`l0ngt@1l` by default; set your own in `.env`).

3. **Create a key for the worker.** In the dashboard, open Admin, Users, Bots. Create a bot with the `reviewer` role (type admin, so it can create escalations there), then create an API key. Or with curl:

   ```bash
   TOKEN=$(curl -s -X POST localhost:3200/api/auth/login -H 'content-type: application/json' \
     -d '{"username":"superadmin","password":"l0ngt@1l"}' | jq -r .token)
   BOT=$(curl -s -X POST localhost:3200/api/bot-accounts -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"name":"orders-worker","roles":[{"role":"reviewer","type":"admin"}]}' | jq -r .id)
   curl -s -X POST localhost:3200/api/bot-accounts/$BOT/api-keys -H "authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -d '{"name":"compose"}' | jq -r .rawKey
   ```

4. **Run the example worker** with that key:

   ```bash
   LT_API_KEY=lt_bot_... docker compose --profile example up -d worker
   ```

5. **Start a workflow** and watch it wait:

   ```bash
   docker compose run --rm worker npx tsx examples/review-order/start-workflow.ts order-1
   ```

6. **Resolve it.** In the dashboard, open the reviewer queue, claim `Review order order-1`, approve it. The workflow completes with your notes. Open the escalation's workflow to see the timeline, or follow the link into the Temporal UI at http://localhost:8080.

## How it works

```text
workflow                          Long Tail                                  people and services
────────                          ─────────                                  ───────────────────
conditional(key, config)
  ├─ ltOpen activity ───────────► open the wait (idempotent) ─► escalation ─► queue, claim, form
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
Everything about the human side: queues, escalation detail with the form, claims, facets, the pace board, roles, users and bots. For a workflow, it shows the execution timeline built from Temporal history (activities, timers, child workflows, and each escalation wait from open to outcome), plus a link into the Temporal UI. Pages specific to HotMesh, Long Tail's built-in engine, are hidden.

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
Batch and accumulate escalations (one escalation collecting many items), listing Temporal workflows inside the Long Tail dashboard, starting Temporal workflows from Long Tail, schedules, and running HotMesh and Temporal workflows in the same deployment. Temporal deployments that require an API key and TLS are a later follow-on; `TEMPORAL_API_KEY` is accepted today but not covered by this guide.

## Reference

**Entry points**

| Import | Use |
|---|---|
| `@hotmeshio/long-tail-temporal/workflow` | `conditional`, `ltOutcome`, `outcomeOf`. Imports only `@temporalio/workflow`, so the Temporal bundler accepts it. |
| `@hotmeshio/long-tail-temporal/worker` | `longTailActivities({ url, apiKey, timeoutMs? })` returning `ltOpen` and `ltClose`. |
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

## Development

```bash
npm install
npm test                    # unit tests, including a local Temporal dev server
npm run test:integration    # Long Tail start() + Temporal + the reviewOrder example over HTTP
npm run build
```

The integration test needs Postgres on `localhost:5415` (long-tail's docker compose) and creates its own `lt_temporal_e2e` database.

During development `@hotmeshio/long-tail` is linked from `../long-tail` (`file:../long-tail`). Once 0.35.0 is published, the dev dependency becomes `^0.35.0`, matching the peer dependency.
