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
