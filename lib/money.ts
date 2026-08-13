/**
 * Money helpers. Everything in the system is an integer number of paise.
 * The currency symbol lives here and nowhere else, so the rest of the
 * application stays currency-agnostic.
 */

export const CURRENCY = "₹";

/** ₹1,23,456.78 — Indian digit grouping, two decimals only when non-zero. */
export function formatMoney(paise: number, opts: { decimals?: boolean } = {}): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const showDecimals = opts.decimals ?? fraction !== 0;
  const body = groupIndian(rupees) + (showDecimals ? `.${String(fraction).padStart(2, "0")}` : "");
  return `${negative ? "-" : ""}${CURRENCY}${body}`;
}

/** ₹18.4L / ₹1.2Cr — compact form for dashboard tiles. */
export function formatMoneyCompact(paise: number): string {
  const negative = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const sign = negative ? "-" : "";
  if (rupees >= 1e7) return `${sign}${CURRENCY}${trim(rupees / 1e7)}Cr`;
  if (rupees >= 1e5) return `${sign}${CURRENCY}${trim(rupees / 1e5)}L`;
  if (rupees >= 1e3) return `${sign}${CURRENCY}${trim(rupees / 1e3)}K`;
  return `${sign}${CURRENCY}${Math.round(rupees)}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

export const rupees = (n: number): number => Math.round(n * 100);

/** Percentage with a sign, e.g. "+8.7%" — used everywhere deltas are shown. */
export function formatDelta(value: number, digits = 1): string {
  const s = value.toFixed(digits);
  return `${value > 0 ? "+" : ""}${s}%`;
}

export function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return (part / whole) * 100;
}

/** Percentage change from `from` to `to`. Returns 0 when the base is 0. */
export function changePct(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / Math.abs(from)) * 100;
}

/** Gross margin percentage for a unit economics pair. */
export function marginPct(pricePaise: number, costPaise: number): number {
  if (pricePaise === 0) return 0;
  return ((pricePaise - costPaise) / pricePaise) * 100;
}
