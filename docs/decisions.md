# Architecture decisions

Each entry records what was chosen, what was rejected, and why. Several reverse the
original brief; those are marked.

---

## ADR-001 · Deterministic reasoning is the default, not the fallback

**Reverses the brief**, which mandated a local Ollama model as the default provider.

**Rejected because** it contradicted the brief's own one-command setup requirement (a
judge would first pull multiple GB of weights), it put sustained load on the developer's
machine, and 7B-class local models are unreliable at multi-step structured tool-calling —
flaky in exactly the moment a live demo cannot afford it.

**Chosen:** the deterministic engine is the primary path. A hosted free-tier model is an
optional enhancement behind one OpenAI-compatible adapter that covers Groq, Gemini and
OpenRouter.

**Consequence:** every agent must compute a complete deterministic answer before calling
a model. That is more work per agent, and it is the reason the system is honest — the
fallback is not a degraded mode, it is the reference answer.

---

## ADR-002 · Plans are deterministic DAGs, not model output

**Reverses the brief**, which had the orchestrator use a model to decompose goals and
select agents.

**Rejected because** it is simultaneously the least reliable thing to delegate to a model
and the most load-bearing thing in the demo. One malformed plan breaks everything
downstream.

**Chosen:** plan templates matched by event type, goal metric or free-text intent. The
model reasons *inside* tasks, where a bad answer degrades one finding instead of the run.

**Consequence:** new plan shapes need a template. Acceptable — there are seven, and
adding one is a data change.

---

## ADR-003 · Policy, risk and budget are one pipeline

**Rejected:** three subsystems, as the brief described them.

**Chosen:** one `evaluate()` producing one `GovernanceResult`.

**Why:** as separate systems it is possible for a call to satisfy one and silently skip
another. One pipeline means the executor has exactly one thing to obey, and the decision
is the most severe outcome of any check.

---

## ADR-004 · Schema validation runs before governance

**Why:** policy rules read typed fields (`newPricePaise`, `amountPaise`). They cannot be
evaluated against unparsed input.

**Consequence:** a malformed call is denied as `SCHEMA` and never reaches the permission
check. This surfaced as a false-negative in a security test that passed `{}` as input and
appeared to prove permissions worked when it proved nothing. The test now passes valid
inputs.

---

## ADR-005 · `node:sqlite` over `better-sqlite3`

**Rejected:** the conventional driver, which needs a native compile that can fail on a
fresh machine.

**Chosen:** Node 24's built-in `node:sqlite`. Zero native dependencies, nothing to
compile, same synchronous ergonomics.

**Consequence:** Node 24+ is required. Stated in the README.

---

## ADR-006 · Lexical retrieval, not embeddings

**Rejected:** pgvector, or a local embedding model.

**Why:** the catalogue is 50 products. IDF-weighted term overlap plus attribute scoring
is more accurate at that size and needs no service and no model. `VectorStore` remains
the seam.

**Consequence:** this would not hold at 50,000 products. The interface is where that
change goes.

---

## ADR-007 · Interfaces without unused implementations

`DatabaseAdapter`, `EventBus`, `VectorStore` and `AIProvider` are all seams. Exactly one
implementation ships for each (plus the hosted AI provider).

**Why:** the brief specified Redis and Supabase backends as optional alternates. Writing
backends nobody runs is how a repo rots — they drift, they break silently, and they
imply a capability that was never tested.

---

## ADR-008 · Price changes declare no financial impact

**Why:** a price change moves no cash. Feeding revenue-at-risk into the financial
thresholds pushed every routine repricing into the approval queue — caught by a test that
expected a 4% change to execute and found it parked.

**Chosen:** pricing is bounded by its own policies (25% margin floor, 10% step limit) and
its risk scales with the size of the change. The cash thresholds govern money actually
leaving the business.

---

## ADR-009 · Agents reject their own bad ideas

**Found in testing:** the Pricing Agent recommended cuts its own elasticity simulation
projected as profit-*negative*, and the CEO dutifully ranked them.

**Chosen:** a proposal whose simulation shows a profit loss is reported as *considered
and rejected*, with the figure, rather than proposed.

**Why:** a known-negative action in front of a human is how approval queues stop being
read. Showing the rejected option is also more informative than silence.

---

## ADR-010 · Terminal tasks depend on every agent they need

**Found in testing:** the CEO synthesised a root cause while depending only on the last
task in the chain, so it never saw the Analytics finding. Three plan templates had the
same shape.

**Chosen:** every terminal task depends on all the agents whose findings it uses.

**Why:** a synthesis step that cannot see the primary evidence is a bug, and the DAG is
where it is fixed.

---

## ADR-011 · Unmeasured things say so

**Rejected:** filling the funnel's discovery and cart stages with plausible derived
numbers.

**Chosen:** those stages render as *not instrumented*.

**Why:** the brief's own no-hidden-magic rule. It is also the more useful display — an
operator wants the measurement gap flagged, not papered over.

---

## ADR-012 · Visual product search is absent, not faked

The brief asked for image-based search and separately forbade claiming a model analysed
something it did not. Without a vision model there is no honest implementation, so the
feature is listed under *Not implemented* with the reason.

---

## ADR-013 · Singletons pinned to `globalThis`

The database handle, event bus and AI provider are cached on `globalThis`.

**Why:** Next.js recompiles modules on every edit in development. Without pinning, the
app opens a new database handle per compile and forks the event bus alongside it, so
published events reach a bus nobody is listening to.

---

## ADR-014 · Ephemeral lifecycle events are not persisted

Agent status changes, tool calls and task transitions stream over SSE without being
written to `events`.

**Why:** they are already in the audit log. Storing them twice bloats the table and adds
nothing an operator can use.

---

## ADR-015 · One `EventSource` per page

Components subscribe through a small shared registry rather than opening their own
connection.

**Why:** three live components on the dashboard would otherwise hold three server-side
streams for identical data.

---

## ADR-016 · The model plans; ADR-002 is reversed by operator decision

**Supersedes ADR-002**, which kept plan construction deterministic.

The operator asked for full LLM orchestration after seeing the deterministic
build, having been shown the reliability trade-off. That is their call, and it is
now the primary path: the model decomposes a trigger into a task DAG, choosing
which agents run and in what order.

**What was kept from ADR-002.** The concern that motivated it — a malformed plan
breaking everything downstream — is real and was observed in practice. So a model
plan is accepted only after passing seven checks: schema, known agent ids, unique
keys, resolvable dependencies, acyclic graph, size bounds, and a terminal `ceo`
synthesis step. A cycle would hang the DAG walker forever; it is rejected before
execution. Anything failing falls back to the template in `plans.ts`, and the plan
records `planned_by` so the UI never shows a fallback as model output.

**Measured behaviour** (llama-3.3-70b-versatile, Groq free tier, 3 runs of the
same question): 2 of 3 runs were model-planned, one fell back on a malformed JSON
response. All 3 completed in 4–8s with every agent reasoning on the model. Plans
differed between runs — 5, 6 and 7 agents — which is inherent to the choice.

---

## ADR-017 · Failure classes are not interchangeable

The gateway originally disabled the hosted provider for 60 seconds on **any**
failure. With agents running concurrently, one agent's malformed JSON blanked the
model for every agent after it — observed as 3 of 6 agents silently falling back.

Failures are now classified:

| Failure | Response |
| --- | --- |
| Schema mismatch | This call falls back. Provider stays enabled. |
| Rate limit (429) | Retry honouring `retry-after`, then a 3s cooldown. |
| Anything else | 60s cooldown — the endpoint is assumed unwell. |

A process-wide gate also caps concurrent model requests at two. A tokens-per-
minute quota is a shared resource: six simultaneous requests all read it as
available, all send, and most get a 429.

---

## ADR-018 · The schema hint is derived, never hand-written

The prompt's "required shape" was hand-rolled and rendered every array as
`["string", ...]`. For a schema whose array holds objects — the planner's — that
told the model nothing about the fields inside, so it invented its own names and
every plan failed validation. A benchmark that spelled the shape out passed,
which hid the bug.

It is now generated with `z.toJSONSchema()` from the same schema used to validate
the response, so the contract shown and the contract enforced cannot drift.

---

## ADR-019 · The queue is a table, not Redis

Anything that leaves the process can fail, and the event bus is fire-and-forget: a
subscriber that throws loses the work. A supplier call cannot be lost, so it goes through
a durable queue instead.

That queue is a `job_queue` table. Redis was the obvious answer and was rejected for the
same reason the event bus is in-process: this application is one Node process, so a
broker adds an install, a daemon and a second source of truth in exchange for nothing.
Jobs survive a restart because SQLite does, and `run_after` carries the backoff so a
failing job is simply invisible until its time comes.

**Consequence:** a second instance would double-run every job. There is no distributed
lock, only the status flip inside a transaction, which is sufficient for one writer and
not for two. The deployment docs pin the instance count, and that is not a preference.

---

## ADR-020 · The tool commits intent; the worker makes the call

`fulfill_order` writes a `fulfillments` row and enqueues a job. It does not contact the
supplier.

Calling the vendor inline would put an unbounded network wait inside the governance
executor — one slow supplier would stall an agent run, and a timeout would lose the
action entirely, because the tool had already been recorded as attempted. Splitting them
means the decision is durable before the network is involved, and the call can be retried
without re-deciding anything.

It also makes the dead letter queue meaningful rather than decorative: there is a row to
retry, and a place for it to end up when retrying stops making sense.

---

## ADR-021 · Printful drafts only, and confirmation is not implemented

The live supplier creates draft orders. Printful's documentation states that drafts are
never charged and never picked up for fulfilment, and confirming one is a separate API
call.

That call is deliberately absent from `integrations/printful.ts`. The guarantee that an
agent cannot cause a garment to be printed or a card to be charged is therefore a
property of the code — there is no path to it — rather than a promise about how the code
will be used. A test asserts the outgoing request never mentions confirmation, because a
comment saying so would not survive the next edit.

Printful has no sandbox environment. Drafts against a live account are the honest
equivalent, which is exactly why the guarantee needs to hold in code.

Two simplifications ride along, both stated in the README rather than hidden: every
seeded SKU maps to one configured catalog variant, because a generated catalogue has no
real Printful equivalent and a per-product mapping would be invented; and the recipient
is a fixed operator address. `SupplierOrderRequest` cannot carry customer data, so the
PII that `SEC-001` restricts cannot reach a vendor even by accident.

---

## ADR-022 · A shared password, and the honest name for it

A public deployment of a console whose buttons approve money needs something at the door.
`DEMO_PASSWORD` puts the whole site behind HTTP Basic in `proxy.ts`; unset, there is no
gate and local development is untouched.

HTTP Basic because the browser draws the prompt: no login page, no session store, no
password field to get wrong. The comparison is constant-time, because `===` leaks the
matching prefix through timing and that is how a shared password gets guessed one
character at a time. A cookie is set on success because `EventSource` cannot carry an
Authorization header, and the live event stream has to keep working once you are through
the door.

`/api/health` is exempt. A platform health check that receives a 401 reads the instance
as dead and rolls the deployment back.

**What it is not:** authentication. One password for everyone, no accounts, no roles, and
the cookie holds the password rather than a signed session token. It stops a passer-by
approving a ₹2,00,000 purchase order. It would not stop an attacker, and calling it auth
would be the kind of claim this project spends its time avoiding.

---

## ADR-023 · SQLite stayed, against a proposal to move to MongoDB

A five-phase plan to make the system "fully live" opened by replacing all persistence
with Mongoose. It was declined, and the reasoning is worth recording because the request
was reasonable.

The premise was that the system relied on mocked data. It did not: `database/queries.ts`
is a thousand lines of real SQL over 29 real tables, the hosted model was already live,
and the observability pages already existed. What was actually simulated — suppliers,
payments, ad platforms — is not fixed by changing databases.

Porting 29 tables and 55 query functions would have traded a zero-dependency local file
for a cloud database, an account, network latency on every page, and the loss of the two
properties a judged demo depends on: it runs with the wifi unplugged, and it resets in
53 milliseconds. A judge cannot see which database is underneath.

`DatabaseAdapter` remains the seam if a multi-instance deployment ever needs Postgres.
The work went into the supplier integration instead, which is the part that was actually
fake.
