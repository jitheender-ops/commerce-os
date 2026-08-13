import { getCampaignEfficiency } from "@/database/queries";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { Badge, Cell, Meter, Panel, Row, SectionTitle, Stat, Table } from "@/components/ui";

const VERDICT_TONE = {
  HIGH_PERFORMER: "good",
  HEALTHY: "good",
  UNDERPERFORMING: "warn",
  WASTING: "bad",
} as const;

export default function MarketingPage() {
  const campaigns = getCampaignEfficiency();
  const spend = campaigns.reduce((sum, c) => sum + c.spendPaise, 0);
  const revenue = campaigns.reduce((sum, c) => sum + c.revenuePaise, 0);
  const wasting = campaigns.filter((c) => c.verdict === "WASTING");
  const wastedSpend = wasting.reduce((sum, c) => sum + c.spendPaise, 0);
  const bestRoas = Math.max(...campaigns.map((c) => c.roas), 1);

  return (
    <div className="space-y-5">
      <SectionTitle hint="No ad platform is contacted — budget changes are simulated">
        Marketing Intelligence
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total spend" value={formatMoneyCompact(spend)} />
        <Stat label="Attributed revenue" value={formatMoneyCompact(revenue)} />
        <Stat label="Blended ROAS" value={`${spend ? (revenue / spend).toFixed(2) : 0}×`} />
        <Stat
          label="Below break-even"
          value={String(wasting.length)}
          hint={`${formatMoneyCompact(wastedSpend)} at risk`}
          invertDelta
        />
      </div>

      <Panel title="Campaign performance" subtitle="Ranked by return on ad spend" bodyClassName="p-0">
        <Table head={["Campaign", "Channel", "Spend", "Revenue", "ROAS", "CAC", "CTR", "Conv %", "Verdict"]}>
          {campaigns.map((campaign) => (
            <Row key={campaign.id}>
              <Cell>
                <span className="text-[12px]">{campaign.name}</span>
                <span className="mt-1 block w-32">
                  <Meter
                    value={(campaign.roas / bestRoas) * 100}
                    tone={VERDICT_TONE[campaign.verdict]}
                  />
                </span>
              </Cell>
              <Cell className="text-[11px]">{campaign.channel}</Cell>
              <Cell mono>{formatMoneyCompact(campaign.spendPaise)}</Cell>
              <Cell mono>{formatMoneyCompact(campaign.revenuePaise)}</Cell>
              <Cell mono>{campaign.roas}×</Cell>
              <Cell mono>{formatMoney(campaign.cacPaise)}</Cell>
              <Cell mono>{campaign.ctr}%</Cell>
              <Cell mono>{campaign.conversionRate}%</Cell>
              <Cell>
                <Badge tone={VERDICT_TONE[campaign.verdict]}>
                  {campaign.verdict.replace("_", " ").toLowerCase()}
                </Badge>
              </Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Where the money is working" subtitle="Top three by return">
          <ul className="space-y-2">
            {campaigns.slice(0, 3).map((campaign) => (
              <li key={campaign.id} className="panel-flush rounded-md border px-3 py-2">
                <div className="flex justify-between text-[12px]">
                  <span>{campaign.name}</span>
                  <span className="num" style={{ color: "var(--good)" }}>{campaign.roas}×</span>
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
                  {formatMoneyCompact(campaign.revenuePaise)} returned on{" "}
                  {formatMoneyCompact(campaign.spendPaise)} · {campaign.conversions} conversions at{" "}
                  {formatMoney(campaign.cacPaise)} each
                </p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Where it is not" subtitle="Below break-even — every conversion loses money">
          <ul className="space-y-2">
            {campaigns
              .filter((c) => c.roas < 1.5)
              .map((campaign) => (
                <li key={campaign.id} className="panel-flush rounded-md border px-3 py-2">
                  <div className="flex justify-between text-[12px]">
                    <span>{campaign.name}</span>
                    <span className="num" style={{ color: "var(--bad)" }}>{campaign.roas}×</span>
                  </div>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
                    Pausing frees {formatMoney(campaign.dailyBudgetPaise)}/day
                  </p>
                </li>
              ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
