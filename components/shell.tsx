"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  Activity, BadgeCheck, BarChart3, Boxes, Brain, Cpu, Gauge,
  LineChart, Megaphone, Package, ScrollText, Settings, ShieldCheck, Sparkles,
  Truck, Users, Wallet,
} from "lucide-react";
import { cn } from "@/lib/cn";

const NAV: { group: string; items: { href: string; label: string; icon: typeof Gauge }[] }[] = [
  {
    group: "Operations",
    items: [
      { href: "/", label: "Command Center", icon: Gauge },
      { href: "/agents", label: "Agents", icon: Cpu },
      { href: "/goals", label: "Goals", icon: BadgeCheck },
      { href: "/approvals", label: "Approvals", icon: ShieldCheck },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { href: "/inventory", label: "Inventory", icon: Boxes },
      { href: "/pricing", label: "Pricing", icon: LineChart },
      { href: "/marketing", label: "Marketing", icon: Megaphone },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/procurement", label: "Procurement", icon: Truck },
      { href: "/finance", label: "Finance", icon: Wallet },
      { href: "/products", label: "Catalogue", icon: Package },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/simulation", label: "Simulator", icon: Sparkles },
      { href: "/events", label: "Event Stream", icon: Activity },
      { href: "/audit", label: "Audit Log", icon: ScrollText },
      { href: "/memory", label: "Agent Memory", icon: Brain },
      { href: "/observability", label: "Observability", icon: BarChart3 },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4">
      <Link href="/" className="flex items-center gap-2 px-2">
        <span
          className="grid h-7 w-7 place-items-center rounded-md text-[11px] font-bold"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          C
        </span>
        <span className="text-[13px] font-semibold leading-tight">
          Commerce OS
          <span className="block text-[10px] font-normal" style={{ color: "var(--ink-3)" }}>
            multi-agent operations
          </span>
        </span>
      </Link>

      {NAV.map((section) => (
        <div key={section.group}>
          <div
            className="px-2 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: "var(--ink-3)" }}
          >
            {section.group}
          </div>
          <ul className="space-y-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                      active ? "font-medium" : "hover:bg-[var(--panel-2)]",
                    )}
                    style={
                      active
                        ? { background: "var(--panel-2)", color: "var(--accent)" }
                        : { color: "var(--ink-2)" }
                    }
                  >
                    <Icon size={14} strokeWidth={1.9} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function EngineBadge({
  engine,
}: {
  engine: { label: string; mode: "deterministic" | "hosted"; detail: string };
}) {
  const deterministic = engine.mode === "deterministic";
  return (
    <div
      className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
      title={engine.detail}
      style={{ borderColor: deterministic ? "var(--warn)" : "var(--good)" }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: deterministic ? "var(--warn)" : "var(--good)" }}
      />
      <span className="text-[10px] uppercase tracking-[0.07em]" style={{ color: "var(--ink-2)" }}>
        {deterministic ? "Demo mode" : "Hosted model"}
      </span>
      <span className="num hidden text-[10px] sm:inline" style={{ color: "var(--ink-3)" }}>
        {engine.label}
      </span>
    </div>
  );
}

/**
 * The theme lives on `<html data-theme>`, set before first paint by the inline
 * script in the layout. This component reads that attribute rather than holding
 * its own copy, so there is no state to synchronise and no flash on load.
 */
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

const readTheme = (): "dark" | "light" =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as const);

  return (
    <button
      type="button"
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        localStorage.setItem("commerce-os-theme", next);
      }}
      className="rounded-md border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.07em] transition-colors hover:bg-[var(--panel-2)]"
      style={{ color: "var(--ink-2)" }}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}

export function ResetButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/simulation/reset", { method: "POST" });
          window.location.reload();
        } catch {
          setBusy(false);
        }
      }}
      className="rounded-md border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.07em] transition-colors hover:bg-[var(--panel-2)] disabled:opacity-50"
      style={{ color: "var(--ink-2)" }}
    >
      {busy ? "Resetting…" : "Reset demo"}
    </button>
  );
}
