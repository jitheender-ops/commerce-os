import type { Metadata } from "next";
import "./globals.css";
import { EngineBadge, ResetButton, Sidebar, ThemeToggle } from "@/components/shell";
import { describeEngine } from "@/ai/gateway";
import { ensureSeeded } from "@/simulation/seed";

export const metadata: Metadata = {
  title: "Multi-Agent Commerce OS",
  description:
    "An operating layer where specialised AI agents observe, coordinate and execute governed business operations.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // First render on a fresh clone seeds the demo, so `npm run dev` is enough.
  ensureSeeded();
  const engine = describeEngine();

  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint so there is no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("commerce-os-theme");document.documentElement.dataset.theme=(t==="light"||t==="dark")?t:(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark")}catch(e){}`,
          }}
        />
      </head>
      <body className="surface-grid min-h-screen">
        <div className="flex min-h-screen">
          <aside
            className="hidden w-[212px] shrink-0 border-r lg:block"
            style={{ background: "var(--panel)" }}
          >
            <div className="sticky top-0 h-screen">
              <Sidebar />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header
              className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b px-4 py-2.5 backdrop-blur"
              style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}
            >
              <div className="lg:hidden">
                <span className="text-[13px] font-semibold">Commerce OS</span>
              </div>
              <div className="hidden text-[11px] lg:block" style={{ color: "var(--ink-3)" }}>
                Meridian Commerce · simulated storefront
              </div>
              <div className="flex items-center gap-2">
                <EngineBadge engine={engine} />
                <ResetButton />
                <ThemeToggle />
              </div>
            </header>

            <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>

            <footer
              className="border-t px-4 py-3 text-[10px] sm:px-6"
              style={{ color: "var(--ink-3)" }}
            >
              Simulated business data. Payments, suppliers and ad platforms are simulated —
              no external service is contacted and no money moves. Projections are labelled
              ESTIMATED and come from stated models.
            </footer>
          </div>
        </div>

        {/* Mobile navigation lives at the bottom of the document for a11y order. */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t px-2 py-1.5 lg:hidden"
          style={{ background: "var(--panel)" }}
          aria-label="Primary mobile"
        >
          {[
            { href: "/", label: "Home" },
            { href: "/agents", label: "Agents" },
            { href: "/approvals", label: "Approvals" },
            { href: "/simulation", label: "Simulate" },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 text-[11px]"
              style={{ color: "var(--ink-2)" }}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </body>
    </html>
  );
}
