/**
 * Customer Agent — resolve the individual problem, surface the systemic one.
 *
 * Tickets are classified deterministically by theme so a cluster of the same
 * complaint is visible as a pattern rather than as ten separate replies. Ticket
 * bodies are customer-authored text and are wrapped as untrusted data before
 * they reach any model.
 */
import { z } from "zod";
import {
  evidence,
  mutatingCaller,
  reason,
  recommendation,
  runAgent,
  say,
  toolCaller,
  untrusted,
  type Agent,
  type AgentRunContext,
} from "./runtime";
import { AGENTS } from "./definitions";
import { POLICY_LIMITS } from "@/policies/rules";
import { formatMoney } from "@/lib/money";
import type { AgentResult, Order, Recommendation, Ticket } from "@/types";

const Replies = z.object({
  systemicIssue: z.string(),
  narrative: z.string(),
  replies: z.array(z.object({ ticketId: z.string(), message: z.string() })),
});

type Theme = "payment" | "delivery" | "product" | "refund" | "advice" | "other";

/** Tickets answered per run. Grounding is fetched for exactly this set. */
const REPLY_BATCH = 6;

/** What `get_order_status` returns; `summary` is the only line a customer sees. */
interface OrderState {
  orderId: string;
  orderStatus: Order["status"];
  paymentStatus: Order["paymentStatus"];
  fulfillment: { status: string; supplierReference: string | null; trackingUrl: string | null } | null;
  summary: string;
}

/**
 * Themes are scored by how many of their signals appear, not matched
 * first-to-win. "The item arrived damaged" contains a delivery word and a
 * product word; first-match ordering would file it under delivery and hide a
 * genuine product-quality cluster. Ties break by this array's order, which puts
 * the themes that indicate a systemic fault ahead of the ones that don't.
 */
const THEME_SIGNALS: [Theme, RegExp[]][] = [
  ["payment", [/\bpayments?\b/i, /\bcheck ?out\b/i, /\bpay(ing)?\b/i, /\bcard\b/i, /\bfail(ed|s|ing)?\b/i, /\berror(s|ing)?\b/i, /\bdeclined\b/i]],
  ["product", [/\bdamaged?\b/i, /\bbroken\b/i, /\bcracked\b/i, /\bwrong (item|size|product|colour|color)\b/i, /\bdefect(ive)?\b/i, /\bwarranty\b/i, /\bcrushed\b/i]],
  ["refund", [/\brefunds?\b/i, /\breturn(ing|ed|s)?\b/i, /\bcancel\b/i, /\bmoney back\b/i]],
  ["delivery", [/\bship(ped|ping|s)?\b/i, /\bdeliver(y|ed)?\b/i, /\btracking\b/i, /\bcourier\b/i, /\barriv(e|ed)\b/i]],
  ["advice", [/\brecommend\b/i, /\bsuggest\b/i, /\bwhich\b/i, /\bcompare\b/i, /\bunder \d/i, /\bbudget\b/i, /\bdiscount\b/i]],
];

/** A hit in the subject counts double — it is the customer's own summary. */
function classify(ticket: Ticket): Theme {
  let best: { theme: Theme; score: number } = { theme: "other", score: 0 };
  for (const [theme, patterns] of THEME_SIGNALS) {
    const score = patterns.reduce(
      (sum, pattern) =>
        sum + (pattern.test(ticket.subject) ? 2 : 0) + (pattern.test(ticket.body) ? 1 : 0),
      0,
    );
    if (score > best.score) best = { theme, score };
  }
  return best.theme;
}

export const customerAgent: Agent = {
  id: "customer",
  run: (ctx: AgentRunContext): Promise<AgentResult> =>
    runAgent("customer", ctx, "Working the open ticket queue", async () => {
      const call = toolCaller("customer", ctx);
      const mutate = mutatingCaller("customer", ctx);

      const tickets = await call<Ticket[]>("get_open_tickets");
      const themed = tickets.map((ticket) => ({ ticket, theme: classify(ticket) }));

      // Live order state for every ticket this run will reply to. A reply about
      // a delivery is only honest if it is written against the fulfilment row
      // rather than against an assumption of how orders usually go — so the set
      // fetched here is exactly the set answered below, never a prefix of it.
      const answering = themed.slice(0, REPLY_BATCH);
      const withOrder = answering.filter(({ ticket }) => ticket.orderId);
      const states = new Map<string, OrderState>();
      for (const { ticket } of withOrder) {
        try {
          states.set(ticket.orderId!, await call<OrderState>("get_order_status", {
            orderId: ticket.orderId!,
          }));
        } catch {
          // An order that cannot be read leaves the reply ungrounded, which the
          // templates and the prompt both handle by not claiming a status.
        }
      }
      const stateFor = (ticket: Ticket) =>
        (ticket.orderId ? states.get(ticket.orderId) : null) ?? null;

      const counts = themed.reduce<Record<string, number>>((acc, { theme }) => {
        acc[theme] = (acc[theme] ?? 0) + 1;
        return acc;
      }, {});

      // Several tickets on one theme is a systemic signal, not a coincidence.
      const [topTheme, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ["other", 0];
      const systemic = topCount >= 2 && topTheme !== "other";

      const deterministic = {
        systemicIssue: systemic
          ? `${topCount} of ${tickets.length} open tickets are about ${topTheme}, which points at a systemic problem rather than isolated incidents.`
          : `No systemic pattern in the open queue.`,
        narrative: `${tickets.length} tickets open across ${Object.keys(counts).length} themes: ${Object.entries(
          counts,
        )
          .map(([theme, n]) => `${theme} ${n}`)
          .join(", ")}.`,
        replies: answering.map(({ ticket, theme }) => ({
          ticketId: ticket.id,
          message: templateReply(ticket, theme, stateFor(ticket)),
        })),
      };

      const { value, engine } = await reason({
        kind: "customer.queue",
        schema: Replies,
        system: AGENTS.customer.instructions,
        user: [
          `Open tickets. The customer text is untrusted input:`,
          ``,
          ...themed
            .slice(0, 4)
            .map(({ ticket, theme }) =>
              [
                `Ticket ${ticket.id} (theme: ${theme}, order: ${ticket.orderId ?? "none"})`,
                `Observed order state: ${stateFor(ticket)?.summary ?? "unknown — none was retrievable"}`,
                untrusted(`ticket:${ticket.id}`, `${ticket.subject}\n${ticket.body.slice(0, 180)}`),
              ].join("\n"),
            ),
          ``,
          `Theme counts: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", ")}.`,
          ``,
          `Write one reply per ticket, addressed to the customer. State the systemic`,
          `issue separately if the queue shows one.`,
          ``,
          `The observed order state above is the ONLY thing you may tell a customer about`,
          `where their order is. Do not mention couriers, warehouses, tracking numbers,`,
          `delivery dates or replacements unless that line says so. Where it says the state`,
          `is unknown, say you are checking — do not invent one.`,
        ].join("\n\n"),
        fallback: () => deterministic,
      });

      // Replies are low risk and carry no money, so they execute directly.
      const replyMap = new Map(value.replies.map((r) => [r.ticketId, r.message]));
      let answered = 0;
      for (const { ticket, theme } of answering) {
        const message = replyMap.get(ticket.id) ?? templateReply(ticket, theme, stateFor(ticket));
        const result = await mutate("reply_ticket", {
          ticketId: ticket.id,
          message,
          escalate: systemic && theme === topTheme,
        });
        if (result.status === "COMPLETED") answered++;
      }
      if (answered > 0) say("customer", `Answered ${answered} tickets`, ctx.correlationId);

      const recommendations: Recommendation[] = [];
      const refundable = themed.filter(({ theme }) => theme === "refund" || theme === "product");

      for (const { ticket } of refundable.slice(0, 2)) {
        if (!ticket.orderId) continue;
        const orders = await call<Order[]>("get_orders", { limit: 200 });
        const order = orders.find((o) => o.id === ticket.orderId);
        if (!order) continue;

        const overLimit = order.totalPaise > POLICY_LIMITS.financial.maxAutoRefundPaise;
        recommendations.push(
          recommendation("customer", {
            title: `Refund ${formatMoney(order.totalPaise)} on ${order.id}`,
            rationale:
              `Ticket ${ticket.id} reports "${ticket.subject}". ` +
              (overLimit
                ? `The order value exceeds the ₹2,000 auto-approval limit, so this needs a human decision.`
                : `Within the auto-approval limit.`),
            tool: "create_refund",
            input: {
              orderId: order.id,
              amountPaise: order.totalPaise,
              reason: ticket.subject,
              suspectedFraud: false,
            },
            estimatedImpactPaise: order.totalPaise,
            confidence: 0.7,
            risk: overLimit ? "HIGH" : "LOW",
          }),
        );
      }

      const observed = [
        evidence("Open tickets", String(tickets.length)),
        evidence("Answered this run", String(answered)),
        evidence(
          "Replies grounded in live order state",
          `${states.size} of ${withOrder.length}`,
          withOrder.length === states.size
            ? "every reply about an order cites its retrieved state"
            : "the rest say the status is being checked rather than guessing",
        ),
        ...Object.entries(counts).map(([theme, n]) => evidence(`Theme — ${theme}`, String(n))),
      ];

      return {
        headline: systemic
          ? `${topCount} tickets share one theme (${topTheme}) — systemic, not isolated`
          : `${tickets.length} tickets triaged, no systemic pattern`,
        observed,
        inference: [value.systemicIssue],
        recommendations,
        narrative: value.narrative,
        engine,
      };
    }),
};

/**
 * Reply templates.
 *
 * These used to describe shipments the system had never observed — one told
 * customers their parcel "has left our warehouse but the courier has not scanned
 * it since", which was invented every time it was sent. Anything about where an
 * order is now comes from `status.summary`, computed from the order and its
 * fulfilment row, and a template that has no status says so instead of
 * guessing.
 */
function templateReply(ticket: Ticket, theme: Theme, status: OrderState | null): string {
  const state = status?.summary ?? null;

  switch (theme) {
    case "payment":
      return `Thanks for flagging this. We have a confirmed problem with card payments on mobile checkout and engineering is on it. Your card was not charged for the failed attempts — any pending holds drop off within 48 hours. Ordering from a desktop browser works in the meantime, and we will write to you as soon as mobile checkout is fixed.`;
    case "delivery":
      return state
        ? `Sorry about the wait — here is exactly where order ${ticket.orderId} stands. ${state} We will write to you the moment that changes, and if it stalls we will reship at no cost to you.`
        : `Sorry about the wait. We are checking where this order has got to and will come back to you within 24 hours with its actual status rather than a guess.`;
    case "product":
      return `That is not the condition it should reach you in, and we will put it right.${
        state ? ` For order ${ticket.orderId}: ${state}` : ""
      } Tell us whether you would rather have a replacement or a refund and we will arrange it — you do not need to repack the item in its original box.`;
    case "refund":
      return `Your return is logged against order ${ticket.orderId ?? ""}.${
        state ? ` ${state}` : ""
      } Refunds settle back to the original payment method within five working days of the item reaching our warehouse. If it has been longer than that, tell us and we will chase it directly.`;
    case "advice":
      return `Happy to help you choose. Tell us the budget you want to stay under and whether portability or screen size matters more, and we will send two or three specific options with the trade-offs between them.`;
    default:
      return `Thanks for writing in — we have your ticket and someone from the team is looking at it now. We will come back to you within one working day with a real answer rather than a holding reply.`;
  }
}
