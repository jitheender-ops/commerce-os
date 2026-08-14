# Policies

Every rule here is deterministic code in `policies/`. A model is never asked whether a
policy is satisfied.

## The pipeline

```
schema → permission → policy → risk → budget → autonomy
```

One call produces one `GovernanceResult`. The final decision is the **most severe**
outcome of any check:

```
ALLOW  <  REQUIRE_APPROVAL  <  DENY
```

Policy, risk and budget are merged into one pipeline on purpose. As separate subsystems
it becomes possible for a call to satisfy one and silently skip another.

## Rules

| ID | Category | Rule | Limit | On breach |
| --- | --- | --- | --- | --- |
| `FIN-001` | financial | Refund auto-approval ceiling | ₹2,000 | Approval |
| `FIN-002` | financial | Purchase order auto-approval ceiling | ₹50,000 | Approval |
| `FIN-003` | financial | Hard ceiling on any single action | ₹5,00,000 | **Deny** |
| `PRC-001` | pricing | Minimum gross margin | 25% | **Deny** |
| `PRC-002` | pricing | Maximum single price change | 10% | **Deny** |
| `MKT-001` | marketing | Daily campaign budget movement | ₹10,000 | **Deny** |
| `INV-001` | inventory | Reorder point adjustment bound | ±200 units | **Deny** |
| `SEC-001` | security | Customer PII requires an explicit grant | — | **Deny** |
| `FUL-001` | financial | Supplier submission retry limit | 3 attempts | Dead letter |
| `FUL-002` | financial | Fulfilment auto-approval ceiling | ₹50,000 at supplier cost | Approval |
| `BUD-001` | financial | Per-agent daily spend authority | Per agent | Approval |

### Why some breaches deny and others ask

A limit that a human could sensibly override on a given day (this refund, this order) is
an **approval**. A limit that represents a rule of the business itself — never sell below
25% margin, never move price more than 10% at once — is a **denial**, because approving
it would mean the rule does not exist.

`FIN-003` denies rather than asks because an action moving more than ₹5,00,000 in this
system is a bug or an attack, not a business decision.

### Fulfilment

`FUL-002` uses the **supplier cost** of the order, not the price the customer paid: the
cost is what the business owes a vendor, and the price is money it has already received.
It matches `FIN-002`'s ceiling because both send money to a supplier, but carries its own
id so a human reading the queue can tell which kind of commitment they are approving.

`FUL-001` is not a governance decision but a queue one, and it is listed here because it
is the rule that decides when a person gets involved: after three failed attempts the job
is dead-lettered and the fulfilment is parked in `EXCEPTION`, holding the vendor's own
error. A retry that has failed three times against the same vendor is not going to
succeed on the fourth, and continuing to try hides the problem instead of surfacing it.

An order with no supplier quote is denied outright rather than approved at ₹0 — see the
note under `FIN-002` in `policies/governance.ts`. An action whose cost cannot be computed
must not clear a money check by reporting zero.

### Suspected fraud

`create_refund` accepts `suspectedFraud`. When true the refund requires a human
regardless of amount, including amounts under `FIN-001`.

## Risk

Risk is declared per tool, either statically or computed from the input, then escalated
by the money involved — a tool cannot under-declare its way past the thresholds.

| Money moved | Minimum risk |
| --- | --- |
| ≤ ₹2,000 | LOW |
| > ₹2,000 | MEDIUM |
| > ₹50,000 | HIGH |
| > ₹5,00,000 | CRITICAL (denied) |

`HIGH` and `CRITICAL` require approval on their own, independent of any policy rule.

### Price changes declare no financial impact — deliberately

A price change moves no cash. Feeding revenue-at-risk into the financial thresholds
would push every routine repricing into the approval queue, and a queue full of routine
items is a queue nobody reads. Pricing is bounded by its own rules instead — the 25%
margin floor and the 10% step limit — and its risk scales with the size of the change
(≤5% is LOW, above that MEDIUM).

## Budgets

| Agent | Daily authority |
| --- | --- |
| Marketing | ₹10,000 |
| Customer | ₹20,000 |
| Procurement | ₹50,000 |
| CEO, Analytics, Inventory, Pricing | None — they move no cash |

Spend accumulates per agent. An action exceeding the remaining authority requires
approval rather than being denied — the money may well be worth spending, but not
without a human.

## Autonomy

| Level | Meaning |
| --- | --- |
| 0 | Manual — agent does not act |
| 1 | Recommend only |
| 2 | Execute with approval |
| 3 | Bounded autonomous execution *(default for most agents)* |
| 4 | Fully autonomous |

Marketing and Procurement run at **2** — both spend real money in a real deployment.
Everything else runs at **3**, where the bounds are the policies above.

Autonomy can only tighten an outcome. A level-3 agent still cannot exceed a policy, and
a level-2 agent needs approval even for an action policy would have allowed.

## Approvals

An approval carries everything needed to replay the call and everything needed to judge
it: agent, action, entity, reason, financial impact, risk, the policy that triggered it,
and the expected outcome.

Approving **replays the call through the full pipeline**. The approval satisfies the
approval requirement only — permission and policy re-evaluate, so an approval that has
gone stale (price moved, stock changed) still cannot execute something the rules now
forbid.

Rejecting executes nothing and records the reason against the agent.

## Adding a tool

A new mutating tool without a case in `policyChecks` still gets the hard ceiling, risk
escalation and budget enforcement — the `default` branch applies them. It will not get
domain-specific rules until someone writes them, which is why the switch has an explicit
`default` rather than falling through silently.
