# Demo script

5–7 minutes. Everything below runs on real seeded data — no step is staged for the
screen.

**Before you start:** `npm run dev`, open <http://localhost:3000>, click **Reset demo**
in the header. The seed is fixed, so your numbers will match this script.

---

## 0 · The frame (20s)

> "This isn't an assistant on top of a dashboard. Seven agents run the business. They
> can't touch the database — they can only call typed tools, and every tool call goes
> through a governance pipeline that decides what they may do alone and what needs me."

Point at the header badge: **Demo mode — Deterministic Business Engine**.

> "No API key, no local model, nothing running on my machine but Node. That badge always
> names the engine that produced the reasoning. It never claims a model did something it
> didn't."

---

## 1 · Baseline (30s)

The Command Center. Eight metrics, seven agents idle, the funnel twin, the agent graph.

> "A generated storefront: 50 products, 500 customers, 2,109 orders over 30 days. The
> daily metrics are derived from those orders, not invented separately — which is why
> the decomposition you're about to see actually reconciles."

Point at the **Digital business twin**. Two stages read *not instrumented*.

> "This simulation doesn't measure product discovery or cart. It says so instead of
> showing a plausible number. That rule holds everywhere in this system."

---

## 2 · The question (90s) — the core of the demo

Type into the command bar:

> **Why did sales drop yesterday?**

Watch the activity feed while it runs. Five agents, in dependency order.

When it lands, read the Analytics result aloud:

- Revenue **−29%** against the 7-day average
- Conversion contributes **~85%** of the movement; traffic **~3%**
- Mobile payments failing at **4.5%** against **1.6%** elsewhere
- *Ruled out:* order value moved only −2.7% and cannot account for it

> "It decomposed revenue into traffic times conversion times order value, found the
> driver, then went looking for what explains it — and it ruled things out. Inventory and
> Pricing cleared their own domains in parallel. The Customer Agent found four tickets
> sharing one theme and called it systemic rather than answering them one at a time.
> Then the CEO Agent ranked everything."

Point at **Observed / Inference** on any card.

> "Observed is measured by code. Inference is concluded from it. They're separated on
> every result, so you always know which is which."

---

## 3 · Governance (90s) — the part that matters

Simulator → **Simulate stockout**.

> "That just cut a real SKU's stock in the database and published an event. Inventory
> recomputes cover against supplier lead time, Procurement compares three quotes per
> product."

Read a Procurement line:

> "It picked the *more expensive* supplier and said why: the stockout lands in 4.8 days,
> the cheap supplier needs 15. Lead time outranks unit cost when you're about to run out."

Go to **Approvals**.

> "Purchase orders over ₹50,000 don't execute. Policy FIN-002. Each card carries the
> agent, the reason, the money, the risk, the policy that triggered it, and the expected
> outcome."

**Approve** one. **Reject** another with a note.

> "Approving replays the call through the whole pipeline again — the approval only
> satisfies the approval requirement. Permission and policy re-evaluate, so a stale
> approval can't push through something the rules now forbid. Rejecting executes nothing."

Open **Audit Log**.

> "Every call is here — allowed, denied, failed, parked — with a correlation id back to
> the trigger. Including the denials. An audit log that only shows what worked isn't one."

---

## 4 · The limits are real (45s)

Settings → Policies. Then:

> "Pricing proposes changes sized to *stay inside* policy — it won't ask for something
> that gets rejected. And it rejects its own ideas: if the elasticity model says a price
> cut destroys gross profit, it reports it as considered-and-rejected instead of putting
> a known-negative action in front of me."

Optional, if asked how it's enforced:

> "`npm test` — 54 tests. Eight agents each try a tool they don't have permission for.
> All denied, by code, before any policy even runs."

---

## 5 · One click, whole story (60s)

Simulator → **Start hackathon demo**.

Six narrated steps: baseline → three faults injected → investigation → supply response →
governance → verification.

Land on the **Governance** step:

> "Seven actions attempted. Two executed on their own — both inside policy and inside
> the agent's autonomy. Five went to a human. Zero blocked."

Then **Verification**:

> "And it re-measures honestly. Conversion is still down, because nobody has fixed the
> checkout yet — the agents diagnosed it and escalated it. It doesn't claim a recovery it
> didn't produce."

---

## 6 · Close (20s)

> "Reset demo puts it back to the exact same numbers — one seed, reproducible on any
> machine. Total running cost is zero: one Node process and a 2MB SQLite file. No Docker,
> no Redis, no Postgres, no model weights, no cloud account.
>
> Connect a free hosted key and the prose gets better. Every figure, every policy
> decision and every plan stays exactly the same — because none of them ever came from a
> model."

---

## If something goes wrong

| | |
| --- | --- |
| Agents return nothing | Click **Reset demo**, or `npm run reset-demo` |
| Port 3000 taken | Next picks the next free port — check the terminal |
| Activity feed empty | It only shows live events; trigger a scenario |
| An agent errors | It's designed for it — the task retries once, then the plan reports the failure and continues |

## Questions you should expect

**"Is the AI real?"** — In demo mode there is no LLM, and the badge says so. Reasoning
comes from explicit rules over computed evidence. Connect a key and a hosted model does
the ranking and prose. Numbers and decisions are deterministic in both modes, by design.

**"What stops an agent doing something stupid?"** — Five checks in code, plus per-agent
budgets and autonomy levels. Nothing is enforced by prompt.

**"What if someone prompt-injects a ticket?"** — External text is wrapped as untrusted
data, but that's defence in depth. The real answer: a fully persuaded model still can
only request a declared tool, and that request gets checked by code that never sees the
prompt.

**"What's fake?"** — Payments, suppliers and ad platforms are simulated and labelled.
Visual search isn't implemented, deliberately — there's no honest version without a
vision model. It's listed in the README under *Not implemented*.
