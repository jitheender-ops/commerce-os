# Multi-Agent Commerce OS

An operating layer for an online business, where seven specialised AI agents observe
events, investigate with typed tools, collaborate on findings, and execute actions
under a governance pipeline that decides — deterministically — what they may do alone
and what needs a human.

It is not a chatbot over a dashboard. Agents cannot touch the database; they can only
call declared tools, and every tool call passes permission, policy, risk and budget
checks before anything changes.

```bash
git clone <repo> && cd commerce-os
npm install
npm run dev
```

Open <http://localhost:3000>. No API key, no database setup, no cloud account, no local
model. The demo business seeds itself on first request.

---

## What it does

Watch the loop run end to end:

| | |
| --- | --- |
| **Observe** | A business event lands on the bus — a stockout, a revenue anomaly, a competitor price move. |
| **Understand** | The Analytics Agent decomposes revenue into traffic × conversion × AOV and isolates the driver. |
| **Plan** | The orchestrator matches the event to a task DAG and assigns each task to an agent. |
| **Delegate** | Inventory sizes a reorder and hands it to Procurement, which compares suppliers. |
| **Execute** | Tools run behind governance. Low-risk actions execute; anything above the limits parks. |
| **Verify** | Results are checked for evidence, and the business position is re-measured. |
| **Learn** | Conclusions are written to agent memory and retrieved by relevance on later runs. |

### Try this first

Type into the command bar on the dashboard:

> **Why did sales drop yesterday?**

Five agents run. The Analytics Agent finds a −29% conversion movement, traces it to a
mobile payment failure rate of 4.5% against 1.6% elsewhere, and rules out order value
as a cause. Inventory and Pricing clear their own domains. The Customer Agent finds
four tickets sharing one theme and calls it systemic. The CEO Agent ranks everything
and names the top priority.

None of that is scripted. It is computed from 2,109 seeded orders.

---

## Architecture

```
                          ┌─────────────────────────────┐
                          │        Command Center       │
                          │   Next.js App Router + SSE  │
                          └──────────────┬──────────────┘
                                         │
   INTELLIGENCE           ┌──────────────▼──────────────┐
                          │        Orchestrator         │
                          │  deterministic plan DAG     │
                          │  + task state machine       │
                          └──────────────┬──────────────┘
        ┌───────────┬───────────┬────────┼────────┬───────────┬───────────┐
        ▼           ▼           ▼        ▼        ▼           ▼           ▼
      CEO      Analytics   Inventory  Pricing  Marketing  Customer   Procurement
        └───────────┴───────────┴────────┼────────┴───────────┴───────────┘
                                         │ typed tool calls only
   GOVERNANCE             ┌──────────────▼──────────────┐
                          │     Governance Pipeline     │
                          │  schema → permission →      │
                          │  policy → risk → budget     │
                          └──────────────┬──────────────┘
                                         │ ALLOW / REQUIRE_APPROVAL / DENY
   EXECUTION              ┌──────────────▼──────────────┐
                          │        Tool Registry        │
                          └──────────────┬──────────────┘
              ┌──────────────┬───────────┴────┬──────────────┐
              ▼              ▼                ▼              ▼
         SQLite DB      Event Bus        Audit Log      Agent Memory
```

The three layers are enforced by module boundaries: agents import the tool registry and
never the database; tools import the database and never an agent.

Full detail in [docs/architecture.md](docs/architecture.md).

---

## The agents

| Agent | Owns | Autonomy | Spend authority |
| --- | --- | --- | --- |
| **CEO** | Synthesis, conflict resolution, priority | 3 | — |
| **Analytics** | Root-cause analysis, anomaly detection | 3 | — |
| **Inventory** | Stock cover, velocity, reorder sizing | 3 | — |
| **Pricing** | Margin defence, competitive position | 3 | — |
| **Marketing** | ROAS, budget reallocation | 2 | ₹10,000/day |
| **Customer** | Tickets, refunds, systemic signals | 3 | ₹20,000/day |
| **Procurement** | Supplier selection, purchase orders | 2 | ₹50,000/day |

Each has its own objective, system instructions, tool surface and permission set.
Permissions are the source of truth — the governance pipeline reads them on every call,
so an agent cannot reach a capability it was not granted even if a model asks for it by
name. See [docs/agents.md](docs/agents.md).

---

## Governance

Five checks, one result, no model involvement:

```
schema → permission → policy → risk → budget
```

| Policy | Limit |
| --- | --- |
| `FIN-001` Refund auto-approval | ₹2,000 — above this, a human decides |
| `FIN-002` Purchase order auto-approval | ₹50,000 |
| `FIN-003` Hard ceiling | ₹5,00,000 — denied outright, not approvable |
| `PRC-001` Minimum gross margin | 25% |
| `PRC-002` Maximum price step | 10% per change |
| `MKT-001` Daily budget movement | ₹10,000 |
| `INV-001` Reorder point change | ±200 units |
| `BUD-001` Per-agent daily spend | Agent's own budget |

Merged into one pipeline deliberately: when policy, risk and budget are separate
subsystems, a call can satisfy one and silently skip another.

The full rule set and its rationale: [docs/policies.md](docs/policies.md).

---

## Honesty rules

The system never claims a model did something it did not.

- **The engine badge in the header** names the active reasoning engine at all times.
  Without a key it reads **Demo mode — Deterministic Business Engine**.
- **Every agent result** carries the engine that produced its reasoning.
- **Every number** — margin, ROAS, forecast, profit, policy decision — is computed by
  deterministic code. A model never produces a figure, in either mode.
- **Projections are labelled `ESTIMATED`** and name their model (constant-elasticity,
  weighted moving average).
- **Payments, suppliers and ad platforms are simulated.** Transaction IDs are
  `TXN_DEMO_*`. No external service is contacted and no money moves.
- **Unmeasured funnel stages say "not instrumented"** rather than showing a plausible
  invention.

---

## Local AI, and why there is none

The original design called for a local model as the default provider. That was dropped:
it contradicts the one-command setup, it puts a multi-GB model on the developer's
machine, and small local models are unreliable at multi-step structured tool-calling —
flaky in exactly the moment a live demo cannot afford it.

Instead:

```
AIGateway
├── DeterministicProvider   default — no network, no key, no local compute
└── HostedProvider          optional — OpenAI-compatible HTTP, free tiers
```

`HostedProvider` speaks the OpenAI-compatible chat shape, so Groq, Google Gemini and
OpenRouter free tiers all work through one adapter. Set `AI_BASE_URL`, `AI_API_KEY` and
`AI_MODEL` to enable it. On any error, timeout or schema mismatch it falls back to the
deterministic engine and the UI says so.

**What changes with a model connected:** prose quality, hypothesis ranking, customer
replies. **What does not change:** every figure, every policy decision, every plan.

---

## Running it

### Install

```bash
npm install     # ~360 packages, no native compilation
npm run dev     # http://localhost:3000
```

Requires **Node 24+** — the database uses the built-in `node:sqlite`, so there is no
native module to compile and no database server to run.

### Commands

| | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | 54 tests — governance, security, agents, scenarios |
| `npm run typecheck` | Strict TypeScript, no `any` in domain code |
| `npm run seed` | Seed if empty |
| `npm run reset-demo` | Wipe and reseed to the exact starting state |

### Environment

Everything is optional — see [.env.example](.env.example). With no `.env` file the
system runs fully offline.

---

## Deploying

Commerce OS runs as **one persistent Node process**. The SQLite file, the in-process
event bus and the open SSE stream all live in the same instance — so any host that keeps
a process alive works unmodified, and serverless does not (an event published in one
instance never reaches an SSE stream held by another).

### Locally

```bash
npm run build
npm start           # http://localhost:3000
```

This is what [docs/demo.md](docs/demo.md) is written for, and it needs no network.

### Container — Render, Fly.io, Railway, any VM

```bash
docker build -t commerce-os .
docker run -p 3000:3000 commerce-os
```

Node 24 is a hard requirement, not a preference: the database uses the built-in
`node:sqlite`, which does not exist in Node 20 or 22. `engines` in `package.json`
declares it so a host doesn't silently pick an older runtime and crash on boot.

**No volume is required.** The seed is deterministic, so a fresh container comes up with
the byte-identical dataset. Mount one at `/app/data` only if approvals and audit rows
should survive a restart — otherwise a restart behaves exactly like pressing
**Reset demo**.

### Vercel and other serverless platforms

Not supported as-is, and the gap is architectural rather than configuration:

1. **SQLite would have to become hosted Postgres.** `DatabaseAdapter` in
   `database/db.ts` is the seam — deliberately narrow — but every query in
   `database/queries.ts` and all 28 tables need porting.
2. **The in-process event bus does not survive multiple instances.** SSE would need
   replacing with a durable queue or polling.

Both are real work, and both cost the zero-external-service property that makes this
project reproducible for free. Use a container host instead.

---

## The demo

**One click:** Simulator → **Start hackathon demo**. Six narrated steps, 5–7 minutes:
baseline → three injected faults → investigation → supply response → governance →
verification.

**Eight scenarios**, each a real deterministic data change that publishes an event:
stockout · revenue drop · competitor price drop · campaign failure · supplier delay ·
payment failure · demand spike · return surge.

**Reset demo** in the header restores the exact seeded state — the dataset comes from
one seed (`20240115`), so every machine and every reset produces identical figures.

Presenter script: [docs/demo.md](docs/demo.md).

---

## Data

Deterministically generated: 50 products · 500 customers · 2,109 orders over 30 days ·
10 suppliers · 8 campaigns · 12 support tickets · 30 days of daily metrics.

Daily metrics are *derived from the generated orders* rather than invented separately,
which is what lets the revenue decomposition reconcile arithmetically. The most recent
day carries a deliberate, discoverable fault — a mobile checkout regression. No agent
knows about it; they find it by querying the data.

---

## Zero cost

| Concern | Choice | Cost |
| --- | --- | --- |
| Hosting | Local, or any Node host | ₹0 |
| Database | `node:sqlite`, file on disk | ₹0 |
| Event bus | In-process, `globalThis` singleton | ₹0 |
| Vector search | Deterministic local scoring | ₹0 |
| AI | Deterministic engine; optional free-tier key | ₹0 |
| Payments | Simulator | ₹0 |
| Monitoring | Metrics table + observability page | ₹0 |

No Docker, no Redis, no Postgres, no Kafka, no cloud account, no model weights. One
Node process and a ~2 MB SQLite file.

---

## Not implemented

Stated plainly, because a fake would violate the honesty rules above:

- **Visual product search.** Requires a vision model; there is no honest implementation
  without one, so it is absent rather than faked.
- **Supabase / Postgres adapter.** `DatabaseAdapter` is the seam; only SQLite ships.
- **Redis event bus.** `EventBus` is the seam; only the in-process bus ships.
- **MCP / A2A / agent payment protocols.** `AgentTransport` and `CommerceAdapter` are
  designed as adapter seams. Nothing claims to speak these protocols today.
- **Real payment, supplier or ad-platform integration.** All simulated and labelled.

---

## Documentation

| | |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Layers, data flow, module boundaries |
| [docs/agents.md](docs/agents.md) | Each agent's role, tools, permissions, reasoning |
| [docs/security.md](docs/security.md) | Threat model, prompt injection, permissions |
| [docs/policies.md](docs/policies.md) | Every rule and why it exists |
| [docs/demo.md](docs/demo.md) | Presenter script |
| [docs/decisions.md](docs/decisions.md) | Architecture decisions and what was rejected |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Original plan and spec critique |

---

## Licence

MIT.
