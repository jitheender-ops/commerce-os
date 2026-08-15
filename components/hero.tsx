"use client";

/**
 * The Command Center hero.
 *
 * The only part of this console that performs. Everything below it is a working
 * surface where motion competes with reading, so the interactive grid is
 * contained here and the rest of the interface stays still.
 *
 * What it states is the standing position of the business — the figure, the
 * direction, what is waiting on a person — because a hero that says the product
 * name back to you is a banner, not a header.
 */

import Link from "next/link";
import KineticGrid from "@/components/kinetic-grid";
import { useTheme } from "@/components/shell";
import { formatDelta } from "@/lib/money";

/** Grid colours per edition, so it is legible on paper as well as at night. */
const GRID = {
  dark: { bg: "#080d16", line: "180,205,255", active: "96,165,250", restOpacity: 0.13 },
  light: { bg: "#0f1729", line: "200,220,255", active: "125,180,255", restOpacity: 0.16 },
};

export function CommandHero({
  latestDay,
  revenue,
  revenueDelta,
  pending,
  agents,
}: {
  latestDay: string;
  revenue: string;
  revenueDelta: number;
  pending: number;
  agents: number;
}) {
  const grid = GRID[useTheme()];
  const up = revenueDelta >= 0;

  return (
    <KineticGrid {...grid} className="rounded-[var(--r-panel)] border" >
      <div className="flex min-h-[210px] flex-col justify-between gap-6 p-6 md:min-h-[240px] md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="caps" style={{ color: "rgba(255,255,255,0.55)" }}>
              Command Center · {latestDay}
            </p>
            <h1
              className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]"
              style={{ color: "#ffffff" }}
            >
              {agents} agents running the business
            </h1>
          </div>

          {pending > 0 && (
            <Link
              href="/approvals"
              className="glass-thin shrink-0 px-3 py-2 text-[11px] font-medium transition-transform hover:-translate-y-0.5"
              style={{ color: "#fff", borderColor: "rgba(255,255,255,0.25)" }}
            >
              {pending} waiting on you →
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="caps" style={{ color: "rgba(255,255,255,0.5)" }}>
              Revenue, latest day
            </p>
            <p className="num mt-1 flex items-baseline gap-2 text-[30px] font-semibold leading-none tracking-[-0.02em] md:text-[38px]" style={{ color: "#fff" }}>
              {revenue}
              <span
                className="text-[13px] font-medium"
                style={{ color: up ? "#4ade80" : "#fb7185" }}
              >
                {formatDelta(revenueDelta)}
              </span>
            </p>
          </div>
          <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>
            Move the pointer across this panel. Click it.
          </p>
        </div>
      </div>
    </KineticGrid>
  );
}
