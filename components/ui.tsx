/**
 * Interface primitives.
 *
 * Written by hand rather than pulled from a component library: the surface is
 * small, and owning it keeps the terminal aesthetic consistent without adding a
 * dependency or a build step.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatDelta } from "@/lib/money";
import type { RiskLevel } from "@/types";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-4 py-3 border-b">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>}
            {subtitle && (
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  delta,
  hint,
  invertDelta = false,
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
  /** For metrics where down is good (refunds, failures, stockouts). */
  invertDelta?: boolean;
}) {
  const good = delta === undefined ? null : invertDelta ? delta < 0 : delta > 0;
  return (
    <div className="panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="num text-[22px] font-semibold leading-none">{value}</span>
        {delta !== undefined && Number.isFinite(delta) && (
          <span
            className="num text-[11px] font-medium"
            style={{ color: good === null ? "var(--ink-3)" : good ? "var(--good)" : "var(--bad)" }}
          >
            {formatDelta(delta)}
          </span>
        )}
      </div>
      {hint && (
        <div className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

const TONES = {
  neutral: "var(--ink-2)",
  accent: "var(--accent)",
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  crit: "var(--crit)",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  children,
  tone = "neutral",
  className,
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  const color = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10px] font-medium uppercase tracking-[0.06em] whitespace-nowrap",
        className,
      )}
      style={{ color, borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}

export const RISK_TONE: Record<RiskLevel, Tone> = {
  LOW: "good",
  MEDIUM: "warn",
  HIGH: "bad",
  CRITICAL: "crit",
};

export const RiskBadge = ({ risk }: { risk: RiskLevel }) => (
  <Badge tone={RISK_TONE[risk]}>{risk}</Badge>
);

export function DecisionBadge({ decision }: { decision: string }) {
  const tone: Tone =
    decision === "ALLOW" || decision === "COMPLETED" || decision === "APPROVED"
      ? "good"
      : decision === "REQUIRE_APPROVAL" || decision === "PENDING_APPROVAL" || decision === "PENDING"
        ? "warn"
        : decision === "DENY" || decision === "DENIED" || decision === "FAILED" || decision === "REJECTED"
          ? "bad"
          : "neutral";
  return <Badge tone={tone}>{decision.replace(/_/g, " ")}</Badge>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
        {title}
      </p>
      {hint && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr>
            {head.map((label) => (
              <th
                key={label}
                className="border-b px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.07em] whitespace-nowrap"
                style={{ color: "var(--ink-3)" }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const Row = ({ children, className }: { children: ReactNode; className?: string }) => (
  <tr className={cn("border-b last:border-0", className)}>{children}</tr>
);

export const Cell = ({
  children,
  className,
  mono = false,
}: {
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) => <td className={cn("px-3 py-2 align-top", mono && "num", className)}>{children}</td>;

/** Horizontal proportion bar used for driver contribution and score breakdowns. */
export function Meter({ value, tone = "accent" }: { value: number; tone?: Tone }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: TONES[tone] }}
      />
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h1 className="text-[17px] font-semibold tracking-tight">{children}</h1>
      {hint && (
        <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Marks figures that come from a model rather than a measurement. Used
 * everywhere a projection is shown, per the no-hidden-magic rule.
 */
export const Estimated = ({ children }: { children?: ReactNode }) => (
  <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--warn)" }}>
    {children ?? "estimated"}
  </span>
);
