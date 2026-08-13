# Agents

Seven agents, each with its own objective, instructions, tools, permissions, autonomy
level and spend authority. None of them share a prompt or a code path beyond the shared
runtime that handles status, tool calling and memory retrieval.

Every agent returns the same shape, and the separation in it is the point:

```ts
{
  observed:        Evidence[]      // measured by deterministic code
  inference:       string[]        // concluded from that evidence
  recommendations: Recommendation[] // proposed actions, each with a tool and inputs
  narrative:       string          // written explanation
  engine:          EngineLabel     // which engine produced inference + narrative
}
```

---

## CEO Agent — strategy and coordination

**Objective:** translate goals into work, decide what matters most, reconcile conflicts.

Holds no write permission over business data. It reads what the specialists found and
decides what the business should do about it.

**Ranking** is `impact × confidence × riskPenalty`, so a marginal high-risk action does
not outrank a solid low-risk one.

**Conflict resolution** uses a fixed precedence applied in code:

```
safety > policy > financial constraints > business objective > agent preference
```

Two conflicts are detected today:

- *Margin pressure* — Pricing wants to cut price while Marketing wants to raise spend.
  Resolution: price changes proceed, the budget increase waits. Doing both compresses
  margin from two directions with no way to attribute the result.
- *Promoting constrained stock* — Marketing wants to promote SKUs that Inventory says
  will stock out. Resolution: purchase orders first, budget after stock is inbound.

A model is never asked to arbitrate; it explains the arbitration.

---

## Analytics Agent — measurement and root cause

**Tools:** `get_business_summary`, `get_daily_metrics`, `get_revenue_decomposition`,
`get_channel_breakdown`, `detect_anomalies`

Revenue is always decomposed as **sessions × conversion × AOV**. The driver with the
largest absolute movement is the primary suspect; supporting series (payment failures,
returns) then establish which explanation fits.

Anomaly detection is a z-score against the trailing mean, direction-aware — a fall in
revenue and a spike in failures are both anomalies, in opposite directions.

The deterministic conclusion path is complete on its own: given a conversion-led drop
plus one channel failing payments at more than 2.5× the others, it names the checkout
regression, states its confidence, lists what the evidence rules out, and says what to
check next. A model refines the phrasing and the ranking, not the finding.

---

## Inventory Agent — stock cover

**Tools:** `get_inventory`, `get_sales_velocity`, `forecast_demand`, `adjust_reorder_point`

Risk is **days of cover − supplier lead time**. Negative slack means the stockout lands
before a replacement could arrive — the only definition of "urgent" that survives
contact with a real supply chain.

Forecasting is a weighted moving average over 14 days with linear recency weights, and
confidence derives from the coefficient of variation. Both are stated in the output, so
the number can be checked by hand.

Reorder quantity covers `lead time + 7 days` of forecast demand, minus stock on hand.
The agent holds no purchasing permission — it hands the need to Procurement.

---

## Pricing Agent — margin and competitive position

**Tools:** `get_products`, `get_competitor_prices`, `calculate_margin`,
`simulate_price_change`, `update_price`

Candidates come from the gap to the tracked competitor price. Proposals are **sized to
stay inside policy** rather than clipped afterwards — an agent that proposes illegal
actions and gets rejected is noise in the approval queue.

It also rejects its own ideas: if the elasticity simulation says a move destroys gross
profit, the option is reported as *considered and rejected* rather than proposed. A
known-negative action in front of a human is how approval queues stop being read.

Simulations are labelled `ESTIMATED` and name their model.

---

## Marketing Agent — spend efficiency

**Tools:** `get_campaign_metrics`, `get_campaign_efficiency`, `propose_budget_change`,
`pause_campaign`, `draft_campaign_copy`

Campaigns are ranked by ROAS and given a verdict (`HIGH_PERFORMER` / `HEALTHY` /
`UNDERPERFORMING` / `WASTING`). Below-break-even campaigns are paused; the freed budget
moves to the best performer, **capped at the ₹10,000 daily policy limit** even when more
was freed.

Autonomy level 2 — every execution needs a human. Ad spend is the one place where a
wrong autonomous decision spends real money in a real deployment.

Copy is generated from the product's actual attributes (price, competitor gap, rating,
stock) so it cannot invent a specification.

---

## Customer Agent — experience and recovery

**Tools:** `get_orders`, `get_open_tickets`, `get_product_recommendations`,
`reply_ticket`, `create_refund`

Tickets are classified by theme deterministically, so a cluster of the same complaint is
visible as a *pattern* rather than as ten separate replies. Two or more on one theme is
reported as systemic and escalated.

Refunds up to ₹2,000 are within authority; above that, or on suspected fraud, a human
decides. Ticket bodies are customer-authored and wrapped as untrusted data before they
reach any model.

Replies are low-risk and carry no money, so they execute directly.

---

## Procurement Agent — supply and suppliers

**Tools:** `get_inventory`, `get_supplier_quotes`, `create_purchase_order`

The selection rule is explicit and stated in the output:

- **Stockout imminent** (negative slack) → lead time wins, and the agent says so when it
  picks the more expensive supplier.
- **Otherwise** → lowest landed cost wins, with reliability breaking near-ties.

Quantities are raised to meet a supplier's minimum order quantity, and the increase is
disclosed. Orders above ₹50,000 are routed to a human by governance — the agent is
instructed never to split an order to stay under the limit.

Needs come from the Inventory Agent when it ran earlier in the plan; otherwise the agent
derives them itself, so it is useful when run alone.

---

## The orchestrator

Plans are **deterministic task DAGs** matched from an event type, a goal metric, or a
free-text intent. Goal decomposition is the most load-bearing step in a live demo, and a
model that produces a malformed plan breaks everything downstream.

Seven templates ship: `revenue_investigation`, `stockout_response`, `campaign_review`,
`competitor_response`, `service_recovery`, `supply_disruption`, `full_business_review`.

Tasks run in waves — everything whose dependencies are satisfied runs together — and
each moves through:

```
PENDING → PLANNING → RUNNING → VERIFYING → COMPLETED
                  ↘ FAILED (1 retry) / BLOCKED / CANCELLED
```

Results feed forward to dependants. Every terminal task in a plan depends on *all* the
agents whose findings it needs, not just the last one to run — a CEO synthesising a root
cause without the analytics finding is a bug, and was one during development.

---

## Memory

Five layers, all in one store, separated by `kind`:

| Kind | Holds |
| --- | --- |
| `working` | Current task context |
| `episodic` | What happened before — "Display Awareness returned under 1.0 ROAS for six weeks" |
| `semantic` | Durable facts — "premium customers choose express shipping" |
| `operational` | Current business state |
| `policy` | Business rules — "profit growth is preferred over revenue growth" |

Retrieval is relevance-ranked by term overlap plus an importance prior. Only what
matches the current question enters a prompt; the whole store is never pasted into
context.
