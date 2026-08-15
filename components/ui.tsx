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

/**
 * `spine` paints the 2px left edge that carries a governance state:
 * `allow` executed, `ask` waiting on a person, `deny` refused, `live` in
 * flight. Leave it off for panels that adjudicate nothing — which is most of
 * them, and what keeps the ones that do carry it legible across a page.
 */
export type Spine = "allow" | "ask" | "deny" | "live";

/**
 * Where the contents came from, printed as the eyebrow above the title.
 *
 * This is the honesty rule made visible rather than documented: a reader should
 * never have to guess whether a figure was counted, projected from a stated
 * model, or decided by policy. Omit it on panels that are plainly navigation or
 * controls — an apparatus that appears everywhere stops being read.
 */
export type Source = "measured" | "estimated" | "policy" | "model" | "live";

const SOURCE_LABEL: Record<Source, string> = {
  measured: "Measured",
  estimated: "Estimated",
  policy: "Policy",
  model: "Model output",
  live: "Live",
};

const SPINE_CLASS: Record<Spine, string> = {
  allow: "spine spine-allow",
  ask: "spine spine-ask",
  deny: "spine spine-deny",
  // Live gets the travelling border rather than a spine, and not only to avoid
  // two rules fighting over one pseudo-element: a settled decision is a mark you
  // read once, while something still running should be the thing that moves.
  live: "shimmer-edge",
};

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  spine,
  source,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  spine?: Spine;
  source?: Source;
}) {
  return (
    <section className={cn("panel overflow-hidden", spine && SPINE_CLASS[spine], className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b px-4 pb-2.5 pt-3">
          <div className="min-w-0">
            {source && <div className="caps mb-1">{SOURCE_LABEL[source]}</div>}
            {title && (
              <h2 className="text-[length:var(--t-title)] font-semibold tracking-[-0.01em]">{title}</h2>
            )}
            {subtitle && (
              <p
                className="mt-1 text-[length:var(--t-label)] leading-snug"
                style={{ color: "var(--ink-3)" }}
              >
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
    <div className="panel lift px-4 py-3.5">
      <div className="caps">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="num text-[length:var(--t-figure)] font-semibold leading-none tracking-[-0.02em]">
          {value}
        </span>
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

/**
 * The masthead of a release: the name of the thing, a rule beneath it, and the
 * line of apparatus that says which edition you are reading.
 */
export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-4 pb-2">
        <h1 className="text-[length:var(--t-masthead)] font-semibold tracking-[-0.02em] leading-none">{children}</h1>
        {hint && <p className="caps shrink-0 text-right">{hint}</p>}
      </div>
      <div className="rule-strong" />
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
