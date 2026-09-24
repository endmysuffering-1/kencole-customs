import "./load-env";

import type { Prisma } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { cents, money } from "@/lib/money";
import {
  calculateLandedCost,
  summariseCharges,
  type ChargeLine,
  type LandedCostResult,
  type LineInput,
  type RateBook,
} from "@/lib/domain/landed-cost";
import { calculateBrokerCharges, type PricingRuleSnapshot } from "@/lib/domain/pricing";
import { KEYWORD_RULES, rankSuggestions, suggestFromKeywords } from "@/lib/domain/classification";
import { canTransition, type ShipmentStatus, type TransitionGuardContext } from "@/lib/domain/shipment-state";
import { detectExceptions, type ExceptionInput } from "@/lib/domain/exceptions";
import { loadPricingRules, loadRateBook } from "@/lib/services/rate-book";
import {
  nextInvoiceReference,
  nextQuoteReference,
  nextShipmentReference,
  referenceYear,
} from "@/lib/services/references";
// The same client the app uses, so seeded references advance the same counters
// the running application allocates from.
import { db as prisma } from "@/lib/db";
import { storage } from "@/lib/providers/storage";
import { sampleInvoicePdf } from "./sample-invoice";

/**
 * Every RateRule below is illustrative dev data, not a Bahamian tariff rate.
 * HANDOFF.md is explicit that nothing regulatory may be asserted here — hence
 * confirmed: false throughout, and a note pointing back at that requirement.
 */
const RATE_PENDING_NOTE =
  "Placeholder for local development — not verified against the Tariff Act or Customs " +
  "Management Regulations. Set confirmed=true with a sourceNote citing the instrument " +
  "before this rate is used for anything real. See HANDOFF.md.";
const PERMIT_PENDING_NOTE =
  "Placeholder agency/permit for local development — confirm the current permit regime " +
  "before production. See HANDOFF.md.";

/** Development only: every seeded account shares it, and it is in the repository.
 *  That is why the seed refuses to run anywhere but a local development database. */
const DEV_PASSWORD = "KencoleDev#2026";

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/**
 * The password every seeded account gets. On a local database it defaults to
 * DEV_PASSWORD, which is committed above. Anywhere else it must come from
 * SEED_PASSWORD, so a hosted preview never has accounts anyone who has read the
 * repository could sign in to.
 */
const SEED_PASSWORD = process.env.SEED_PASSWORD?.trim() || null;
const PASSWORD = SEED_PASSWORD ?? DEV_PASSWORD;

/**
 * This seed creates a SUPER_ADMIN and 21 other accounts that share a password.
 * It refuses production outright, and a non-local database unless told
 * otherwise and given a password that is not in the repository.
 */
function assertDevelopmentDatabase() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed with NODE_ENV=production. This seed creates accounts whose shared " +
      "password is committed to the repository.",
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!local && process.env.SEED_ALLOW_NON_LOCAL !== "1") {
    throw new Error(
      `Refusing to seed ${host}: it is not a local database. If it really is a disposable ` +
      "development database (a Docker service, say), rerun with SEED_ALLOW_NON_LOCAL=1.",
    );
  }
  if (!local && (!SEED_PASSWORD || SEED_PASSWORD === DEV_PASSWORD || SEED_PASSWORD.length < 16)) {
    throw new Error(
      `Refusing to seed ${host} with the password committed to the repository. Set SEED_PASSWORD ` +
      "to a password of at least 16 characters that only you know.",
    );
  }
}

// ─────────────────────────────── Reference data ──────────────────────────────

/** Tariff-table wording for the HS codes the classifier knows. Keywords are not
 *  kept here: suggestions come from KEYWORD_RULES, the same table the app uses. */
interface HsCodeSeed {
  code: string;
  description: string;
  regulated?: { agency: string; permit: string };
}

const HS_CODES: HsCodeSeed[] = [
  { code: "8471.30.00", description: "Portable automatic data processing machines (laptops)" },
  { code: "8517.13.00", description: "Smartphones" },
  { code: "6109.10.00", description: "T-shirts, singlets, cotton, knitted" },
  { code: "9403.20.00", description: "Other metal furniture" },
  { code: "8708.99.00", description: "Other parts and accessories of motor vehicles" },
  {
    code: "2208.40.00",
    description: "Rum and other spirits obtained by distilling fermented sugar-cane products",
    regulated: { agency: "Bahamas Customs & Excise", permit: "Liquor import permit" },
  },
  {
    code: "3004.90.00",
    description: "Medicaments, packaged for retail sale",
    regulated: { agency: "Ministry of Health & Wellness", permit: "Pharmaceutical import permit" },
  },
  {
    code: "0303.00.00",
    description: "Fish, frozen",
    regulated: { agency: "Department of Marine Resources", permit: "Fisheries import permit" },
  },
];

const REGULATED_CODES = new Set(HS_CODES.filter((h) => h.regulated).map((h) => h.code));

const chapterOf = (code: string) => code.slice(0, 2);

/** Line items shipments are built from. Every one carries an HS code; whether a
 *  broker has stood behind it is a per-shipment decision, not a property here. */
const ITEMS = {
  laptop: { description: "14-inch business laptop", unitValue: "900.00", hsCode: "8471.30.00" },
  tablet: { description: "Tablet computer, 10-inch", unitValue: "310.00", hsCode: "8471.30.00" },
  phone: { description: "Android smartphone, unlocked", unitValue: "420.00", hsCode: "8517.13.00" },
  tshirt: { description: "Cotton t-shirts, assorted sizes", unitValue: "8.50", hsCode: "6109.10.00" },
  workshirt: { description: "Cotton work shirts, bulk", unitValue: "12.00", hsCode: "6109.10.00" },
  shelving: { description: "Steel shelving unit, 5-tier", unitValue: "145.00", hsCode: "9403.20.00" },
  lockers: { description: "Metal storage lockers", unitValue: "260.00", hsCode: "9403.20.00" },
  brakepads: { description: "Vehicle brake pad set", unitValue: "35.00", hsCode: "8708.99.00" },
  alternator: { description: "Alternator assembly", unitValue: "185.00", hsCode: "8708.99.00" },
  rum: { description: "Rum, 750ml bottles", unitValue: "28.00", hsCode: "2208.40.00" },
  spirits: { description: "Spirits, assorted, 1L", unitValue: "34.00", hsCode: "2208.40.00" },
  meds: { description: "Prescription medicaments, packaged", unitValue: "60.00", hsCode: "3004.90.00" },
  fish: { description: "Frozen fish fillets", unitValue: "6.50", hsCode: "0303.00.00" },
  shrimp: { description: "Frozen shrimp, 5kg cartons", unitValue: "48.00", hsCode: "0303.00.00" },
} satisfies Record<string, { description: string; unitValue: string; hsCode: string }>;

type ItemKey = keyof typeof ITEMS;

// ─────────────────────────────── Shipment scenarios ──────────────────────────

/**
 * The happy path, in order. A scenario's status is reached by walking the prefix
 * of this line, so no scenario can describe a shipment the state machine would
 * have refused to produce — `walk` re-checks every hop against canTransition.
 */
const MAIN_LINE: ShipmentStatus[] = [
  "DOCUMENTS_RECEIVED", "UNDER_REVIEW", "CLASSIFICATION_REVIEW", "QUOTE_READY",
  "AWAITING_PAYMENT", "PAID", "DECLARATION_PREPARED", "SUBMITTED_TO_CUSTOMS", "CUSTOMS_REVIEW",
  "CUSTOMS_RELEASED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED",
];

function pathTo(target: ShipmentStatus, via?: ShipmentStatus): ShipmentStatus[] {
  if (target === "DRAFT") return [];
  if (via) {
    const idx = MAIN_LINE.indexOf(via);
    if (idx === -1) throw new Error(`${via} is not on the main line.`);
    return [...MAIN_LINE.slice(0, idx + 1), target];
  }
  const idx = MAIN_LINE.indexOf(target);
  // Off-line statuses reachable straight from DRAFT (DOCUMENTS_REQUIRED, CANCELLED).
  return idx === -1 ? [target] : MAIN_LINE.slice(0, idx + 1);
}

type Party = { kind: "consumer"; index: number } | { kind: "business"; index: number };

interface ShipmentSpec {
  party: Party;
  target: ShipmentStatus;
  via?: ShipmentStatus;
  mode: "AIR" | "SEA" | "COURIER";
  supplier: number;
  items: { key: ItemKey; quantity: string }[];
  createdDaysAgo: number;
  /** Whether a broker has signed off the lines. Anything reaching a declaration
   *  must be "approved" — the state machine will refuse otherwise. */
  classification: "approved" | "needs_review" | "unclassified";
  description: string;
  note?: string;
}

const c = (index: number): Party => ({ kind: "consumer", index });
const b = (index: number): Party => ({ kind: "business", index });

/** 30 shipments covering every ShipmentStatus at least once. */
const SHIPMENT_SPECS: ShipmentSpec[] = [
  { party: c(1), target: "DRAFT", mode: "AIR", supplier: 0, items: [{ key: "phone", quantity: "1" }], createdDaysAgo: 1, classification: "unclassified", description: "Phone, personal use" },
  { party: b(0), target: "DRAFT", mode: "SEA", supplier: 2, items: [{ key: "shelving", quantity: "12" }], createdDaysAgo: 2, classification: "unclassified", description: "Store fit-out shelving" },

  { party: c(2), target: "DOCUMENTS_REQUIRED", mode: "COURIER", supplier: 0, items: [{ key: "tablet", quantity: "1" }], createdDaysAgo: 6, classification: "unclassified", description: "Tablet from online order", note: "No commercial invoice supplied" },
  { party: b(3), target: "DOCUMENTS_REQUIRED", mode: "AIR", supplier: 7, items: [{ key: "tshirt", quantity: "300" }], createdDaysAgo: 9, classification: "unclassified", description: "Summer apparel restock", note: "Awaiting supplier invoice" },

  { party: c(0), target: "DOCUMENTS_RECEIVED", mode: "AIR", supplier: 0, items: [{ key: "laptop", quantity: "1" }], createdDaysAgo: 4, classification: "unclassified", description: "Laptop replacement" },

  { party: b(1), target: "UNDER_REVIEW", mode: "SEA", supplier: 3, items: [{ key: "fish", quantity: "400" }], createdDaysAgo: 7, classification: "needs_review", description: "Frozen fish, weekly order" },

  { party: b(2), target: "CLASSIFICATION_REVIEW", mode: "SEA", supplier: 5, items: [{ key: "brakepads", quantity: "60" }, { key: "alternator", quantity: "8" }], createdDaysAgo: 8, classification: "needs_review", description: "Auto parts restock" },

  { party: b(0), target: "QUOTE_READY", mode: "SEA", supplier: 1, items: [{ key: "laptop", quantity: "3" }, { key: "brakepads", quantity: "20" }], createdDaysAgo: 10, classification: "approved", description: "Dispatch office hardware" },
  { party: c(3), target: "QUOTE_READY", mode: "COURIER", supplier: 0, items: [{ key: "tshirt", quantity: "24" }], createdDaysAgo: 5, classification: "approved", description: "Clothing order" },

  { party: b(4), target: "AWAITING_PAYMENT", mode: "SEA", supplier: 9, items: [{ key: "lockers", quantity: "10" }], createdDaysAgo: 12, classification: "approved", description: "Site storage lockers" },
  { party: c(0), target: "AWAITING_PAYMENT", mode: "AIR", supplier: 6, items: [{ key: "phone", quantity: "2" }], createdDaysAgo: 6, classification: "approved", description: "Two handsets" },

  { party: b(1), target: "PAID", mode: "SEA", supplier: 4, items: [{ key: "shrimp", quantity: "80" }], createdDaysAgo: 14, classification: "approved", description: "Shrimp, restaurant supply" },
  { party: c(4), target: "PAID", mode: "COURIER", supplier: 0, items: [{ key: "tablet", quantity: "1" }], createdDaysAgo: 9, classification: "approved", description: "Tablet for school" },

  { party: c(1), target: "PAID", mode: "AIR", supplier: 6, items: [{ key: "laptop", quantity: "1" }], createdDaysAgo: 11, classification: "approved", description: "Laptop, at the airport" },

  { party: b(3), target: "DECLARATION_PREPARED", mode: "SEA", supplier: 7, items: [{ key: "tshirt", quantity: "500" }, { key: "workshirt", quantity: "120" }], createdDaysAgo: 18, classification: "approved", description: "Seasonal apparel container" },
  { party: b(2), target: "CUSTOMS_REVIEW", mode: "SEA", supplier: 5, items: [{ key: "brakepads", quantity: "120" }], createdDaysAgo: 20, classification: "approved", description: "Brake pads, bulk" },

  { party: b(0), target: "DECLARATION_PREPARED", mode: "SEA", supplier: 2, items: [{ key: "shelving", quantity: "20" }, { key: "lockers", quantity: "6" }], createdDaysAgo: 22, classification: "approved", description: "Warehouse fittings" },

  { party: b(1), target: "SUBMITTED_TO_CUSTOMS", mode: "SEA", supplier: 3, items: [{ key: "fish", quantity: "600" }], createdDaysAgo: 24, classification: "approved", description: "Frozen fish container" },
  { party: c(0), target: "SUBMITTED_TO_CUSTOMS", mode: "COURIER", supplier: 8, items: [{ key: "rum", quantity: "6" }], createdDaysAgo: 16, classification: "approved", description: "Rum, personal import" },

  { party: b(4), target: "CUSTOMS_REVIEW", mode: "SEA", supplier: 9, items: [{ key: "shelving", quantity: "30" }], createdDaysAgo: 26, classification: "approved", description: "Building supply order" },

  { party: b(1), target: "CUSTOMS_HOLD", via: "SUBMITTED_TO_CUSTOMS", mode: "SEA", supplier: 4, items: [{ key: "shrimp", quantity: "200" }], createdDaysAgo: 28, classification: "approved", description: "Shrimp, held for inspection", note: "Selected for physical inspection" },
  { party: c(2), target: "CUSTOMS_HOLD", via: "SUBMITTED_TO_CUSTOMS", mode: "AIR", supplier: 8, items: [{ key: "spirits", quantity: "12" }], createdDaysAgo: 25, classification: "approved", description: "Spirits, permit query", note: "Permit documentation queried" },

  { party: b(2), target: "DUTIES_DUE", via: "CUSTOMS_REVIEW", mode: "SEA", supplier: 5, items: [{ key: "alternator", quantity: "24" }], createdDaysAgo: 30, classification: "approved", description: "Alternators, duties assessed" },

  { party: b(3), target: "CUSTOMS_RELEASED", mode: "AIR", supplier: 7, items: [{ key: "workshirt", quantity: "200" }], createdDaysAgo: 27, classification: "approved", description: "Uniform restock" },

  { party: c(3), target: "READY_FOR_DELIVERY", mode: "COURIER", supplier: 0, items: [{ key: "phone", quantity: "1" }], createdDaysAgo: 19, classification: "approved", description: "Handset, ready for delivery" },

  { party: b(0), target: "OUT_FOR_DELIVERY", mode: "SEA", supplier: 1, items: [{ key: "laptop", quantity: "5" }], createdDaysAgo: 23, classification: "approved", description: "Laptops, out for delivery" },

  { party: c(0), target: "DELIVERED", mode: "COURIER", supplier: 8, items: [{ key: "rum", quantity: "6" }], createdDaysAgo: 34, classification: "approved", description: "Rum, delivered" },
  { party: c(4), target: "DELIVERED", mode: "AIR", supplier: 6, items: [{ key: "meds", quantity: "10" }], createdDaysAgo: 31, classification: "approved", description: "Medicaments, delivered" },

  { party: c(2), target: "CANCELLED", mode: "AIR", supplier: 0, items: [{ key: "tshirt", quantity: "10" }], createdDaysAgo: 15, classification: "unclassified", description: "Cancelled before submission", note: "Customer cancelled the order" },
  { party: b(4), target: "CANCELLED", via: "AWAITING_PAYMENT", mode: "SEA", supplier: 9, items: [{ key: "shelving", quantity: "8" }], createdDaysAgo: 21, classification: "approved", description: "Cancelled after quoting", note: "Customer withdrew after the quote" },
];

/** Where goods wait to be cleared, by how they arrived. Kencole clears goods
 *  already in The Bahamas; it does not move them here. */
const HELD_AT: Record<ShipmentSpec["mode"], string> = {
  SEA: "Nassau Container Port, Arawak Cay",
  AIR: "Air cargo, Lynden Pindling International Airport",
  COURIER: "Courier warehouse, Nassau",
};

// ─────────────────────────────── Costing helpers ─────────────────────────────

let rateBookCache: RateBook | null = null;
const pricingCache = new Map<string, PricingRuleSnapshot[]>();

/** Mirrors estimateShipment(): the live rate book and pricing rules through the
 *  real domain engine, so every seeded figure is produced by the code the app
 *  runs rather than typed in by hand. */
async function estimate(
  totals: { goodsValue: string; freightCost: string; insuranceCost: string; grossWeightKg?: string | null },
  lines: LineInput[],
  ctx: {
    businessId: string | null;
    importType: "PERSONAL" | "COMMERCIAL";
    planCode?: string | null;
    brokerageDiscount?: string;
    deliveryDiscount?: string;
    deliveryRequested: boolean;
  },
): Promise<LandedCostResult> {
  rateBookCache ??= await loadRateBook();
  const cacheKey = ctx.businessId ?? "__none__";
  if (!pricingCache.has(cacheKey)) pricingCache.set(cacheKey, await loadPricingRules(ctx.businessId));

  const customsValue = cents(
    money(totals.goodsValue).plus(money(totals.freightCost)).plus(money(totals.insuranceCost)),
  );
  const brokerCharges = calculateBrokerCharges(pricingCache.get(cacheKey)!, {
    customsValue: customsValue.toString(),
    lineCount: Math.max(lines.length, 1),
    importType: ctx.importType,
    businessId: ctx.businessId,
    planCode: ctx.planCode ?? null,
    brokerageDiscount: ctx.brokerageDiscount ?? 0,
    deliveryDiscount: ctx.deliveryDiscount ?? 0,
    deliveryRequested: ctx.deliveryRequested,
  });
  return calculateLandedCost(
    {
      goodsValue: totals.goodsValue,
      freightCost: totals.freightCost,
      insuranceCost: totals.insuranceCost,
      grossWeightKg: totals.grossWeightKg ?? null,
      lines,
    },
    rateBookCache,
    brokerCharges,
  );
}

/** Validates each hop against the real state machine before writing it, so a
 *  mistake in a scenario fails loudly instead of seeding a shipment the app
 *  itself would never have allowed to reach that status. */
async function hop(
  shipmentId: string,
  from: ShipmentStatus,
  to: ShipmentStatus,
  ctx: TransitionGuardContext,
  at: Date,
  actorId: string,
  note?: string,
): Promise<ShipmentStatus> {
  const verdict = canTransition(from, to, ctx);
  if (!verdict.ok) {
    throw new Error(`Seed scenario takes an illegal transition ${from} -> ${to}: ${verdict.reason}`);
  }
  await prisma.shipmentStatusHistory.create({
    data: { shipmentId, from, to, actorId, note, createdAt: at },
  });
  await prisma.shipment.update({ where: { id: shipmentId }, data: { status: to } });
  return to;
}

/** Mirrors issueQuote(): summarise the computed charges and persist a Quote with
 *  its CustomsCharge rows. A quote can stand on its own — a shipment sitting at
 *  QUOTE_READY has been priced but not yet billed. */
async function issueQuote(input: {
  shipmentReference: string;
  shipmentId: string;
  estimateResult: LandedCostResult;
  chargeTypeIdByCode: Map<string, string>;
  brokerApproved: boolean;
  status: "ISSUED" | "ACCEPTED";
  quotedAt: Date;
}) {
  const summary = summariseCharges(input.estimateResult.charges);
  return prisma.quote.create({
    data: {
      reference: await nextQuoteReference(input.shipmentId, input.shipmentReference),
      shipmentId: input.shipmentId,
      status: input.status,
      customsValue: input.estimateResult.customsValue,
      governmentTotal: input.estimateResult.governmentTotal,
      brokerTotal: input.estimateResult.brokerTotal,
      grandTotal: input.estimateResult.grandTotal,
      brokerApproved: input.brokerApproved,
      expiresAt: new Date(input.quotedAt.getTime() + 1000 * 60 * 60 * 24 * 14),
      createdAt: input.quotedAt,
      charges: {
        create: summary.map((ch: ChargeLine) => ({
          chargeTypeId: input.chargeTypeIdByCode.get(ch.chargeCode)!,
          payee: ch.payee,
          basisAmount: ch.basisAmount,
          rateApplied: ch.rateApplied,
          amount: ch.amount,
          rateRuleId: ch.rateRuleId ?? null,
        })),
      },
    },
  });
}

/** Mirrors issueInvoiceForQuote(). governmentTotal and brokerTotal are stored as
 *  separate columns; total is their sum, never a stand-in for either. */
async function issueInvoice(input: {
  shipmentReference: string;
  shipmentId: string;
  quote: { id: string; governmentTotal: Prisma.Decimal; brokerTotal: Prisma.Decimal };
  estimateResult: LandedCostResult;
  billToEmail: string;
  businessId: string | null;
  issuedAt: Date;
}) {
  const summary = summariseCharges(input.estimateResult.charges);
  const total = cents(
    money(input.quote.governmentTotal).plus(money(input.quote.brokerTotal)),
  ).toFixed(2);

  const invoice = await prisma.invoice.create({
    data: {
      reference: await nextInvoiceReference(input.shipmentId, input.shipmentReference),
      shipmentId: input.shipmentId,
      quoteId: input.quote.id,
      businessId: input.businessId,
      billToEmail: input.billToEmail,
      status: "ISSUED",
      governmentTotal: input.estimateResult.governmentTotal,
      brokerTotal: input.estimateResult.brokerTotal,
      total,
      issuedAt: input.issuedAt,
      dueAt: new Date(input.issuedAt.getTime() + 1000 * 60 * 60 * 24 * 7),
      lines: {
        create: summary.map((ch: ChargeLine, index: number) => ({
          description: ch.label,
          payee: ch.payee,
          amount: ch.amount,
          chargeCode: ch.chargeCode,
          sortOrder: index,
        })),
      },
    },
  });

  return { invoice, total };
}

let paymentSeq = 0;
/** Mirrors recordPayment(): one successful payment that settles the invoice in full. */
async function payInFull(invoiceId: string, total: string, receivedAt: Date, recordedBy: string) {
  paymentSeq += 1;
  await prisma.$transaction([
    prisma.payment.create({
      data: {
        invoiceId,
        provider: "bank_transfer",
        providerRef: `BT-${String(100000 + paymentSeq)}`,
        amount: total,
        status: "SUCCEEDED",
        receivedAt,
        recordedBy,
      },
    }),
    prisma.invoice.update({ where: { id: invoiceId }, data: { amountPaid: total, status: "PAID" } }),
  ]);
}

/** Hop timestamps spread evenly between creation and now, so history reads as a
 *  timeline and nothing is dated in the future. */
function hopTimes(createdAt: Date, count: number): Date[] {
  const step = (NOW.getTime() - createdAt.getTime()) / (count + 1);
  return Array.from({ length: count }, (_, i) => new Date(createdAt.getTime() + step * (i + 1)));
}

function freightFor(mode: "AIR" | "SEA" | "COURIER", goodsValue: string) {
  const goods = money(goodsValue);
  const table = { AIR: { rate: "0.08", min: "45.00" }, SEA: { rate: "0.12", min: "180.00" }, COURIER: { rate: "0.05", min: "25.00" } }[mode];
  const freight = cents(goods.times(money(table.rate)));
  return {
    freightCost: (freight.lessThan(money(table.min)) ? money(table.min) : freight).toFixed(2),
    insuranceCost: mode === "COURIER" ? "0.00" : cents(goods.times(money("0.01"))).toFixed(2),
  };
}

// ─────────────────────────────── Seed ────────────────────────────────────────

async function main() {
  assertDevelopmentDatabase();

  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log(`Database already has ${existing} user(s) — skipping seed.`);
    console.log("Run `npm run db:reset` to wipe the database and reseed from scratch.");
    return;
  }

  const passwordHash = await hashPassword(PASSWORD);
  type Role = "SUPER_ADMIN" | "CUSTOMS_BROKER" | "OPERATIONS" | "DRIVER" | "BUSINESS_ADMIN" | "BUSINESS_USER" | "CONSUMER";
  const seedUser = (email: string, fullName: string, role: Role, phone: string) =>
    prisma.user.create({ data: { email, fullName, role, phone, passwordHash, emailVerified: new Date() } });

  // ── Staff ──
  const [admin, broker, broker2, ops, ops2, driverUser, driverUser2] = await Promise.all([
    seedUser("admin@kencole.bs", "Andrea Bethel", "SUPER_ADMIN", "+1 242 555 0100"),
    seedUser("broker@kencole.bs", "Nicole Farrington", "CUSTOMS_BROKER", "+1 242 555 0101"),
    seedUser("broker2@kencole.bs", "Everette Gibson", "CUSTOMS_BROKER", "+1 242 555 0104"),
    seedUser("ops@kencole.bs", "Trevor Adderley", "OPERATIONS", "+1 242 555 0102"),
    seedUser("ops2@kencole.bs", "Lakeisha Moss", "OPERATIONS", "+1 242 555 0105"),
    seedUser("driver@kencole.bs", "Shane Ferguson", "DRIVER", "+1 242 555 0103"),
    seedUser("driver2@kencole.bs", "Omar Culmer", "DRIVER", "+1 242 555 0106"),
  ]);

  const drivers = await Promise.all([
    prisma.driver.create({ data: { userId: driverUser.id, vehicle: "Nissan NV200 van — plate KC-4471" } }),
    prisma.driver.create({ data: { userId: driverUser2.id, vehicle: "Isuzu box truck — plate KC-2210" } }),
  ]);

  // ── Plans ──
  const [consumerPlus, businessStarter, businessPro] = await Promise.all([
    prisma.plan.create({ data: { code: "CONSUMER_PLUS", name: "Consumer Plus", audience: "B2C", monthlyPrice: "9.99", currency: "BSD", features: ["Priority document review", "10% off brokerage fees", "Email + SMS tracking updates"], brokerageDiscount: "0.10", deliveryDiscount: "0", sortOrder: 10 } }),
    prisma.plan.create({ data: { code: "BUSINESS_STARTER", name: "Business Starter", audience: "B2B", monthlyPrice: "49.00", currency: "BSD", features: ["Dedicated account manager", "5% off brokerage fees"], brokerageDiscount: "0.05", deliveryDiscount: "0", sortOrder: 20 } }),
    prisma.plan.create({ data: { code: "BUSINESS_PRO", name: "Business Pro", audience: "B2B", monthlyPrice: "199.00", currency: "BSD", features: ["Dedicated account manager", "15% off brokerage fees", "10% off delivery", "Priority customs queue"], brokerageDiscount: "0.15", deliveryDiscount: "0.10", sortOrder: 30 } }),
  ]);

  // ── Consumers ──
  const consumerSpecs = [
    { email: "marcus.deveaux@example.com", name: "Marcus Deveaux", phone: "+1 242 555 0118", line1: "22 Coral Vista Way", settlement: "Nassau", island: "New Providence", plan: consumerPlus, nib: "NIB-035-556-812" },
    { email: "simone.pinder@example.com", name: "Simone Pinder", phone: "+1 242 555 0177", line1: "8 Pineridge Close", settlement: "Freeport", island: "Grand Bahama", plan: null, nib: null },
    { email: "andre.rolle@example.com", name: "Andre Rolle", phone: "+1 242 555 0164", line1: "115 Blue Hill Road", settlement: "Nassau", island: "New Providence", plan: null, nib: null },
    { email: "kaya.symonette@example.com", name: "Kaya Symonette", phone: "+1 242 555 0191", line1: "3 Harbour View Lane", settlement: "Marsh Harbour", island: "Abaco", plan: consumerPlus, nib: "NIB-041-220-337" },
    { email: "delroy.bain@example.com", name: "Delroy Bain", phone: "+1 242 555 0128", line1: "76 Prince Charles Drive", settlement: "Nassau", island: "New Providence", plan: null, nib: null },
  ];

  const consumers: { user: { id: string; email: string }; addressId: string; planCode: string | null; plan: typeof consumerPlus | null }[] = [];
  for (const spec of consumerSpecs) {
    const user = await seedUser(spec.email, spec.name, "CONSUMER", spec.phone);
    const address = await prisma.address.create({
      data: { label: "Home", line1: spec.line1, settlement: spec.settlement, island: spec.island, contact: spec.name, phone: spec.phone },
    });
    const subscription = spec.plan
      ? await prisma.subscription.create({ data: { planId: spec.plan.id, startedAt: daysAgo(220) } })
      : null;
    await prisma.consumerProfile.create({
      data: { userId: user.id, nib: spec.nib, addressId: address.id, membershipId: subscription?.id ?? null },
    });
    consumers.push({ user, addressId: address.id, planCode: spec.plan?.code ?? null, plan: spec.plan });
  }

  // ── Businesses ──
  const businessSpecs = [
    { legalName: "Island Hardware & Marine Ltd", trading: "Island Hardware & Marine", industry: "Marine & hardware retail", domain: "islandhardwaremarine.bs", adminName: "Deborah Knowles", userName: "Patrice Rolle", line1: "14 Marina Drive", settlement: "Nassau", island: "New Providence", plan: businessPro, tin: "TIN-2041-0088", importer: "IMP-BS-77321", manager: () => ops },
    { legalName: "Bahama Fresh Foods Ltd", trading: "Bahama Fresh", industry: "Food import & distribution", domain: "bahamafresh.bs", adminName: "Anthony Cartwright", userName: "Renae Miller", line1: "9 Gladstone Road", settlement: "Nassau", island: "New Providence", plan: businessPro, tin: "TIN-3120-4471", importer: "IMP-BS-81004", manager: () => ops },
    { legalName: "Lucayan Auto Parts Ltd", trading: "Lucayan Auto", industry: "Automotive parts retail", domain: "lucayanauto.bs", adminName: "Vincent Saunders", userName: "Tamika Bowe", line1: "41 Queens Highway", settlement: "Freeport", island: "Grand Bahama", plan: businessStarter, tin: "TIN-5507-2290", importer: "IMP-BS-64118", manager: () => ops2 },
    { legalName: "Paradise Isle Boutique Ltd", trading: "Paradise Isle", industry: "Apparel retail", domain: "paradiseisleboutique.bs", adminName: "Alicia Curry", userName: "Joel Stubbs", line1: "27 Bay Street", settlement: "Nassau", island: "New Providence", plan: businessStarter, tin: "TIN-6612-1180", importer: "IMP-BS-90277", manager: () => ops2 },
    { legalName: "Abaco Build Supply Ltd", trading: "Abaco Build", industry: "Construction supply", domain: "abacobuild.bs", adminName: "Garnell Thompson", userName: "Shavonne Dean", line1: "2 Don MacKay Boulevard", settlement: "Marsh Harbour", island: "Abaco", plan: null, tin: "TIN-7734-5512", importer: "IMP-BS-55190", manager: () => ops },
  ];

  const businesses: { id: string; billingEmail: string; addressId: string; planCode: string | null; plan: typeof businessPro | null; adminId: string; userId: string }[] = [];
  for (const spec of businessSpecs) {
    const subscription = spec.plan
      ? await prisma.subscription.create({ data: { planId: spec.plan.id, startedAt: daysAgo(540) } })
      : null;
    const business = await prisma.business.create({
      data: {
        legalName: spec.legalName, tradingName: spec.trading, tin: spec.tin, importerNumber: spec.importer,
        industry: spec.industry, billingEmail: `billing@${spec.domain}`,
        accountManagerId: spec.manager().id, subscriptionId: subscription?.id ?? null,
      },
    });
    const bizAdmin = await seedUser(`owner@${spec.domain}`, spec.adminName, "BUSINESS_ADMIN", "+1 242 555 0142");
    const bizUser = await seedUser(`imports@${spec.domain}`, spec.userName, "BUSINESS_USER", "+1 242 555 0143");
    await prisma.businessMember.createMany({
      data: [
        { businessId: business.id, userId: bizAdmin.id, isAdmin: true },
        { businessId: business.id, userId: bizUser.id, isAdmin: false },
      ],
    });
    const address = await prisma.address.create({
      data: { label: "Warehouse", line1: spec.line1, settlement: spec.settlement, island: spec.island, contact: spec.adminName, phone: "+1 242 555 0142", businessId: business.id },
    });
    businesses.push({
      id: business.id, billingEmail: business.billingEmail!, addressId: address.id,
      planCode: spec.plan?.code ?? null, plan: spec.plan, adminId: bizAdmin.id, userId: bizUser.id,
    });
  }

  // ── Trade reference data ──
  const hsCodeIdByCode = new Map<string, string>();
  for (const h of HS_CODES) {
    const created = await prisma.hsCode.create({
      data: { code: h.code, description: h.description, chapter: chapterOf(h.code) },
    });
    hsCodeIdByCode.set(h.code, created.id);
  }

  await prisma.permitRequirement.createMany({
    data: HS_CODES.filter((h) => h.regulated).map((h) => ({
      hsCodeId: hsCodeIdByCode.get(h.code)!,
      agency: h.regulated!.agency, permit: h.regulated!.permit, notes: PERMIT_PENDING_NOTE,
    })),
  });

  const chargeTypeIdByCode = new Map<string, string>();
  async function chargeType(input: {
    code: string; label: string; payee: "GOVERNMENT" | "BROKER"; level?: "LINE" | "SHIPMENT";
    basis: "PERCENT_OF_CUSTOMS_VALUE" | "PERCENT_OF_DUTIABLE_TOTAL" | "PERCENT_OF_GOODS_VALUE" | "FLAT" | "PER_LINE" | "PER_UNIT_WEIGHT";
    sortOrder: number; baseIncludes?: string[]; description: string;
    rules: { rate: string; hsCode?: string; chapter?: string; minAmount?: string; maxAmount?: string }[];
  }) {
    const created = await prisma.chargeType.create({
      data: {
        code: input.code, label: input.label, payee: input.payee, basis: input.basis,
        level: input.level ?? "LINE", sortOrder: input.sortOrder, baseIncludes: input.baseIncludes ?? [], description: input.description,
        rateRules: {
          create: input.rules.map((r) => ({
            rate: r.rate,
            hsCodeId: r.hsCode ? hsCodeIdByCode.get(r.hsCode)! : null,
            chapter: r.chapter ?? null,
            minAmount: r.minAmount ?? null,
            maxAmount: r.maxAmount ?? null,
            effectiveFrom: new Date("2020-01-01"),
            // Never true in seed data. A rate becomes authoritative only when a
            // human has checked it against the instrument and said so.
            confirmed: false,
            sourceNote: RATE_PENDING_NOTE,
          })),
        },
      },
    });
    chargeTypeIdByCode.set(input.code, created.id);
  }

  await chargeType({
    code: "IMPORT_DUTY", label: "Import duty", payee: "GOVERNMENT", basis: "PERCENT_OF_CUSTOMS_VALUE",
    sortOrder: 10, description: "Duty assessed per tariff heading against the CIF customs value.",
    rules: [
      { rate: "0.35" },
      { rate: "0.00", chapter: "84" },
      { rate: "0.20", chapter: "61" },
      { rate: "0.00", hsCode: "8517.13.00" },
      { rate: "0.60", hsCode: "2208.40.00" },
      { rate: "0.00", hsCode: "3004.90.00" },
    ],
  });
  await chargeType({
    code: "ENV_LEVY", label: "Environmental levy", payee: "GOVERNMENT", basis: "PERCENT_OF_CUSTOMS_VALUE",
    sortOrder: 20, description: "Environmental levy applied to the CIF customs value.",
    rules: [{ rate: "0.01" }],
  });
  // TODO(customs): confirm how the processing fee is applied. Seeded per entry
  // (level SHIPMENT), so the minimum and maximum bound the whole entry; as a LINE
  // charge a ten-line entry would pay the minimum ten times and have a cap of ten
  // times the maximum. Rate, minimum, maximum and level are all unverified.
  await chargeType({
    code: "CUSTOMS_PROCESSING_FEE", label: "Customs processing fee", payee: "GOVERNMENT",
    basis: "PERCENT_OF_CUSTOMS_VALUE", level: "SHIPMENT", sortOrder: 25,
    description: "Bahamas Customs entry processing fee. Per-entry application is unconfirmed.",
    rules: [{ rate: "0.01", minAmount: "15.00", maxAmount: "300.00" }],
  });
  await chargeType({
    code: "VAT", label: "VAT", payee: "GOVERNMENT", basis: "PERCENT_OF_DUTIABLE_TOTAL", sortOrder: 30,
    baseIncludes: ["IMPORT_DUTY", "ENV_LEVY"],
    description: "Value Added Tax applied to the dutiable total (CIF plus duty and levies).",
    rules: [{ rate: "0.10" }],
  });

  // Kencole's own fees. These carry no RateRule: they are not set by law, so they
  // resolve through PricingRule (BUSINESS > PLAN > GLOBAL) instead of the rate book.
  await chargeType({ code: "BROKERAGE", label: "Brokerage fee", payee: "BROKER", basis: "PERCENT_OF_CUSTOMS_VALUE", sortOrder: 100, description: "Kencole's brokerage fee for preparing and filing the entry.", rules: [] });
  await chargeType({ code: "PROCESSING", label: "Processing & handling fee", payee: "BROKER", basis: "FLAT", sortOrder: 110, description: "Kencole's internal handling and administration fee.", rules: [] });
  await chargeType({ code: "DELIVERY", label: "Local delivery", payee: "BROKER", basis: "FLAT", sortOrder: 120, description: "Local delivery from our Nassau facility to the consignee.", rules: [] });
  await chargeType({ code: "RUSH", label: "Rush processing", payee: "BROKER", basis: "FLAT", sortOrder: 130, description: "Expedited processing for time-sensitive shipments.", rules: [] });

  await prisma.pricingRule.createMany({
    data: [
      { chargeCode: "BROKERAGE", scope: "GLOBAL", percentRate: "0.025", minFee: "40.00", maxFee: "450.00", priority: 100 },
      { chargeCode: "BROKERAGE", scope: "PLAN", planCode: "BUSINESS_PRO", percentRate: "0.020", minFee: "32.00", priority: 100 },
      { chargeCode: "BROKERAGE", scope: "PLAN", planCode: "BUSINESS_STARTER", percentRate: "0.022", minFee: "36.00", priority: 100 },
      { chargeCode: "BROKERAGE", scope: "BUSINESS", businessId: businesses[0]!.id, percentRate: "0.015", minFee: "30.00", priority: 100 },
      { chargeCode: "BROKERAGE", scope: "BUSINESS", businessId: businesses[1]!.id, percentRate: "0.018", minFee: "35.00", priority: 100 },
      { chargeCode: "PROCESSING", scope: "GLOBAL", flatAmount: "15.00", perLineAmount: "2.50", priority: 100 },
      { chargeCode: "DELIVERY", scope: "GLOBAL", flatAmount: "25.00", priority: 100 },
      { chargeCode: "RUSH", scope: "GLOBAL", flatAmount: "60.00", priority: 100 },
    ],
  });

  // ── Suppliers ──
  const supplierSpecs = [
    { name: "Amazon.com", country: "US", business: null },
    { name: "Tech Direct Wholesale", country: "US", business: 0 },
    { name: "Global Marine Supply Co", country: "US", business: 0 },
    { name: "Gulf Coast Foods Inc", country: "US", business: 1 },
    { name: "Atlantic Seafood Traders", country: "US", business: 1 },
    { name: "Southern Auto Parts LLC", country: "US", business: 2 },
    { name: "Shenzhen Bright Electronics", country: "CN", business: null },
    { name: "Milano Apparel Srl", country: "IT", business: 3 },
    { name: "Caribbean Spirits Export Ltd", country: "JM", business: null },
    { name: "Peninsula Building Products", country: "US", business: 4 },
  ];
  const suppliers = [];
  for (const s of supplierSpecs) {
    suppliers.push(await prisma.supplier.create({
      data: { name: s.name, country: s.country, businessId: s.business === null ? null : businesses[s.business]!.id },
    }));
  }

  await prisma.product.createMany({
    data: [
      { businessId: businesses[0]!.id, sku: "LPT-14BIZ", description: "14-inch business laptop", hsCodeId: hsCodeIdByCode.get("8471.30.00")! },
      { businessId: businesses[0]!.id, sku: "SHELF-5T", description: "Steel shelving unit, 5-tier", hsCodeId: hsCodeIdByCode.get("9403.20.00")! },
      { businessId: businesses[1]!.id, sku: "FSH-FIL", description: "Frozen fish fillets", hsCodeId: hsCodeIdByCode.get("0303.00.00")! },
      { businessId: businesses[1]!.id, sku: "SHR-5KG", description: "Frozen shrimp, 5kg cartons", hsCodeId: hsCodeIdByCode.get("0303.00.00")! },
      { businessId: businesses[2]!.id, sku: "BRK-STD-01", description: "Vehicle brake pad set", hsCodeId: hsCodeIdByCode.get("8708.99.00")! },
      { businessId: businesses[2]!.id, sku: "ALT-ASSY", description: "Alternator assembly", hsCodeId: hsCodeIdByCode.get("8708.99.00")! },
      { businessId: businesses[3]!.id, sku: "TEE-AST", description: "Cotton t-shirts, assorted sizes", hsCodeId: hsCodeIdByCode.get("6109.10.00")! },
      { businessId: businesses[3]!.id, sku: "WRK-SHT", description: "Cotton work shirts, bulk", hsCodeId: hsCodeIdByCode.get("6109.10.00")! },
      { businessId: businesses[4]!.id, sku: "LKR-MTL", description: "Metal storage lockers", hsCodeId: hsCodeIdByCode.get("9403.20.00")! },
      { businessId: businesses[4]!.id, sku: "SHELF-HD", description: "Heavy duty shelving", hsCodeId: hsCodeIdByCode.get("9403.20.00")! },
    ],
  });

  // ── Shipments ──
  let entrySeq = 4800;
  const statusCounts = new Map<string, number>();

  // Oldest first, so references run in the same order as the shipments' dates —
  // the numbering is meant to be sequential within the year.
  const chronological = [...SHIPMENT_SPECS].sort((a, b) => b.createdDaysAgo - a.createdDaysAgo);

  for (const spec of chronological) {
    const isBusiness = spec.party.kind === "business";
    const business = isBusiness ? businesses[spec.party.index]! : null;
    const consumer = !isBusiness ? consumers[spec.party.index]! : null;
    const ownerId = business ? business.userId : consumer!.user.id;
    const billToEmail = business ? business.billingEmail : consumer!.user.email;
    const plan = business ? business.plan : consumer!.plan;
    const planCode = business ? business.planCode : consumer!.planCode;
    const importType = isBusiness ? "COMMERCIAL" : "PERSONAL";
    const createdAt = daysAgo(spec.createdDaysAgo);

    const lines = spec.items.map((it, i) => {
      const item = ITEMS[it.key];
      return {
        lineNumber: i + 1,
        description: item.description,
        quantity: it.quantity,
        unitValue: item.unitValue,
        lineValue: cents(money(it.quantity).times(money(item.unitValue))).toFixed(2),
        hsCode: item.hsCode,
      };
    });
    const goodsValue = cents(lines.reduce((acc, l) => acc.plus(money(l.lineValue)), money(0))).toFixed(2);
    const { freightCost, insuranceCost } = freightFor(spec.mode, goodsValue);

    const approved = spec.classification === "approved";
    const path = pathTo(spec.target, spec.via);
    // Anything that reaches a delivery status asked for delivery; otherwise
    // personal importers tend to ask for it and businesses to collect.
    const deliveryRequested = path.includes("READY_FOR_DELIVERY") || spec.party.kind === "consumer";
    if (path.includes("DECLARATION_PREPARED") && !approved) {
      throw new Error(`Scenario "${spec.description}" reaches a declaration without broker-approved lines.`);
    }

    // Only a broker-approved line carries an hsCodeId, which is what the rate
    // engine resolves against — so an unreviewed line is costed at the default.
    const estimateLines: LineInput[] = lines.map((l) => ({
      lineNumber: l.lineNumber, description: l.description, quantity: l.quantity,
      lineValue: l.lineValue, hsCode: approved ? l.hsCode : null,
    }));

    const result = await estimate(
      { goodsValue, freightCost, insuranceCost }, estimateLines,
      {
        businessId: business?.id ?? null, importType, planCode,
        brokerageDiscount: plan?.brokerageDiscount?.toString(),
        deliveryDiscount: plan?.deliveryDiscount?.toString(),
        deliveryRequested,
      },
    );

    const reference = await nextShipmentReference("KCB", createdAt);
    const shipment = await prisma.shipment.create({
      data: {
        reference, ownerId, businessId: business?.id ?? null, importType, freightMode: spec.mode,
        supplierId: suppliers[spec.supplier]!.id, description: spec.description,
        heldAt: HELD_AT[spec.mode], deliveryRequested,
        goodsValue, freightCost, insuranceCost,
        status: "DRAFT", estimateJson: result as unknown as Prisma.InputJsonValue, estimatedAt: createdAt,
        createdAt, updatedAt: createdAt,
        items: {
          create: lines.map((l) => {
            // The app's own keyword table, so every seeded suggestion is one the
            // classifier would really make. Lines it has no rule for get none.
            const suggestion = rankSuggestions([suggestFromKeywords(l.description, KEYWORD_RULES)])[0];
            const suggested = suggestion
              ? { suggestedHsCode: suggestion.hsCode, confidence: suggestion.confidence.toFixed(3) }
              : {};
            const base = {
              lineNumber: l.lineNumber, description: l.description, quantity: l.quantity,
              unitValue: l.unitValue, lineValue: l.lineValue,
            };
            if (spec.classification === "unclassified") return base;
            if (spec.classification === "needs_review") {
              if (!suggestion) {
                throw new Error(`Scenario "${spec.description}": "${l.description}" matches no keyword rule, so it cannot be NEEDS_REVIEW.`);
              }
              return { ...base, ...suggested, classificationStatus: "NEEDS_REVIEW" as const };
            }
            return {
              ...base,
              ...suggested,
              hsCodeId: hsCodeIdByCode.get(l.hsCode)!,
              classificationStatus: "BROKER_APPROVED" as const,
              brokerNote: REGULATED_CODES.has(l.hsCode)
                ? "Regulated line — permit sighted before approval."
                : "Classification confirmed against the commercial invoice.",
            };
          }),
        },
        history: { create: { to: "DRAFT", actorId: ownerId, note: "Shipment created", createdAt } },
      },
    });

    const hasDocuments = path.includes("DOCUMENTS_RECEIVED");
    if (hasDocuments) {
      const fileName = `${reference.toLowerCase()}-invoice.pdf`;
      const stored = await storage.put({
        body: sampleInvoicePdf({ reference, supplier: suppliers[spec.supplier]!.name, date: createdAt, lines, goodsValue }),
        contentType: "application/pdf",
        fileName,
        prefix: `shipments/${shipment.id}`,
      });
      await prisma.shipmentDocument.create({
        data: {
          shipmentId: shipment.id, kind: "COMMERCIAL_INVOICE", fileName, mimeType: "application/pdf",
          sizeBytes: stored.sizeBytes, storageKey: stored.key, checksum: stored.checksum,
          scanStatus: "CLEAN", uploadedBy: ownerId, createdAt,
        },
      });
    }

    const times = hopTimes(createdAt, path.length);
    const reachesPaid = path.includes("PAID");
    let current: ShipmentStatus = "DRAFT";
    let settled = false;
    let quote: { id: string; governmentTotal: Prisma.Decimal; brokerTotal: Prisma.Decimal } | null = null;
    let invoiceRecord: { id: string; total: string } | null = null;
    // Whoever is assigned the delivery is who the history says drove it.
    const driver = drivers[spec.createdDaysAgo % drivers.length]!;

    for (const [i, to] of path.entries()) {
      const at = times[i]!;
      // The invoice has to be settled before the PAID guard is evaluated.
      if (to === "PAID" && invoiceRecord && !settled) {
        await payInFull(invoiceRecord.id, invoiceRecord.total, at, ops.id);
        settled = true;
      }
      const actorId =
        to === "OUT_FOR_DELIVERY" || to === "DELIVERED" ? driver.userId
        : to === "DECLARATION_PREPARED" || to === "SUBMITTED_TO_CUSTOMS" || to === "QUOTE_READY" ? broker.id
        : ops.id;

      current = await hop(
        shipment.id, current, to,
        { brokerApproved: approved, invoiceSettled: settled, hasRequiredDocuments: hasDocuments },
        at, actorId, to === spec.target ? spec.note : undefined,
      );

      // Priced at QUOTE_READY, billed at AWAITING_PAYMENT — a shipment stopping
      // at QUOTE_READY has a quote and no invoice, which is the real sequence.
      if (to === "QUOTE_READY") {
        quote = await issueQuote({
          shipmentReference: reference, shipmentId: shipment.id, estimateResult: result,
          chargeTypeIdByCode, brokerApproved: approved,
          status: reachesPaid ? "ACCEPTED" : "ISSUED", quotedAt: at,
        });
      }
      if (to === "AWAITING_PAYMENT" && quote) {
        const { invoice, total } = await issueInvoice({
          shipmentReference: reference, shipmentId: shipment.id, quote, estimateResult: result,
          billToEmail, businessId: business?.id ?? null, issuedAt: at,
        });
        invoiceRecord = { id: invoice.id, total };
      }
    }

    // Mirrors transitionShipment(): cancelling voids an invoice nothing has been
    // paid against, so it stops counting as revenue or as money owed.
    if (current === "CANCELLED" && invoiceRecord && !settled) {
      await prisma.invoice.update({ where: { id: invoiceRecord.id }, data: { status: "VOIDED" } });
    }

    if (path.includes("DECLARATION_PREPARED")) {
      entrySeq += 1;
      const declStatus =
        current === "DECLARATION_PREPARED" ? "PREPARED"
        : current === "CUSTOMS_HOLD" ? "QUERIED"
        : current === "DUTIES_DUE" ? "ASSESSED"
        : ["CUSTOMS_RELEASED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"].includes(current) ? "RELEASED"
        : "SUBMITTED";
      const submittedIdx = path.indexOf("SUBMITTED_TO_CUSTOMS");
      await prisma.customsDeclaration.create({
        data: {
          shipmentId: shipment.id, status: declStatus,
          entryNumber: `C2C-${referenceYear(submittedIdx >= 0 ? times[submittedIdx]! : createdAt)}-${String(entrySeq).padStart(6, "0")}`,
          regimeCode: "IM4",
          submittedAt: submittedIdx >= 0 ? times[submittedIdx]! : null,
          submittedBy: submittedIdx >= 0 ? broker.id : null,
          assessedTotal: declStatus === "ASSESSED" || declStatus === "RELEASED" ? result.governmentTotal : null,
          releasedAt: declStatus === "RELEASED" ? times[path.indexOf("CUSTOMS_RELEASED")]! : null,
          adapter: "manual",
          payloadJson: { reference, lines: lines.length, declarant: broker.id },
        },
      });
    }

    if (path.includes("READY_FOR_DELIVERY")) {
      const readyAt = times[path.indexOf("READY_FOR_DELIVERY")]!;
      const deliveredIdx = path.indexOf("DELIVERED");
      const deliveryFee = summariseCharges(result.charges).find((ch) => ch.chargeCode === "DELIVERY")?.amount ?? "25.00";
      await prisma.delivery.create({
        data: {
          shipmentId: shipment.id,
          addressId: business ? business.addressId : consumer!.addressId,
          driverId: driver.id,
          status: current === "DELIVERED" ? "DELIVERED" : current === "OUT_FOR_DELIVERY" ? "OUT_FOR_DELIVERY" : "SCHEDULED",
          scheduledFor: readyAt, fee: deliveryFee,
          signatureName: current === "DELIVERED" ? "Received at address" : null,
          podStorageKey: current === "DELIVERED" ? `shipments/${shipment.id}/pod.jpg` : null,
          deliveredAt: current === "DELIVERED" && deliveredIdx >= 0 ? times[deliveredIdx]! : null,
        },
      });
    }

    const exceptionInput: ExceptionInput = {
      hasCommercialInvoice: hasDocuments,
      freightCost, goodsValue, freightMode: spec.mode,
      lines: lines.map((l) => ({
        lineNumber: l.lineNumber,
        hsCode: approved ? l.hsCode : null,
        lineValue: l.lineValue,
        // refreshExceptions() reads permits off the line's approved HS code, and an
        // unapproved line has none — so only an approved line can need a permit yet.
        regulated: approved && REGULATED_CODES.has(l.hsCode),
      })),
      status: current,
      statusChangedAt: times[times.length - 1] ?? createdAt,
      now: NOW,
      quotedGovernmentTotal: path.includes("QUOTE_READY") ? result.governmentTotal : null,
    };
    const flags = detectExceptions(exceptionInput);
    if (flags.length) {
      await prisma.exceptionFlag.createMany({
        data: flags.map((f) => ({
          shipmentId: shipment.id, code: f.code, severity: f.severity, message: f.message,
          // A delivered shipment's problems were dealt with on the way.
          resolvedAt: current === "DELIVERED" ? times[times.length - 1]! : null,
          resolvedBy: current === "DELIVERED" ? broker.id : null,
        })),
      });
    }

    statusCounts.set(current, (statusCounts.get(current) ?? 0) + 1);
  }

  // ── Support, CRM and procurement ──
  const heldShipment = await prisma.shipment.findFirstOrThrow({
    where: { status: "CUSTOMS_HOLD" },
    orderBy: { reference: "asc" },
  });
  const ticket = await prisma.supportTicket.create({
    data: {
      reference: `TCK-${heldShipment.reference}`, userId: heldShipment.ownerId, shipmentId: heldShipment.id,
      category: "customs", subject: "Why is my shipment on hold?", status: "WAITING_STAFF", createdAt: daysAgo(2),
    },
  });
  await prisma.supportMessage.createMany({
    data: [
      { ticketId: ticket.id, authorId: heldShipment.ownerId, body: "Customs has held this shipment for two days now — can you find out what's happening?", internal: false, createdAt: daysAgo(2) },
      { ticketId: ticket.id, authorId: ops.id, body: "Flagged for physical inspection per manifest risk score. Following up with the examining officer.", internal: true, createdAt: daysAgo(2) },
      { ticketId: ticket.id, authorId: ops.id, body: "Your shipment was selected for a routine physical inspection. We expect an update within two business days.", internal: false, createdAt: daysAgo(1) },
    ],
  });

  const leadSpecs = [
    { company: "Nassau Auto Traders", contactName: "Ryan Munroe", email: "ryan@nassauautotraders.example.com", industry: "Auto parts retail", monthlyVolume: "45000.00", currentBroker: "Self-filed", stage: "QUALIFIED" as const, ownerId: ops.id, kind: "call", summary: "Intro call — walked through the Business Pro plan and delivery bundle." },
    { company: "Cable Beach Resorts Ltd", contactName: "Yvette Deleveaux", email: "yvette@cablebeachresorts.example.com", industry: "Hospitality", monthlyVolume: "88000.00", currentBroker: "Competitor brokerage", stage: "PROPOSAL" as const, ownerId: broker2.id, kind: "email", summary: "Sent proposal covering FF&E imports and bonded storage." },
    { company: "Exuma Marine Charters", contactName: "Kirk Bethel", email: "kirk@exumamarine.example.com", industry: "Marine tourism", monthlyVolume: "16000.00", currentBroker: "Self-filed", stage: "CONTACTED" as const, ownerId: ops2.id, kind: "note", summary: "Inbound enquiry about parts imports for charter fleet." },
  ];
  for (const [i, lead] of leadSpecs.entries()) {
    const created = await prisma.lead.create({
      data: {
        company: lead.company, contactName: lead.contactName, email: lead.email, industry: lead.industry,
        monthlyVolume: lead.monthlyVolume, currentBroker: lead.currentBroker, stage: lead.stage,
        ownerId: lead.ownerId, nextFollowUp: daysAgo(-(i + 2)), createdAt: daysAgo(14 - i * 3),
      },
    });
    await prisma.crmActivity.create({
      data: { leadId: created.id, actorId: lead.ownerId, kind: lead.kind, summary: lead.summary, occurredAt: daysAgo(14 - i * 3) },
    });
  }

  const procurement = await prisma.procurementRequest.create({
    data: {
      reference: `PR-${referenceYear(daysAgo(5))}-0001`, businessId: businesses[0]!.id, requestedBy: businesses[0]!.userId,
      productUrl: "https://example-supplier.test/product/marine-cleats-8in",
      description: "Stainless steel marine cleats, 8-inch, bulk order", quantity: 200,
      specifications: "316-grade stainless steel, bulk packed", targetBudget: "3200.00",
      requiredBy: daysAgo(-21), status: "QUOTED", createdAt: daysAgo(5),
    },
  });
  const procurementLines = {
    productCost: money("2600.00"), domesticTransport: money("80.00"), internationalFreight: money("340.00"),
    insurance: money("25.00"), governmentEstimate: money("410.00"), procurementFee: money("130.00"),
    brokerageFee: money("65.00"), deliveryFee: money("25.00"),
  };
  await prisma.procurementQuote.create({
    data: {
      requestId: procurement.id,
      productCost: procurementLines.productCost.toFixed(2), domesticTransport: procurementLines.domesticTransport.toFixed(2),
      internationalFreight: procurementLines.internationalFreight.toFixed(2), insurance: procurementLines.insurance.toFixed(2),
      governmentEstimate: procurementLines.governmentEstimate.toFixed(2), procurementFee: procurementLines.procurementFee.toFixed(2),
      brokerageFee: procurementLines.brokerageFee.toFixed(2), deliveryFee: procurementLines.deliveryFee.toFixed(2),
      total: cents(Object.values(procurementLines).reduce((acc, v) => acc.plus(v), money(0))).toFixed(2),
      validUntil: daysAgo(-14), preparedBy: ops.id, createdAt: daysAgo(4),
    },
  });

  // ── Summary ──
  const [userCount, shipmentCount, invoiceCount, paymentCount, docCount, deliveryCount] = await Promise.all([
    prisma.user.count(), prisma.shipment.count(), prisma.invoice.count(),
    prisma.payment.count(), prisma.shipmentDocument.count(), prisma.delivery.count(),
  ]);

  console.log("\nSeed complete.\n");
  console.log(
    SEED_PASSWORD
      ? "Every seeded account uses the password in SEED_PASSWORD.\n"
      : `Dev login password for every seeded account: ${DEV_PASSWORD}\n`,
  );
  console.log("Staff accounts:");
  for (const u of [admin, broker, broker2, ops, ops2, driverUser, driverUser2]) {
    console.log(`  ${u.role.padEnd(14)} ${u.email}`);
  }
  console.log("\nConsumers:");
  for (const c of consumers) console.log(`  CONSUMER       ${c.user.email}`);
  console.log("\nBusinesses (owner@ / imports@ each):");
  for (const spec of businessSpecs) console.log(`  ${spec.legalName} — ${spec.domain}`);

  console.log(`\n${userCount} users, ${businesses.length} businesses, ${suppliers.length} suppliers, ${shipmentCount} shipments`);
  console.log(`${invoiceCount} invoices, ${paymentCount} payments, ${docCount} documents, ${deliveryCount} deliveries`);
  console.log("\nShipments by status:");
  for (const [status, count] of [...statusCounts.entries()].sort()) {
    console.log(`  ${status.padEnd(22)} ${count}`);
  }
  console.log("\nEvery seeded RateRule is confirmed=false — no rate here is authoritative.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
