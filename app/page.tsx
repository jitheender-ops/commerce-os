/**
 * Command Center.
 *
 * Reads the database directly — this is a server component, so there is no
 * round trip through the API layer just to render the first paint.
 */
import Link from "next/link";
import { AGENTS, AGENT_IDS } from "@/agents/definitions";
import {
  getAgentRow,
  getBusinessSummary,
  getCampaignEfficiency,
  getRevenueDecomposition,
  getStockoutRisks,
  listApprovals,
} from "@/database/queries";
import { str } from "@/database/db";
import { formatDelta, formatMoney, formatMoneyCompact } from "@/lib/money";
import { ActivityFeed, AgentGraph } from "@/components/live";
import { AskBar } from "@/components/ask";
import { Badge, Empty, Meter, Panel, RiskBadge, Stat } from "@/components/ui";
import { RevenueChart } from "@/components/charts";
import { BusinessTwin } from "@/components/twin";
import { CommandHero } from "@/components/hero";

export default function DashboardPage() {
  const summary = getBusinessSummary();
  const decomposition = getRevenueDecomposition();
  const risks = getStockoutRisks().filter((r) => r.risk === "HIGH" || r.risk === "CRITICAL");
  const campaigns = getCampaignEfficiency();
  const pending = listApprovals("PENDING");
  const wasting = campaigns.filter((c) => c.verdict === "WASTING");

  return (
    <div className="space-y-5">
      {/*
        The hero. The grid warps toward the pointer and ripples where it is
        clicked, which is the one place in this console where the interface
        invites play — everywhere below it, motion would compete with data.
      */}
      <CommandHero
        latestDay={decomposition.latestDay}
        revenue={formatMoneyCompact(summary.revenuePaise)}
        revenueDelta={summary.deltas.revenue}
        pending={pending.length}
        agents={AGENT_IDS.length}
      />

      <AskBar />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Revenue" value={formatMoneyCompact(summary.revenuePaise)} delta={summary.deltas.revenue} />
        <Stat label="Profit" value={formatMoneyCompact(summary.profitPaise)} delta={summary.deltas.profit} />
        <Stat label="Orders" value={String(summary.orders)} delta={summary.deltas.orders} />
        <Stat label="Conversion" value={`${summary.conversionRate}%`} delta={summary.deltas.conversion} />
        <Stat label="AOV" value={formatMoneyCompact(summary.aovPaise)} delta={summary.deltas.aov} />
        <Stat label="Gross margin" value={`${summary.marginPercent}%`} />
        <Stat
          label="Inventory risk"
          value={String(summary.inventoryRisks)}
          hint="SKUs stocking out before resupply"
        />
        <Stat label="Blended ROAS" value={`${summary.roas}×`} hint="revenue ÷ ad spend" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel
            source="measured"
            title="Revenue decomposition"
            subtitle="revenue = sessions × conversion × average order value"
          >
            <p className="mb-4 text-[12px]" style={{ color: "var(--ink-2)" }}>
              Revenue moved{" "}
              <strong className="num" style={{ color: decomposition.revenueChangePct < 0 ? "var(--bad)" : "var(--good)" }}>
                {formatDelta(decomposition.revenueChangePct)}
              </strong>{" "}
              against the seven-day average. Largest contributor:{" "}
              <strong>{decomposition.primaryDriver}</strong>.
            </p>
            <ul className="space-y-3">
              {decomposition.drivers.map((driver) => (
                <li key={driver.name}>
                  <div className="mb-1 flex items-baseline justify-between text-[12px]">
                    <span>{driver.name}</span>
                    <span className="num" style={{ color: driver.changePct < 0 ? "var(--bad)" : "var(--good)" }}>
                      {formatDelta(driver.changePct)}
                      <span className="ml-2" style={{ color: "var(--ink-3)" }}>
                        {driver.contributionPct}% of movement
                      </span>
                    </span>
                  </div>
                  <Meter
                    value={driver.contributionPct}
                    tone={driver.name === decomposition.primaryDriver ? "bad" : "neutral"}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {decomposition.supporting.map((item) => (
                <div key={item.label} className="panel-flush rounded-md border px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--ink-3)" }}>
                    {item.label}
                  </div>
                  <div className="num mt-0.5 text-[15px]">{item.value}</div>
                  {item.detail && (
                    <div className="text-[10px]" style={{ color: "var(--ink-3)" }}>
                      {item.detail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          <RevenueChart />
          <BusinessTwin />
        </div>

        <div className="space-y-4">
          <Panel title="Agents" subtitle="Status and current activity" bodyClassName="p-0">
            <ul>
              {AGENT_IDS.map((id) => {
                const row = getAgentRow(id);
                const status = row ? str(row.status) : "IDLE";
                const activity = row ? str(row.activity) : "Idle";
                const agentPending = pending.filter((a) => a.agentId === id).length;
                return (
                  <li key={id} className="border-b px-4 py-2.5 last:border-0">
                    <Link href={`/agents/${id}`} className="flex items-start gap-2.5">
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${status !== "IDLE" ? "pulse" : ""}`}
                        style={{
                          background:
                            status === "ERROR"
                              ? "var(--bad)"
                              : status === "IDLE"
                                ? "var(--good)"
                                : "var(--warn)",
                          color:
                            status === "ERROR"
                              ? "var(--bad)"
                              : status === "IDLE"
                                ? "var(--good)"
                                : "var(--warn)",
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium" style={{ color: AGENTS[id].color }}>
                            {AGENTS[id].name}
                          </span>
                          {agentPending > 0 && <Badge tone="warn">{agentPending} pending</Badge>}
                        </span>
                        <span className="block truncate text-[11px]" style={{ color: "var(--ink-3)" }}>
                          {activity}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <AgentGraph />

          <Panel
            title="Needs a human"
            subtitle={`${pending.length} awaiting decision`}
            actions={
              <Link href="/approvals" className="text-[11px]" style={{ color: "var(--accent)" }}>
                Open queue →
              </Link>
            }
            bodyClassName={pending.length ? "p-0" : undefined}
          >
            {pending.length === 0 ? (
              <Empty title="Nothing waiting" hint="Every proposed action was inside policy." />
            ) : (
              <ul>
                {pending.slice(0, 4).map((approval) => (
                  <li key={approval.id} className="border-b px-4 py-2.5 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12px]">{approval.title}</span>
                      <RiskBadge risk={approval.risk} />
                    </div>
                    <div className="mt-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
                      {AGENTS[approval.agentId].name} ·{" "}
                      <span className="num">{formatMoney(approval.financialImpactPaise)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <ActivityFeed height="h-[300px]" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Stockout risk"
          subtitle="Days of cover minus supplier lead time"
          bodyClassName={risks.length ? "p-0" : undefined}
          actions={
            <Link href="/inventory" className="text-[11px]" style={{ color: "var(--accent)" }}>
              Inventory →
            </Link>
          }
        >
          {risks.length === 0 ? (
            <Empty title="Every SKU can be resupplied before it runs out" />
          ) : (
            <ul>
              {risks.slice(0, 5).map((risk) => (
                <li key={risk.productId} className="flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[12px]">
                      <span className="num" style={{ color: "var(--ink-3)" }}>
                        {risk.sku}
                      </span>{" "}
                      {risk.name}
                    </div>
                    <div className="num text-[11px]" style={{ color: "var(--ink-3)" }}>
                      {risk.onHand} on hand · {risk.velocityPerDay}/day · {risk.daysOfCover}d cover ·{" "}
                      {risk.leadTimeDays}d lead
                    </div>
                  </div>
                  <RiskBadge risk={risk.risk} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Campaign efficiency"
          subtitle={`${wasting.length} below break-even`}
          bodyClassName="p-0"
          actions={
            <Link href="/marketing" className="text-[11px]" style={{ color: "var(--accent)" }}>
              Marketing →
            </Link>
          }
        >
          <ul>
            {[...campaigns.slice(0, 3), ...campaigns.slice(-2)].map((campaign) => (
              <li key={campaign.id} className="flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-[12px]">{campaign.name}</div>
                  <div className="num text-[11px]" style={{ color: "var(--ink-3)" }}>
                    {formatMoneyCompact(campaign.spendPaise)} spend · CAC {formatMoney(campaign.cacPaise)}
                  </div>
                </div>
                <Badge tone={campaign.roas >= 2 ? "good" : campaign.roas >= 1 ? "warn" : "bad"}>
                  {campaign.roas}× roas
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
