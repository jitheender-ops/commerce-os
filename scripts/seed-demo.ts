/**
 * Seeds (or reseeds) the demo database.
 *
 *   npm run seed          — seed only if the database is empty
 *   npm run reset-demo    — wipe and reseed to the exact starting state
 */
import { needsSeed, seedDemo } from "@/simulation/seed";
import { getBusinessSummary } from "@/database/queries";
import { formatMoney, formatMoneyCompact } from "@/lib/money";

const reset = process.argv.includes("--reset");

if (!reset && !needsSeed()) {
  console.log("Database already seeded. Use `npm run reset-demo` to start over.");
  process.exit(0);
}

const started = Date.now();
const report = seedDemo();
const summary = getBusinessSummary();

console.log(`\n  Multi-Agent Commerce OS — demo data ${reset ? "reset" : "seeded"}\n`);
console.log(`  products      ${report.products}`);
console.log(`  customers     ${report.customers}`);
console.log(`  orders        ${report.orders}`);
console.log(`  suppliers     ${report.suppliers}`);
console.log(`  campaigns     ${report.campaigns}`);
console.log(`  tickets       ${report.tickets}`);
console.log(`  metric days   ${report.days}`);
console.log(`\n  latest day    revenue ${formatMoneyCompact(summary.revenuePaise)} · ` +
  `profit ${formatMoneyCompact(summary.profitPaise)} · ` +
  `conversion ${summary.conversionRate}% (${summary.deltas.conversion}%)`);
console.log(`  AOV           ${formatMoney(summary.aovPaise)}`);
console.log(`  at-risk SKUs  ${summary.inventoryRisks}`);
console.log(`\n  done in ${Date.now() - started}ms\n`);
