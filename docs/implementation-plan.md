# Implementation Plan — Multi-Agent Commerce OS

This document is the output of step §94 of the build brief: inspect first, critique the
proposed architecture, revise where it is wrong, then implement.

> **Historical.** This is the plan as written before the build, kept because the critique
> in §3 is the reasoning behind decisions the code still follows. It describes seven
> agents and 28 tools; there are now eight and 31. What shipped after it was finished:
>
> | Added | Where it is documented |
> | --- | --- |
> | MCP server over the governed tool registry | README → *MCP server*, ADR in `decisions.md` |
> | Durable job queue with backoff and a dead letter queue | ADR-019, ADR-020 |
> | Fulfillment Agent and the dropship pipeline | `agents.md`, README → *Fulfilment* |
> | Live Printful supplier, draft orders only | ADR-021 |
> | Customer replies grounded in real order state | `agents.md` → *Replies are grounded* |
> | Shared-password gate and container deployment | ADR-022, README → *Deploying* |
>
> §3.1 is also reversed: a hosted model is now the primary reasoning path and the
> deterministic engine the fallback. ADR-016 records why and what constrains it.

---

## 1. Repository inspection (starting state)

| Question | Finding |
| --- | --- |
| Existing framework | None. The directory held a single throwaway Python prototype (`commerce_os.py`) and a SQLite file. Both were deleted — they are superseded by this application and share no code. |
| Existing components | None. |
| Existing dependencies | None. |
| Existing database config | None. |
| Existing AI integrations | None. |
| Reusable code | None. Greenfield. |

Toolchain present: Node v24.18.0, npm 12.0.1. **Node 24 ships a stable built-in
`node:sqlite`**, which materially changes the right database choice (see §3.6).

---

## 2. Constraints that drive the architecture

1. **₹0 / $0 recurring cost.** No paid infrastructure, no required API credits.
2. **Nothing heavy runs on the developer's machine.** No local model runtime, no Docker,
   no Postgres, no Redis, no background daemons. The entire system is one Node process
   plus a small SQLite file.
3. **No faked AI.** Anything simulated, estimated or deterministic must say so on screen.
4. **Live-demo reliability.** A 5–7 minute judged demo must produce the same result every
   time it is run, on a laptop, with no network.

Constraint 2 is new relative to the original brief and is the single biggest change: the
brief made a local Ollama model the mandatory default provider. That is now out.

---

## 3. Flaws found in the proposed architecture, and the revisions

### 3.1 Local model as the default provider — **removed**

*Proposed:* `OllamaProvider` MUST be the default; demo mode is a fallback.

*Problems:*
- It contradicts the brief's own §48 ("clone, `npm install`, `npm run dev`, no setup") —
  a judge would first need to install a runtime and pull multiple GB of weights.
- It violates the machine-load constraint.
- 7B-class local models are unreliable at multi-step structured tool-calling. The most
  impressive part of the demo would be the least reproducible part of it.

*Revision — invert the hierarchy.* The deterministic reasoning engine is the **primary,
always-available** path, not a fallback. A hosted free-tier model is an **optional
enhancement**:

```
AIGateway
├── DeterministicProvider   default; no network, no key, no local compute
└── HostedProvider          optional; OpenAI-compatible HTTP, free tiers
```

`HostedProvider` speaks the OpenAI-compatible chat-completions shape, which Groq, Google
Gemini and OpenRouter all expose on their free tiers — one adapter, three providers, zero
local compute. It is enabled only when `AI_BASE_URL` + `AI_API_KEY` are set, and the UI
labels which engine produced every piece of reasoning.

### 3.2 The LLM was given the orchestration job — **moved to deterministic code**

*Proposed:* the orchestrator uses the model to decompose goals, select agents, and resolve
dependencies (§10).

*Problem:* that is simultaneously the least reliable thing to delegate to a model and the
most load-bearing thing in the demo. A malformed plan breaks the whole run.

*Revision:* plan construction is a **deterministic task DAG** built by matching a goal
against registered plan templates. The model's job is narration, hypothesis ranking, and
explanation — the parts where language is genuinely the right tool. The visible behaviour
is identical; the reproducibility is not.

This is a specific application of the brief's own §85: the LLM is not the source of truth.

### 3.3 Vector database — **replaced with local lexical scoring**

*Proposed:* pgvector on Supabase, or a local vector store.

*Problem:* the catalogue is 50 products. Embedding search is strictly worse than
attribute-aware lexical scoring at that size, and it drags in either a service or an
embedding model.

*Revision:* `VectorStore` interface retained; the implementation is deterministic
token-overlap + attribute/budget scoring. Documented as such, not dressed up as semantic
search.

### 3.4 Three abstractions with one implementation each — **interfaces kept, dead backends dropped**

`RedisEventBus`, `SupabaseAdapter`, and `SupabaseVectorStore` were all specified as
optional alternates. Writing backends nobody runs is how a repo rots. Each interface is
defined and documented as the extension point; exactly one implementation ships.

### 3.5 Policy / risk / budget as three subsystems — **merged into one governance pipeline**

They are three checks over the same action, not three systems. They now compose in one
module with one result type, so an action cannot pass policy and silently skip the budget
check — a real correctness risk in the split design.

### 3.6 `better-sqlite3` — **replaced with `node:sqlite`**

The obvious SQLite driver needs a native compile step, which can fail on a fresh machine
and adds install load. Node 24 ships `node:sqlite` as a stable builtin. Zero native
dependencies, nothing to compile, same synchronous API ergonomics.

### 3.7 Visual product search — **deferred, not faked**

§29 asks for image-based search, and §65 forbids pretending something was analysed by AI
when it wasn't. Without a vision model there is no honest implementation. It is therefore
listed in the roadmap as not implemented, with the reason. Shipping a fake would violate
the brief's central rule.

### 3.8 18 routes, several of them thin CRUD — **routes kept, implementations shared**

Every route in §53 exists. The thin ones (products, customers) are views composed from the
same data components as the intelligence pages rather than separate hand-built screens.

### 3.9 SSE + module-level singletons under HMR — **fixed with a global singleton**

Not in the brief, but a real trap: Next.js dev recompiles modules, which would create
multiple event buses and duplicate every event. The bus, database handle and runtime
registry are pinned to `globalThis`.

---

## 4. Revised system architecture

```
                          ┌─────────────────────────────┐
                          │        Command Center       │
                          │   (Next.js App Router UI)   │
                          └──────────────┬──────────────┘
                                         │ REST + SSE
                          ┌──────────────▼──────────────┐
   INTELLIGENCE           │        Orchestrator         │
                          │  deterministic plan DAG     │
                          │  + agent task state machine │
                          └──────────────┬──────────────┘
                                         │
        ┌───────────┬───────────┬────────┼────────┬───────────┬───────────┐
        ▼           ▼           ▼        ▼        ▼           ▼           ▼
      CEO      Analytics   Inventory  Pricing  Marketing  Customer   Procurement
        └───────────┴───────────┴────────┼────────┴───────────┴───────────┘
                                         │ typed tool calls
                          ┌──────────────▼──────────────┐
   GOVERNANCE             │     Governance Pipeline     │
                          │  schema → permission →      │
                          │  policy → risk → budget     │
                          └──────────────┬──────────────┘
                                         │ ALLOW / REQUIRE_APPROVAL / DENY
                          ┌──────────────▼──────────────┐
   EXECUTION              │        Tool Registry        │
                          │  deterministic implementations
                          └──────────────┬──────────────┘
                                         │
              ┌──────────────┬───────────┴────┬──────────────┐
              ▼              ▼                ▼              ▼
         SQLite DB      Event Bus        Audit Log      Agent Memory
                             │
                             ▼
                     Commerce Simulator
```

The three layers are enforced by module boundaries: agents may import the tool registry
but never the database; tools may import the database but never an agent.

### 4.1 AI usage boundary

| Deterministic code owns | The model owns |
| --- | --- |
| All arithmetic (margin, ROAS, forecast, profit) | Root-cause hypothesis ranking |
| All policy, permission, budget, risk decisions | Natural-language explanation of evidence |
| All state mutation | Customer conversation |
| Plan construction and task routing | Marketing copy |
| Forecasting (weighted moving average) | Summarising multi-agent findings |

If the model is unavailable, every number and every decision is unchanged; only the prose
becomes template-generated, and the UI says so.

---

## 5. Database schema

SQLite (`node:sqlite`), file at `data/commerce.db`, created and seeded deterministically.

`businesses`, `agents`, `agent_permissions`, `agent_budgets`, `agent_memory`,
`customers`, `products`, `product_terms`, `inventory`, `orders`, `order_items`,
`suppliers`, `supplier_quotes`, `purchase_orders`, `campaigns`, `campaign_metrics`,
`pricing_history`, `daily_metrics`, `events`, `tasks`, `plans`, `approvals`, `policies`,
`audit_logs`, `business_goals`, `agent_metrics`, `tickets`, `payments`.

Foreign keys on; indexes on every foreign key and on `events(created_at)`,
`audit_logs(created_at)`, `orders(created_at)`.

## 6. Seeded dataset (deterministic, seed = 20240115)

50 products · 500 customers · 2,000 orders across 30 days · 10 suppliers ·
8 campaigns · 30 days of daily metrics · 12 support tickets. Currency ₹, stored in paise
as integers; formatting is the only currency-aware layer.

## 7. Milestones

| Phase | Content | Gate |
| --- | --- | --- |
| 1 | Types, interfaces, project structure | `tsc --noEmit` |
| 2 | DB + seed, event bus, governance, tool registry, audit | unit tests |
| 3 | 7 agents + orchestrator + AI gateway | integration tests |
| 4 | API routes | route tests |
| 5 | UI: command center, agents, approvals, events, audit, intelligence, simulator, goals, memory, settings | `next build` |
| 6 | 8 scenarios + one-click hackathon story | e2e scenario tests |
| 7 | Polish: motion, empty/error states, a11y, responsive | manual pass |
| 8 | Full QA against the §89 checklist | all green |

## 8. Demo flow (5–7 min)

1. Dashboard: healthy business, seven idle agents, engine badge visible.
2. Trigger **Revenue Decline** in the simulator → event hits the bus.
3. Analytics Agent decomposes revenue into traffic × conversion × AOV, isolates the
   checkout conversion drop, and evidences it with mobile payment-failure counts.
4. Inventory and Pricing agents rule out their own domains — visible on the agent graph.
5. CEO Agent synthesises a root cause and a remediation plan.
6. Low-risk actions execute automatically; the ₹45,000 purchase order hits the approval
   queue with its full decision trace.
7. Human approves; the system executes and then verifies, and the dashboard moves.
8. Reset restores the exact seeded state.

## 9. Zero-cost infrastructure plan

| Concern | Choice | Cost |
| --- | --- | --- |
| Hosting | local `next dev` / `next start`; Vercel free tier optional | ₹0 |
| Database | `node:sqlite`, file on disk | ₹0 |
| Event bus | in-process, `globalThis` singleton | ₹0 |
| Vector search | deterministic local scoring | ₹0 |
| AI | deterministic engine; optional free-tier hosted key | ₹0 |
| Payments | simulator, `TXN_DEMO_*` identifiers | ₹0 |
| Monitoring | metrics table + local observability page | ₹0 |
