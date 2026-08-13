/**
 * Deterministic commerce simulator.
 *
 * Everything the demo shows is generated from one seed, so the same numbers
 * appear on every machine and after every reset. Daily metrics are *derived*
 * from the generated orders rather than invented separately — that is what lets
 * the Analytics Agent decompose revenue into traffic × conversion × AOV and
 * have the arithmetic actually reconcile.
 *
 * The most recent day carries a deliberate, discoverable fault: a mobile
 * checkout regression. It is not hard-coded into any agent — the agents find it
 * by querying this data.
 */
import { AGENTS, AGENT_IDS } from "@/agents/definitions";
import { getDb, truncateAll } from "@/database/db";
import { upsertDailyMetric } from "@/database/queries";
import { getVectorStore } from "@/memory/vector";
import { rupees } from "@/lib/money";
import { DEMO_SEED, Rng } from "@/lib/rng";
import type { DailyMetric, Product } from "@/types";

const DAYS = 30;
const CUSTOMER_COUNT = 500;
/** Runaway guard only — the traffic model, not this, sets the order count. */
const ORDER_HARD_CAP = 6000;

interface Catalogue {
  name: string;
  category: string;
  brand: string;
  description: string;
  costRupees: number;
  markup: number;
}

const CATALOGUE: Catalogue[] = [
  { name: "UltraBook 14 Pro", category: "Laptops", brand: "Nexon", description: "14-inch laptop with a 12-core processor and 16GB RAM for programming and video editing.", costRupees: 52000, markup: 1.42 },
  { name: "UltraBook 15 Air", category: "Laptops", brand: "Nexon", description: "Thin 15-inch laptop with all-day battery for writing and browsing.", costRupees: 41000, markup: 1.4 },
  { name: "CreatorBook Studio", category: "Laptops", brand: "Ardent", description: "Colour-accurate display laptop built for video editing and design work.", costRupees: 68000, markup: 1.36 },
  { name: "WorkMate 13", category: "Laptops", brand: "Corvid", description: "Compact business laptop with a fingerprint reader and long warranty.", costRupees: 34000, markup: 1.45 },
  { name: "GameForge 16", category: "Laptops", brand: "Ardent", description: "High refresh gaming laptop with dedicated graphics for rendering and play.", costRupees: 74000, markup: 1.33 },
  { name: "Aurora 27 Monitor", category: "Monitors", brand: "Lumen", description: "27-inch 4K monitor with USB-C charging for a clean desk setup.", costRupees: 18500, markup: 1.5 },
  { name: "Aurora 32 Curved", category: "Monitors", brand: "Lumen", description: "32-inch curved monitor for immersive editing and gaming.", costRupees: 26000, markup: 1.46 },
  { name: "Portable Screen 15", category: "Monitors", brand: "Lumen", description: "Travel monitor that runs off a single USB-C cable.", costRupees: 9800, markup: 1.55 },
  { name: "MechKey Pro", category: "Keyboards", brand: "Tactus", description: "Mechanical keyboard with hot-swappable switches for long typing sessions.", costRupees: 4200, markup: 1.7 },
  { name: "MechKey Compact", category: "Keyboards", brand: "Tactus", description: "65% mechanical keyboard that leaves desk room for the mouse.", costRupees: 3400, markup: 1.72 },
  { name: "SilentBoard Wireless", category: "Keyboards", brand: "Corvid", description: "Quiet wireless keyboard for shared offices.", costRupees: 2600, markup: 1.68 },
  { name: "Glide Mouse MX", category: "Mice", brand: "Tactus", description: "Ergonomic wireless mouse with programmable side buttons.", costRupees: 2400, markup: 1.75 },
  { name: "Glide Mouse Lite", category: "Mice", brand: "Tactus", description: "Lightweight mouse for travel bags.", costRupees: 1100, markup: 1.8 },
  { name: "Precision Trackpad", category: "Mice", brand: "Corvid", description: "Large glass trackpad with gesture support.", costRupees: 5600, markup: 1.6 },
  { name: "StudioPods Max", category: "Audio", brand: "Resonant", description: "Over-ear headphones with active noise cancelling for focused work.", costRupees: 14500, markup: 1.52 },
  { name: "StudioPods Air", category: "Audio", brand: "Resonant", description: "In-ear wireless earbuds with a compact charging case.", costRupees: 4800, markup: 1.65 },
  { name: "DeskMic Condenser", category: "Audio", brand: "Resonant", description: "USB condenser microphone for calls, podcasts and voiceover.", costRupees: 6200, markup: 1.58 },
  { name: "ClearCam 4K", category: "Audio", brand: "Lumen", description: "4K webcam with auto light correction for meetings and streaming.", costRupees: 7400, markup: 1.55 },
  { name: "PowerBank 20K", category: "Power", brand: "Voltix", description: "20,000mAh power bank that fast-charges a laptop.", costRupees: 3200, markup: 1.7 },
  { name: "GaN Charger 100W", category: "Power", brand: "Voltix", description: "Compact 100W charger with three ports for travel.", costRupees: 2900, markup: 1.72 },
  { name: "Surge Strip Pro", category: "Power", brand: "Voltix", description: "Six-socket surge protector with individual switches.", costRupees: 1400, markup: 1.8 },
  { name: "Desk Hub 9-in-1", category: "Accessories", brand: "Corvid", description: "USB-C dock with HDMI, ethernet and card readers.", costRupees: 4600, markup: 1.66 },
  { name: "Laptop Stand Alloy", category: "Accessories", brand: "Ardent", description: "Aluminium laptop stand that raises the screen to eye level.", costRupees: 1900, markup: 1.78 },
  { name: "Cable Organiser Kit", category: "Accessories", brand: "Corvid", description: "Magnetic cable clips and sleeves for a tidy desk.", costRupees: 600, markup: 1.9 },
  { name: "Backpack Commuter 22L", category: "Bags", brand: "Trailhead", description: "Water-resistant backpack with a padded 16-inch laptop sleeve.", costRupees: 3100, markup: 1.7 },
  { name: "Sleeve Felt 14", category: "Bags", brand: "Trailhead", description: "Wool felt sleeve that protects a 14-inch laptop.", costRupees: 1200, markup: 1.85 },
  { name: "Roller Case 20", category: "Bags", brand: "Trailhead", description: "Cabin-sized roller case with a dedicated tech compartment.", costRupees: 7800, markup: 1.55 },
  { name: "SSD Portable 1TB", category: "Storage", brand: "Vault", description: "Pocket SSD with 1050MB/s transfer for video projects.", costRupees: 7200, markup: 1.58 },
  { name: "SSD Portable 2TB", category: "Storage", brand: "Vault", description: "2TB pocket SSD for large editing libraries.", costRupees: 12800, markup: 1.52 },
  { name: "NAS Drive 4TB", category: "Storage", brand: "Vault", description: "Network drive for shared team backups.", costRupees: 16500, markup: 1.48 },
  { name: "SD Card Pro 256GB", category: "Storage", brand: "Vault", description: "Fast SD card rated for 4K video capture.", costRupees: 2800, markup: 1.7 },
  { name: "Router Mesh Duo", category: "Network", brand: "Signal", description: "Two-node mesh router covering a three-bedroom home.", costRupees: 8900, markup: 1.5 },
  { name: "Switch 8-Port", category: "Network", brand: "Signal", description: "Gigabit switch for wiring a home office.", costRupees: 2200, markup: 1.72 },
  { name: "WiFi Adapter AX", category: "Network", brand: "Signal", description: "USB adapter that adds WiFi 6 to a desktop.", costRupees: 1600, markup: 1.78 },
  { name: "Smart Lamp Warm", category: "Lighting", brand: "Lumen", description: "Desk lamp with adjustable colour temperature for evening work.", costRupees: 2100, markup: 1.75 },
  { name: "Key Light Panel", category: "Lighting", brand: "Lumen", description: "Soft LED panel for video calls and streaming.", costRupees: 5400, markup: 1.6 },
  { name: "Monitor Light Bar", category: "Lighting", brand: "Lumen", description: "Screen-mounted light bar that removes glare.", costRupees: 2700, markup: 1.7 },
  { name: "Chair Ergo Mesh", category: "Furniture", brand: "Postura", description: "Mesh office chair with adjustable lumbar support.", costRupees: 14200, markup: 1.5 },
  { name: "Standing Desk 120", category: "Furniture", brand: "Postura", description: "Electric standing desk with memory presets.", costRupees: 21500, markup: 1.45 },
  { name: "Monitor Arm Dual", category: "Furniture", brand: "Postura", description: "Gas-spring arm that holds two monitors.", costRupees: 4900, markup: 1.62 },
  { name: "Footrest Adjustable", category: "Furniture", brand: "Postura", description: "Angled footrest that improves desk posture.", costRupees: 1800, markup: 1.8 },
  { name: "Tablet Slate 11", category: "Tablets", brand: "Nexon", description: "11-inch tablet with pen support for notes and sketching.", costRupees: 22000, markup: 1.45 },
  { name: "Tablet Slate Mini", category: "Tablets", brand: "Nexon", description: "Compact tablet for reading and travel.", costRupees: 13500, markup: 1.5 },
  { name: "Stylus Precision", category: "Tablets", brand: "Nexon", description: "Pressure-sensitive stylus for drawing and markup.", costRupees: 4300, markup: 1.68 },
  { name: "Watch Track 2", category: "Wearables", brand: "Pulse", description: "Fitness watch with sleep and heart-rate tracking.", costRupees: 6800, markup: 1.6 },
  { name: "Band Lite", category: "Wearables", brand: "Pulse", description: "Slim fitness band with a two-week battery.", costRupees: 1900, markup: 1.82 },
  { name: "Earbuds Sport", category: "Wearables", brand: "Pulse", description: "Sweat-resistant earbuds that stay put while running.", costRupees: 3600, markup: 1.7 },
  { name: "Printer Ink Tank", category: "Printers", brand: "Inkwell", description: "Refillable ink tank printer with low running cost.", costRupees: 11500, markup: 1.48 },
  { name: "Label Printer Mini", category: "Printers", brand: "Inkwell", description: "Thermal label printer for shipping and storage.", costRupees: 4100, markup: 1.65 },
  { name: "Shredder Cross-Cut", category: "Printers", brand: "Inkwell", description: "Cross-cut shredder for confidential paperwork.", costRupees: 6600, markup: 1.55 },
];

const SUPPLIER_NAMES = [
  "Meridian Distribution", "Coastal Supply Co", "Northgate Traders", "Vertex Wholesale",
  "Silverline Imports", "Anchor Logistics", "Redstone Sourcing", "Pinnacle Depot",
  "Harbour Components", "Ironvale Supply",
];

const FIRST_NAMES = ["Aarav","Diya","Kabir","Ananya","Vihaan","Ishita","Arjun","Meera","Rohan","Saanvi","Karthik","Priya","Aditya","Nisha","Rahul","Tara","Vikram","Neha","Siddharth","Kavya"];
const LAST_NAMES = ["Sharma","Iyer","Patel","Reddy","Nair","Gupta","Menon","Desai","Rao","Kulkarni","Banerjee","Chopra","Joshi","Pillai","Verma"];

export interface SeedReport {
  products: number;
  customers: number;
  orders: number;
  suppliers: number;
  campaigns: number;
  days: number;
  tickets: number;
}

/**
 * Seeds through the process-wide connection rather than an injected adapter:
 * the helpers this uses (`upsertDailyMetric`, the vector index) resolve the
 * connection themselves, and passing a second adapter here would silently write
 * half the dataset to a different database. Tests point `DATABASE_PATH` at a
 * temporary file instead.
 */
export function seedDemo(): SeedReport {
  const db = getDb();
  const rng = new Rng(DEMO_SEED);

  return db.transaction(() => {
    truncateAll(db);

    const now = new Date();
    const dayOffset = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d;
    };
    const iso = (d: Date) => d.toISOString();
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);

    db.run(
      `INSERT INTO businesses (id, name, currency, created_at) VALUES (?, ?, ?, ?)`,
      "biz_demo", "Meridian Commerce", "INR", iso(dayOffset(365)),
    );

    // ── Agents ──────────────────────────────────────────────────────────────
    for (const id of AGENT_IDS) {
      const agent = AGENTS[id];
      db.run(
        `INSERT INTO agents (id, name, role, objective, autonomy, status, activity,
            daily_budget_paise, budget_used_paise, last_active_at)
         VALUES (?, ?, ?, ?, ?, 'IDLE', 'Idle', ?, 0, NULL)`,
        agent.id, agent.name, agent.role, agent.objective, agent.autonomy,
        agent.dailyBudgetPaise,
      );
      for (const permission of agent.permissions) {
        db.run(
          `INSERT INTO agent_permissions (agent_id, permission) VALUES (?, ?)`,
          agent.id, permission,
        );
      }
      db.run(`INSERT INTO agent_metrics (agent_id) VALUES (?)`, agent.id);
    }

    // ── Suppliers ───────────────────────────────────────────────────────────
    const supplierIds = SUPPLIER_NAMES.map((name, index) => {
      const id = `sup_${String(index + 1).padStart(2, "0")}`;
      db.run(
        `INSERT INTO suppliers (id, name, quality_score, reliability_score,
            lead_time_days, minimum_order_quantity) VALUES (?, ?, ?, ?, ?, ?)`,
        id, name,
        Number(rng.float(3.4, 4.9).toFixed(2)),
        Number(rng.float(0.72, 0.99).toFixed(2)),
        rng.int(3, 18),
        rng.pick([10, 20, 25, 50]),
      );
      return id;
    });

    // ── Products, inventory, quotes ─────────────────────────────────────────
    const products: Product[] = CATALOGUE.map((entry, index) => {
      const id = `prd_${String(index + 1).padStart(3, "0")}`;
      const sku = `SKU-${1000 + index + 1}`;
      const costPaise = rupees(entry.costRupees);
      const pricePaise = Math.round(costPaise * entry.markup);
      // Competitors sit within ±12% of our price.
      const competitorPricePaise = Math.round(pricePaise * rng.float(0.88, 1.12));
      const product: Product = {
        id, sku,
        name: entry.name,
        category: entry.category,
        brand: entry.brand,
        description: entry.description,
        costPaise,
        pricePaise,
        competitorPricePaise,
        rating: Number(rng.float(3.6, 4.9).toFixed(1)),
        createdAt: iso(dayOffset(rng.int(60, 300))),
      };
      db.run(
        `INSERT INTO products (id, sku, name, category, brand, description, cost_paise,
            price_paise, competitor_price_paise, rating, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, sku, entry.name, entry.category, entry.brand, entry.description,
        costPaise, pricePaise, competitorPricePaise, product.rating, product.createdAt,
      );

      const supplierId = supplierIds[index % supplierIds.length];
      const leadTime = rng.int(4, 16);
      db.run(
        `INSERT INTO inventory (product_id, on_hand, reserved, reorder_point, supplier_id, lead_time_days)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id, rng.int(8, 260), rng.int(0, 6), rng.int(15, 60), supplierId, leadTime,
      );

      // Three quotes per product so procurement has a real trade-off to make:
      // cheapest, fastest, and a middle option.
      const chosen = rng.shuffle([...supplierIds]).slice(0, 3);
      chosen.forEach((sid, position) => {
        const costMultiplier = [0.97, 1.04, 1.12][position];
        db.run(
          `INSERT INTO supplier_quotes (supplier_id, product_id, unit_cost_paise,
              lead_time_days, minimum_order_quantity) VALUES (?, ?, ?, ?, ?)`,
          sid, id,
          Math.round(costPaise * costMultiplier),
          position === 1 ? rng.int(2, 5) : rng.int(8, 18),
          rng.pick([10, 20, 25]),
        );
      });

      return product;
    });

    for (const product of products) getVectorStore().index(product);

    // ── Customers ───────────────────────────────────────────────────────────
    const customerIds: string[] = [];
    for (let i = 0; i < CUSTOMER_COUNT; i++) {
      const id = `cus_${String(i + 1).padStart(4, "0")}`;
      const first = rng.pick(FIRST_NAMES);
      const last = rng.pick(LAST_NAMES);
      db.run(
        `INSERT INTO customers (id, name, email, segment, ltv_paise, orders_count, created_at)
         VALUES (?, ?, ?, ?, 0, 0, ?)`,
        id, `${first} ${last}`,
        `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
        rng.weighted([["new", 40], ["returning", 35], ["premium", 15], ["at_risk", 10]]),
        iso(dayOffset(rng.int(1, 400))),
      );
      customerIds.push(id);
    }

    // ── Orders ──────────────────────────────────────────────────────────────
    // Sessions per day drive order volume; the final day carries the fault.
    const dailyAccumulator = new Map<string, DailyMetric>();
    let orderIndex = 0;

    for (let d = DAYS - 1; d >= 0; d--) {
      const date = dayOffset(d);
      const key = dayKey(date);
      const isLatest = d === 0;
      const weekday = date.getDay();
      const weekendLift = weekday === 0 || weekday === 6 ? 1.18 : 1;

      // Sized so 30 days of traffic at the baseline conversion rate lands near
      // TARGET_ORDERS. Oversizing it here would exhaust the order budget on the
      // oldest days and leave the recent window — the one every agent queries —
      // empty.
      const sessions = Math.round(rng.int(2080, 2460) * weekendLift);
      // Healthy baseline conversion ~3.0%. The latest day drops to ~2.2% because
      // mobile checkout is failing — the fault the agents are meant to find.
      const conversion = isLatest ? rng.float(0.021, 0.023) : rng.float(0.028, 0.032);
      const orderCount = Math.max(1, Math.round(sessions * conversion));

      const metric: DailyMetric = {
        day: key,
        sessions,
        orders: 0,
        revenuePaise: 0,
        cogsPaise: 0,
        adSpendPaise: rupees(rng.int(28_000, 42_000)),
        refundsPaise: 0,
        mobilePaymentFailures: isLatest ? rng.int(180, 220) : rng.int(28, 52),
        returns: isLatest ? rng.int(38, 48) : rng.int(14, 26),
      };

      for (let i = 0; i < orderCount && orderIndex < ORDER_HARD_CAP; i++) {
        orderIndex++;
        const orderId = `ord_${String(orderIndex).padStart(5, "0")}`;
        const customerId = rng.pick(customerIds);
        const channel = rng.weighted<"web" | "mobile" | "app">([
          ["web", 42], ["mobile", 40], ["app", 18],
        ]);

        const itemCount = rng.weighted([[1, 62], [2, 26], [3, 12]]);
        const picked = rng.shuffle([...products]).slice(0, itemCount);
        let total = 0;
        let cost = 0;
        const lines = picked.map((product) => {
          const quantity = rng.weighted([[1, 78], [2, 17], [3, 5]]);
          total += product.pricePaise * quantity;
          cost += product.costPaise * quantity;
          return { product, quantity };
        });

        // On the fault day, mobile checkout fails far more often.
        const failureRate = isLatest && channel === "mobile" ? 0.19 : 0.02;
        const failed = rng.bool(failureRate);
        const cancelled = !failed && rng.bool(0.03);
        const status = failed ? "CANCELLED" : cancelled ? "CANCELLED" : rng.weighted([
          ["DELIVERED", 62], ["SHIPPED", 22], ["PAID", 12], ["RETURNED", 4],
        ] as [string, number][]);

        const createdAt = new Date(date);
        createdAt.setHours(rng.int(6, 23), rng.int(0, 59), rng.int(0, 59));

        db.run(
          `INSERT INTO orders (id, customer_id, status, channel, total_paise, cost_paise,
              payment_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          orderId, customerId, status, channel, total, cost,
          failed ? "FAILED" : "SUCCESS", iso(createdAt),
        );
        for (const line of lines) {
          db.run(
            `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise)
             VALUES (?, ?, ?, ?)`,
            orderId, line.product.id, line.quantity, line.product.pricePaise,
          );
        }

        if (status !== "CANCELLED") {
          metric.orders += 1;
          metric.revenuePaise += total;
          metric.cogsPaise += cost;
          db.run(
            `UPDATE customers SET orders_count = orders_count + 1, ltv_paise = ltv_paise + ?
              WHERE id = ?`,
            total, customerId,
          );
        }
        if (status === "RETURNED") metric.refundsPaise += Math.round(total * 0.9);
      }

      dailyAccumulator.set(key, metric);
    }

    for (const metric of dailyAccumulator.values()) upsertDailyMetric(metric);

    // ── Campaigns ───────────────────────────────────────────────────────────
    const campaignSpecs: { name: string; channel: "search" | "social" | "email" | "display"; roas: number }[] = [
      { name: "Search — Laptops (brand)", channel: "search", roas: 5.4 },
      { name: "Search — Accessories (generic)", channel: "search", roas: 2.6 },
      { name: "Social — Creator audience", channel: "social", roas: 3.1 },
      { name: "Social — Broad prospecting", channel: "social", roas: 0.7 },
      { name: "Email — Cart recovery", channel: "email", roas: 8.2 },
      { name: "Email — Winback 90d", channel: "email", roas: 2.2 },
      { name: "Display — Retargeting", channel: "display", roas: 1.6 },
      { name: "Display — Awareness", channel: "display", roas: 0.5 },
    ];

    campaignSpecs.forEach((spec, index) => {
      const id = `cmp_${String(index + 1).padStart(2, "0")}`;
      const spend = rupees(rng.int(45_000, 180_000));
      const revenue = Math.round(spend * spec.roas);
      const clicks = rng.int(2_400, 14_000);
      db.run(
        `INSERT INTO campaigns (id, name, channel, status, daily_budget_paise, spend_paise,
            revenue_paise, clicks, impressions, conversions)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
        id, spec.name, spec.channel,
        rupees(rng.int(4_000, 14_000)),
        spend, revenue, clicks,
        clicks * rng.int(14, 40),
        Math.max(1, Math.round(clicks * rng.float(0.012, 0.05))),
      );

      for (let d = 6; d >= 0; d--) {
        const key = dayKey(dayOffset(d));
        const daySpend = Math.round(spend / 7);
        db.run(
          `INSERT INTO campaign_metrics (campaign_id, day, spend_paise, revenue_paise, clicks, conversions)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id, key, daySpend,
          Math.round(daySpend * spec.roas * rng.float(0.85, 1.15)),
          Math.round(clicks / 7),
          Math.max(1, Math.round((clicks / 7) * 0.03)),
        );
      }
    });

    // ── Tickets ─────────────────────────────────────────────────────────────
    const recentOrders = db.all<{ id: string; customer_id: string }>(
      `SELECT id, customer_id FROM orders ORDER BY created_at DESC LIMIT 40`,
    );
    const ticketTemplates = [
      { subject: "Payment failed twice on mobile", body: "I tried to check out on my phone twice and both payments failed. The web site worked on my laptop. Is something broken?" },
      { subject: "Where is my order?", body: "My order was marked shipped four days ago but tracking has not moved." },
      { subject: "Wrong item delivered", body: "I ordered the 14-inch stand and received the 15-inch sleeve instead." },
      { subject: "Refund not received", body: "I returned an item last week and have not seen the refund yet." },
      { subject: "Does this work with USB-C?", body: "Will this dock charge a 100W laptop over a single cable?" },
      { subject: "Item arrived damaged", body: "The box was crushed and the lamp inside has a cracked base." },
      { subject: "Cancel my order", body: "I ordered the wrong size. Please cancel before it ships." },
      { subject: "Bulk order discount", body: "We want twenty units for our office. Is there a discount?" },
      // A checkout regression generates support volume; these are the customer-side
      // evidence of the same fault the metrics show, arriving through a different
      // channel so the Customer Agent can corroborate Analytics independently.
      { subject: "Checkout keeps erroring", body: "Every time I press pay on my phone I get a generic error message." },
      { subject: "Card declined on the app but works elsewhere", body: "My card was declined three times in your app today. The same card works fine everywhere else." },
      { subject: "Cannot complete payment on mobile", body: "The payment screen spins and then fails. I gave up and ordered from a laptop instead." },
      { subject: "Warranty question", body: "How long is the warranty on the mesh chair, and does it cover the gas lift?" },
      { subject: "Missing invoice", body: "I need a GST invoice for my order for reimbursement." },
      { subject: "Product recommendation", body: "I need a laptop under 80,000 for programming and video editing. What do you suggest?" },
    ];
    ticketTemplates.forEach((template, index) => {
      const order = recentOrders[index % recentOrders.length];
      db.run(
        `INSERT INTO tickets (id, customer_id, order_id, subject, body, status, reply, created_at)
         VALUES (?, ?, ?, ?, ?, 'OPEN', NULL, ?)`,
        `tkt_${String(index + 1).padStart(3, "0")}`,
        order.customer_id,
        index % 3 === 0 ? null : order.id,
        template.subject,
        template.body,
        iso(dayOffset(rng.int(0, 3))),
      );
    });

    // ── Seed memory ─────────────────────────────────────────────────────────
    const seedMemories: [string, string, string][] = [
      ["marketing", "semantic", "Email cart-recovery campaigns have historically returned the highest ROAS of any channel."],
      ["marketing", "episodic", "Display Awareness was scaled up last quarter and returned under 1.0 ROAS for six straight weeks."],
      ["customer", "semantic", "Premium customers consistently choose express shipping when it is offered."],
      ["inventory", "semantic", "Supplier lead times lengthen by roughly 30% in the two weeks before a festival period."],
      ["pricing", "episodic", "A 12% price cut on monitors last quarter increased units but reduced total gross profit."],
      ["ceo", "policy", "Profit growth is preferred over revenue growth when the two conflict."],
    ];
    for (const [agentId, kind, content] of seedMemories) {
      db.run(
        `INSERT INTO agent_memory (id, agent_id, kind, content, terms, importance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `mem_seed_${agentId}_${kind}_${content.length}`,
        agentId, kind, content,
        content.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2).join(" "),
        0.7,
        iso(dayOffset(rng.int(5, 40))),
      );
    }

    db.run(
      `INSERT INTO system_state (key, value) VALUES ('seeded_at', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      new Date().toISOString(),
    );

    const count = (table: string) =>
      Number(
        (db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0),
      );

    return {
      products: count("products"),
      customers: count("customers"),
      orders: count("orders"),
      suppliers: count("suppliers"),
      campaigns: count("campaigns"),
      days: count("daily_metrics"),
      tickets: count("tickets"),
    };
  });
}

/** True when the database has no seeded data yet. */
export function needsSeed(): boolean {
  const row = getDb().get<{ n: number }>(`SELECT COUNT(*) AS n FROM products`);
  return Number(row?.n ?? 0) === 0;
}

export function ensureSeeded(): void {
  if (needsSeed()) seedDemo();
}
