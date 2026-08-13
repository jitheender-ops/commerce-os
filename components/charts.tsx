"use client";

/**
 * Charts.
 *
 * Colour carries meaning only — one accent for the measured series, one warning
 * hue for the series under investigation. No gradients, no decorative axes.
 */
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel } from "@/components/ui";
import { formatMoneyCompact } from "@/lib/money";
import type { DailyMetric } from "@/types";

const AXIS = { fontSize: 10, fill: "var(--ink-3)" } as const;

function useDailyMetrics(): DailyMetric[] {
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/business/summary")
      .then((response) => response.json())
      .then((data: { metrics?: DailyMetric[] }) => {
        if (!cancelled) setMetrics(data.metrics ?? []);
      })
      .catch(() => setMetrics([]));
    return () => {
      cancelled = true;
    };
  }, []);
  return metrics;
}

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel px-2.5 py-2 text-[11px]" style={{ background: "var(--panel)" }}>
      <div className="num mb-1" style={{ color: "var(--ink-3)" }}>
        {label}
      </div>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color }} />
          <span style={{ color: "var(--ink-2)" }}>{entry.name}</span>
          <span className="num">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function RevenueChart() {
  const metrics = useDailyMetrics();
  const data = metrics.map((day) => ({
    day: day.day.slice(5),
    revenue: Math.round(day.revenuePaise / 100),
    profit: Math.round((day.revenuePaise - day.cogsPaise - day.adSpendPaise - day.refundsPaise) / 100),
    conversion: day.sessions ? Number(((day.orders / day.sessions) * 100).toFixed(2)) : 0,
  }));

  return (
    <Panel title="Revenue, profit and conversion" subtitle="30 days · measured, not projected">
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false} interval={4} />
            <YAxis
              yAxisId="money"
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => formatMoneyCompact(value * 100)}
            />
            <YAxis
              yAxisId="rate"
              orientation="right"
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => `${value}%`}
            />
            <Tooltip content={<TooltipBox />} />
            <Area
              yAxisId="money"
              type="monotone"
              dataKey="revenue"
              name="Revenue (₹)"
              stroke="var(--accent)"
              fill="var(--accent)"
              fillOpacity={0.12}
              strokeWidth={1.6}
            />
            <Area
              yAxisId="money"
              type="monotone"
              dataKey="profit"
              name="Profit (₹)"
              stroke="var(--good)"
              fill="var(--good)"
              fillOpacity={0.08}
              strokeWidth={1.4}
            />
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="conversion"
              name="Conversion %"
              stroke="var(--warn)"
              strokeWidth={1.4}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function FailureChart() {
  const metrics = useDailyMetrics();
  const data = metrics.slice(-14).map((day) => ({
    day: day.day.slice(5),
    failures: day.mobilePaymentFailures,
    returns: day.returns,
  }));

  return (
    <Panel title="Failure signals" subtitle="Mobile payment failures and returns, 14 days">
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false} interval={2} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--grid)" }} />
            <Bar dataKey="failures" name="Payment failures" radius={[2, 2, 0, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  // The final bar is the day under investigation.
                  fill={index === data.length - 1 ? "var(--bad)" : "var(--line-strong)"}
                />
              ))}
            </Bar>
            <Bar dataKey="returns" name="Returns" fill="var(--warn)" radius={[2, 2, 0, 0]} opacity={0.55} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function SimpleAreaChart({
  data,
  dataKey,
  label,
  height = 160,
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  label: string;
  height?: number;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false} interval={4} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip content={<TooltipBox />} />
          <Area
            type="monotone"
            dataKey={dataKey}
            name={label}
            stroke="var(--accent)"
            fill="var(--accent)"
            fillOpacity={0.12}
            strokeWidth={1.6}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
