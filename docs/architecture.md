# Architecture

## Three layers

The system separates *deciding* from *permitting* from *doing*, and enforces the
separation with module boundaries rather than convention.

| Layer | Contains | May import |
| --- | --- | --- |
| **Intelligence** | `agents/`, `orchestration/`, `ai/` | the tool registry |
| **Governance** | `policies/` | a narrow read surface (`policies/lookups.ts`) |
| **Execution** | `tools/`, `database/`, `events/`, `memory/` | the database |

An agent that wanted to write a price directly has nowhere to import from. The only
path to a mutation is a declared tool, and every tool call goes through governance.

## Request flow

```
event / goal / question
        │
        ▼
  plan template match          ← deterministic (orchestration/plans.ts)
        │
        ▼
  task DAG, persisted
        │
        ├── task ── agent.run()
        │              │
        │              ├── tool call ──▶ zod validate
        │              │                     │
        │              │                     ▼
        │              │                 governance ──▶ ALLOW ──▶ execute ──▶ audit ──▶ event
        │              │                     │  │
        │              │                     │  └──▶ REQUIRE_APPROVAL ──▶ approval queue
        │              │                     └─────▶ DENY ──▶ audit, nothing runs
        │              │
        │              └── reason() ──▶ AI gateway ──▶ structured result (+ engine label)
        │
        ▼
  results feed forward to dependent tasks
```

## Where the AI boundary sits

| Deterministic code owns | The model owns |
| --- | --- |
| Every figure: margin, ROAS, forecast, profit, conversion | Ranking competing explanations |
| Every policy, permission, budget and risk decision | Explaining evidence in prose |
| Every state mutation | Customer replies |
| Plan construction and task routing | Marketing copy |
| Forecasting (weighted moving average) | Summarising cross-agent findings |

Each agent computes its evidence first and passes a `fallback()` alongside every model
request. If no model is configured — or a configured one errors, times out or returns
unparseable output — the fallback ships and the result is labelled
`Deterministic Business Engine`. The numbers are identical either way.

## Modules

```
agents/         8 agents + shared runtime (status, tool callers, memory, untrusted wrapper)
orchestration/  plan templates + the DAG walker and task state machine
policies/       governance pipeline, policy limits, the read surface it needs
tools/          tool definitions (zod in/out, permission, risk, financial impact) + executor
database/       schema, adapter, all queries and business arithmetic
events/         in-process bus, persistence, SSE fan-out, durable job queue + DLQ
integrations/   the only modules that reach the public internet: supplier gateway,
                Printful client, fulfilment job handler
memory/         retrieval-ranked agent memory + product ranking (the "vector store" seam)
simulation/     deterministic seed, 8 scenarios, the scripted demo story
ai/             gateway: deterministic + hosted providers
app/            App Router pages and API routes
components/     UI primitives, live surfaces, charts, interactive panels
```

## Persistence

SQLite through Node's built-in `node:sqlite` — no native compilation, no service.
29 tables with foreign keys on and indexes on every foreign key plus
`events(created_at)`, `audit_logs(created_at)` and `orders(created_at)`.

`DatabaseAdapter` (`database/db.ts`) is deliberately narrow — `all` / `get` / `run` /
`exec` / `transaction`. That is the seam a hosted Postgres adapter would implement.
Only SQLite ships; writing a backend nobody runs is how a repo rots.

The connection, the event bus and the AI provider are pinned to `globalThis`. Next.js
recompiles modules on every edit in development; without that pinning the app would
open a new database handle per compile and fork the event bus alongside it.

## Events

`EventBus` is an interface; the shipped implementation is in-process. Domain events are
persisted to `events` before subscribers run. Lifecycle chatter — agent status, tool
calls, task transitions — streams to the UI without being stored, because the audit log
already records it and storing it twice would bloat the table for no gain.

`/api/events/stream` is a Server-Sent Events endpoint on the Node runtime. The browser
opens **one** `EventSource` shared by every component on the page through a small
subscriber registry.

## Retrieval

`memory/vector.ts` defines `VectorStore` and implements it lexically: an IDF-weighted
term index over product text, combined with commercial signals (budget fit, stock,
rating, margin, popularity) at configurable weights. Every component of the score is
returned so the UI can show why a product ranked where it did.

At a 50-product catalogue this is more accurate than embeddings and needs no service or
model. Agent memory uses the same idea — term overlap plus an importance prior — so only
relevant memories enter a prompt, never the whole store.

## Failure handling

- **Tool failure** — caught, audited as `FAILED`, returned to the agent as a typed error.
- **Agent failure** — the task retries once with a short backoff, then is marked `FAILED`.
- **Dependent tasks** — marked `BLOCKED` rather than being run on missing input.
- **Model failure** — the deterministic fallback ships; the provider backs off for 60s.
- **Verification** — a result with no observed evidence is rejected even if it reads well.
- **Stale approvals** — approving replays the call through the *full* pipeline, so an
  approval that has gone stale still cannot execute something the rules now forbid.
- **Supplier failure** — retried with exponential backoff, or immediately dead-lettered
  when a retry cannot help (a rejected payload, a missing order). A 429 waits exactly as
  long as the vendor's `retry-after` header asks rather than guessing.
- **Exhausted retries** — the job moves to the dead letter queue and the fulfilment is
  parked in `EXCEPTION` carrying the vendor's own error, where `/fulfillment` shows it.
  One poisonous job never blocks the ones behind it.

## Work that leaves the process

Everything else here is synchronous and in-memory, which is what makes it reproducible.
A supplier call is neither, so it is the one path built to assume failure:

```
fulfill_order → governance → fulfillments row (PENDING_SUPPLIER) → job_queue row
                                                                        │
                                              worker → SupplierGateway → vendor
```

The tool commits intent and returns; the worker makes the call. Vendor latency never
enters the executor, and a failed submission retries instead of vanishing. The queue is
a table rather than Redis because this is a single-process application — a broker would
add an install, a daemon and a second source of truth to gain nothing, and jobs survive
a restart because SQLite does.

`SupplierGateway` mirrors the AI gateway: a deterministic implementation that always
works offline, and a live one (Printful) used only when its credentials are present.
Printful orders are created as drafts, which are never charged and never fulfilled;
confirming a draft is a separate API call this system does not implement.

## Extension seams

| Seam | Shipped | Extension |
| --- | --- | --- |
| `DatabaseAdapter` | SQLite | Postgres / Supabase |
| `EventBus` | In-process | Redis / NATS |
| `VectorStore` | Lexical | Embeddings |
| `AIProvider` | Deterministic, hosted | Any provider |
| Tool registry | 31 tools | Add a definition; governance applies automatically |
| Plan templates | 7 templates | Add a template; triggers and intents route to it |
| Agent transport | MCP over stdio | HTTP/SSE MCP, A2A |

## External agents (MCP)

`tools/mcp-server.ts` speaks MCP over stdio (`npm run mcp`) and is a translation layer,
nothing more: JSON-RPC in, `callTool` out. It holds no privileges of its own — the server
binds to one agent identity from `MCP_AGENT_ID` (default `analytics`, read-only), and that
identity's permissions are the client's permissions. There is no code path from the
protocol to the database that skips governance, because the server has no database import.

`tools/list` generates input schemas from the same Zod definitions the executor validates
against, so a published schema cannot drift from the enforced one. Calls carry an `mcp_…`
correlation id, which is how the audit log separates an external caller from an internal
agent. The MCP SDK is not a dependency — three methods and a line reader is less code than
adding one, and it keeps the zero-native-dependency install intact.
