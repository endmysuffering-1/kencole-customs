import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

// `prisma migrate dev` / `prisma db seed` load .env themselves before running this
// script, but a plain `tsx prisma/seed.ts` (npm run db:seed) does not — so load it
// here too, resolved from this file's own location rather than the caller's cwd.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { hashPassword } from "@/lib/auth/password";
import { cents, money } from "@/lib/money";
import {
  calculateLandedCost,
  summariseCharges,
  type ChargeLine,
  type LandedCostResult,
  type LineInput,
} from "@/lib/domain/landed-cost";
import { calculateBrokerCharges } from "@/lib/domain/pricing";
import { rankSuggestions, suggestFromKeywords, type KeywordRule } from "@/lib/domain/classification";
import { canTransition, type ShipmentStatus, type TransitionGuardContext } from "@/lib/domain/shipment-state";
import { detectExceptions, type ExceptionInput } from "@/lib/domain/exceptions";
import { loadPricingRules, loadRateBook } from "@/lib/services/rate-book";

const prisma = new PrismaClient();

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

const DEV_PASSWORD = "KencoleDev#2026";

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

interface HsCodeSeed {
  code: string;
  description: string;
  keywords: string[];
  alwaysReview?: boolean;
  regulated?: { agency: string; permit: string };
}

const HS_CODES: HsCodeSeed[] = [
  {
    code: "8471.30.00",
    description: "Portable automatic data processing machines (laptops)",
    keywords: ["laptop", "notebook computer", "macbook"],
  },
  {
    code: "8517.13.00",
    description: "Smartphones",
    keywords: ["smartphone", "iphone", "mobile phone", "android phone"],
  },
  {
    code: "6109.10.00",
    description: "T-shirts, singlets, cotton, knitted",
    keywords: ["t-shirt", "tee shirt", "cotton shirt"],
  },
  {
    code: "9403.20.00",
    description: "Other metal furniture",
    keywords: ["shelving", "metal rack", "office furniture"],
  },
  {
    code: "8708.99.00",
    description: "Other parts and accessories of motor vehicles",
    keywords: ["brake pad", "car part", "vehicle part", "alternator"],
  },
  {
    code: "2208.40.00",
    description: "Rum and other spirits obtained by distilling fermented sugar-cane products",
    keywords: ["rum", "spirits"],
    alwaysReview: true,
    regulated: { agency: "Bahamas Customs & Excise", permit: "Liquor import permit" },
  },
  {
    code: "3004.90.00",
    description: "Medicaments, packaged for retail sale",
    keywords: ["medicine", "pharmaceutical", "prescription"],
    alwaysReview: true,
    regulated: { agency: "Ministry of Health & Wellness", permit: "Pharmaceutical import permit" },
  },
  {
    code: "0303.00.00",
    description: "Fish, frozen",
    keywords: ["frozen fish", "seafood"],
    alwaysReview: true,
    regulated: { agency: "Department of Marine Resources", permit: "Fisheries import permit" },
  },
];

const REGULATED_CODES = new Set(HS_CODES.filter((h) => h.regulated).map((h) => h.code));

function chapterOf(code: string): string {
  return code.slice(0, 2);
}

/** Mirrors estimateShipment(): load the live rate book + pricing rules and run the
 *  real domain engine, so every seeded number is produced by the same code the app
 *  would run, not hand-typed. */
async function estimate(
  totals: { goodsValue: string; freightCost: string; insuranceCost: string; grossWeightKg?: string | null },
  lines: LineInput[],
  ctx: {
    businessId: string | null;
    importType: "PERSONAL" | "COMMERCIAL";
    planCode?: string | null;
    brokerageDiscount?: string;
    deliveryDiscount?: string;
  },
): Promise<LandedCostResult> {
  const [rateBook, pricingRules] = await Promise.all([
    loadRateBook(),
    loadPricingRules(ctx.businessId),
  ]);
  const customsValue = cents(
    money(totals.goodsValue).plus(money(totals.freightCost)).plus(money(totals.insuranceCost)),
  );
  const brokerCharges = calculateBrokerCharges(pricingRules, {
    customsValue: customsValue.toString(),
    lineCount: Math.max(lines.length, 1),
    importType: ctx.importType,
    businessId: ctx.businessId,
    planCode: ctx.planCode ?? null,
    brokerageDiscount: ctx.brokerageDiscount ?? 0,
    deliveryDiscount: ctx.deliveryDiscount ?? 0,
    deliveryRequested: true,
  });
  return calculateLandedCost(
    {
      goodsValue: totals.goodsValue,
      freightCost: totals.freightCost,
      insuranceCost: totals.insuranceCost,
      grossWeightKg: totals.grossWeightKg ?? null,
      lines,
    },
    rateBook,
    brokerCharges,
  );
}

/** Validates each hop against the real state machine before writing it, so a
 *  mistake in this script's narrative fails loudly instead of seeding a shipment
 *  the app itself would never have allowed to reach that status. */
async function walk(
  shipmentId: string,
  from: ShipmentStatus,
  hops: { to: ShipmentStatus; ctx: TransitionGuardContext; at: Date; actorId: string; note?: string }[],
): Promise<ShipmentStatus> {
  let current = from;
  for (const hop of hops) {
    const verdict = canTransition(current, hop.to, hop.ctx);
    if (!verdict.ok) {
      throw new Error(`Seed data takes an illegal transition ${current} -> ${hop.to}: ${verdict.reason}`);
    }
    await prisma.shipmentStatusHistory.create({
      data: { shipmentId, from: current, to: hop.to, actorId: hop.actorId, note: hop.note, createdAt: hop.at },
    });
    current = hop.to;
  }
  await prisma.shipment.update({ where: { id: shipmentId }, data: { status: current } });
  return current;
}

/** Mirrors issueQuote() + issueInvoiceForQuote(): summarise the computed charges,
 *  persist a Quote with its CustomsCharge rows, then an Invoice with InvoiceLines. */
async function issueQuoteAndInvoice(input: {
  shipmentReference: string;
  shipmentId: string;
  estimateResult: LandedCostResult;
  chargeTypeIdByCode: Map<string, string>;
  brokerApproved: boolean;
  quoteStatus: "ISSUED" | "ACCEPTED";
  quotedAt: Date;
  billToEmail: string;
  businessId: string | null;
  invoiceStatus: "ISSUED" | "PAID";
  issuedAt: Date;
}) {
  const summary = summariseCharges(input.estimateResult.charges);

  const quote = await prisma.quote.create({
    data: {
      reference: `Q-${input.shipmentReference}-1`,
      shipmentId: input.shipmentId,
      status: input.quoteStatus,
      customsValue: input.estimateResult.customsValue,
      governmentTotal: input.estimateResult.governmentTotal,
      brokerTotal: input.estimateResult.brokerTotal,
      grandTotal: input.estimateResult.grandTotal,
      brokerApproved: input.brokerApproved,
      expiresAt: new Date(input.quotedAt.getTime() + 1000 * 60 * 60 * 24 * 14),
      createdAt: input.quotedAt,
      charges: {
        create: summary.map((c: ChargeLine) => ({
          chargeTypeId: input.chargeTypeIdByCode.get(c.chargeCode)!,
          payee: c.payee,
          basisAmount: c.basisAmount,
          rateApplied: c.rateApplied,
          amount: c.amount,
          rateRuleId: c.rateRuleId ?? null,
        })),
      },
    },
  });

  const total = cents(money(quote.governmentTotal).plus(money(quote.brokerTotal))).toFixed(2);
  const invoice = await prisma.invoice.create({
    data: {
      reference: `INV-${input.shipmentReference}-1`,
      shipmentId: input.shipmentId,
      quoteId: quote.id,
      businessId: input.businessId,
      billToEmail: input.billToEmail,
      status: input.invoiceStatus,
      governmentTotal: quote.governmentTotal,
      brokerTotal: quote.brokerTotal,
      total,
      issuedAt: input.issuedAt,
      dueAt: new Date(input.issuedAt.getTime() + 1000 * 60 * 60 * 24 * 7),
      lines: {
        create: summary.map((c: ChargeLine, index: number) => ({
          description: c.label,
          payee: c.payee,
          amount: c.amount,
          chargeCode: c.chargeCode,
          sortOrder: index,
        })),
      },
    },
  });

  return { quote, invoice, total };
}

/** Mirrors recordPayment(): one successful payment that settles the invoice in full. */
async function payInFull(invoiceId: string, total: string, receivedAt: Date, recordedBy: string) {
  await prisma.$transaction([
    prisma.payment.create({
      data: {
        invoiceId,
        provider: "bank_transfer",
        providerRef: `BT-${Math.floor(Math.random() * 900000 + 100000)}`,
        amount: total,
        status: "SUCCEEDED",
        receivedAt,
        recordedBy,
      },
    }),
    prisma.invoice.update({ where: { id: invoiceId }, data: { amountPaid: total, status: "PAID" } }),
  ]);
}

async function main() {
  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log(`Database already has ${existing} user(s) — skipping seed.`);
    console.log("Run `npm run db:reset` to wipe the database and reseed from scratch.");
    return;
  }

  // ─────────────────────────────── Identity ───────────────────────────────────
  const passwordHash = await hashPassword(DEV_PASSWORD);

  function seedUser(input: { email: string; fullName: string; role: "SUPER_ADMIN" | "CUSTOMS_BROKER" | "OPERATIONS" | "DRIVER" | "BUSINESS_ADMIN" | "BUSINESS_USER" | "CONSUMER"; phone: string }) {
    return prisma.user.create({ data: { ...input, passwordHash, emailVerified: new Date() } });
  }

  const [admin, broker, ops, driverUser, bizAdmin, bizUser, consumer1, consumer2] = await Promise.all([
    seedUser({ email: "admin@kencole.bs", fullName: "Andrea Bethel", role: "SUPER_ADMIN", phone: "+1 242 555 0100" }),
    seedUser({ email: "broker@kencole.bs", fullName: "Nicole Farrington", role: "CUSTOMS_BROKER", phone: "+1 242 555 0101" }),
    seedUser({ email: "ops@kencole.bs", fullName: "Trevor Adderley", role: "OPERATIONS", phone: "+1 242 555 0102" }),
    seedUser({ email: "driver@kencole.bs", fullName: "Shane Ferguson", role: "DRIVER", phone: "+1 242 555 0103" }),
    seedUser({ email: "owner@islandhardwaremarine.bs", fullName: "Deborah Knowles", role: "BUSINESS_ADMIN", phone: "+1 242 555 0142" }),
    seedUser({ email: "imports@islandhardwaremarine.bs", fullName: "Patrice Rolle", role: "BUSINESS_USER", phone: "+1 242 555 0143" }),
    seedUser({ email: "marcus.deveaux@example.com", fullName: "Marcus Deveaux", role: "CONSUMER", phone: "+1 242 555 0118" }),
    seedUser({ email: "simone.pinder@example.com", fullName: "Simone Pinder", role: "CONSUMER", phone: "+1 242 555 0177" }),
  ]);

  const driver = await prisma.driver.create({
    data: { userId: driverUser.id, vehicle: "Nissan NV200 van — plate KC-4471" },
  });

  // ─────────────────────────────── Plans & business ────────────────────────────
  const [consumerPlus, businessStarter, businessPro] = await Promise.all([
    prisma.plan.create({
      data: {
        code: "CONSUMER_PLUS", name: "Consumer Plus", audience: "B2C",
        monthlyPrice: "9.99", currency: "BSD",
        features: ["Priority document review", "10% off brokerage fees", "Email + SMS tracking updates"],
        brokerageDiscount: "0.10", deliveryDiscount: "0", sortOrder: 10,
      },
    }),
    prisma.plan.create({
      data: {
        code: "BUSINESS_STARTER", name: "Business Starter", audience: "B2B",
        monthlyPrice: "49.00", currency: "BSD",
        features: ["Dedicated account manager", "5% off brokerage fees"],
        brokerageDiscount: "0.05", deliveryDiscount: "0", sortOrder: 20,
      },
    }),
    prisma.plan.create({
      data: {
        code: "BUSINESS_PRO", name: "Business Pro", audience: "B2B",
        monthlyPrice: "199.00", currency: "BSD",
        features: [
          "Dedicated account manager", "15% off brokerage fees", "10% off delivery",
          "Priority customs queue",
        ],
        brokerageDiscount: "0.15", deliveryDiscount: "0.10", sortOrder: 30,
      },
    }),
  ]);

  const [consumerSub, businessSub] = await Promise.all([
    prisma.subscription.create({ data: { planId: consumerPlus.id, startedAt: daysAgo(220) } }),
    prisma.subscription.create({ data: { planId: businessPro.id, startedAt: daysAgo(540) } }),
  ]);

  const business = await prisma.business.create({
    data: {
      legalName: "Island Hardware & Marine Ltd",
      tradingName: "Island Hardware & Marine",
      tin: "TIN-2041-0088",
      importerNumber: "IMP-BS-77321",
      industry: "Marine & hardware retail",
      billingEmail: "billing@islandhardwaremarine.bs",
      accountManagerId: ops.id,
      subscriptionId: businessSub.id,
    },
  });

  await prisma.businessMember.createMany({
    data: [
      { businessId: business.id, userId: bizAdmin.id, isAdmin: true },
      { businessId: business.id, userId: bizUser.id, isAdmin: false },
    ],
  });

  const [warehouseAddress, marcusAddress, simoneAddress] = await Promise.all([
    prisma.address.create({
      data: {
        label: "Warehouse", line1: "14 Marina Drive", settlement: "Nassau", island: "New Providence",
        contact: "Deborah Knowles", phone: "+1 242 555 0142", businessId: business.id,
      },
    }),
    prisma.address.create({
      data: {
        label: "Home", line1: "22 Coral Vista Way", settlement: "Nassau", island: "New Providence",
        contact: "Marcus Deveaux", phone: "+1 242 555 0118",
      },
    }),
    prisma.address.create({
      data: {
        label: "Home", line1: "8 Pineridge Close", settlement: "Freeport", island: "Grand Bahama",
        contact: "Simone Pinder", phone: "+1 242 555 0177",
      },
    }),
  ]);

  await Promise.all([
    prisma.consumerProfile.create({
      data: { userId: consumer1.id, nib: "NIB-035-556-812", addressId: marcusAddress.id, membershipId: consumerSub.id },
    }),
    prisma.consumerProfile.create({
      data: { userId: consumer2.id, addressId: simoneAddress.id },
    }),
  ]);

  // ─────────────────────────────── Trade reference data ────────────────────────
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
      agency: h.regulated!.agency,
      permit: h.regulated!.permit,
      notes: PERMIT_PENDING_NOTE,
    })),
  });

  const chargeTypeIdByCode = new Map<string, string>();
  async function chargeType(input: {
    code: string; label: string; payee: "GOVERNMENT" | "BROKER";
    basis: "PERCENT_OF_CUSTOMS_VALUE" | "PERCENT_OF_DUTIABLE_TOTAL" | "PERCENT_OF_GOODS_VALUE" | "FLAT" | "PER_LINE" | "PER_UNIT_WEIGHT";
    sortOrder: number; baseIncludes?: string[]; description: string;
    rules: { rate: string; hsCode?: string; chapter?: string; minAmount?: string; maxAmount?: string }[];
  }) {
    const created = await prisma.chargeType.create({
      data: {
        code: input.code, label: input.label, payee: input.payee, basis: input.basis,
        sortOrder: input.sortOrder, baseIncludes: input.baseIncludes ?? [], description: input.description,
        rateRules: {
          create: input.rules.map((r) => ({
            rate: r.rate,
            hsCodeId: r.hsCode ? hsCodeIdByCode.get(r.hsCode)! : null,
            chapter: r.chapter ?? null,
            minAmount: r.minAmount ?? null,
            maxAmount: r.maxAmount ?? null,
            effectiveFrom: new Date("2020-01-01"),
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
  await chargeType({
    code: "CUSTOMS_PROCESSING_FEE", label: "Customs processing fee", payee: "GOVERNMENT",
    basis: "PERCENT_OF_CUSTOMS_VALUE", sortOrder: 25, description: "Bahamas Customs entry processing fee.",
    rules: [{ rate: "0.01", minAmount: "15.00", maxAmount: "300.00" }],
  });
  await chargeType({
    code: "VAT", label: "VAT", payee: "GOVERNMENT", basis: "PERCENT_OF_DUTIABLE_TOTAL", sortOrder: 30,
    baseIncludes: ["IMPORT_DUTY", "ENV_LEVY"],
    description: "Value Added Tax applied to the dutiable total (CIF plus duty and levies).",
    rules: [{ rate: "0.10" }],
  });
  await chargeType({
    code: "BROKERAGE", label: "Brokerage fee", payee: "BROKER", basis: "PERCENT_OF_CUSTOMS_VALUE",
    sortOrder: 100, description: "Kencole's brokerage fee for preparing and filing the entry.", rules: [],
  });
  await chargeType({
    code: "PROCESSING", label: "Processing & handling fee", payee: "BROKER", basis: "FLAT",
    sortOrder: 110, description: "Kencole's internal handling and administration fee.", rules: [],
  });
  await chargeType({
    code: "DELIVERY", label: "Local delivery", payee: "BROKER", basis: "FLAT",
    sortOrder: 120, description: "Local delivery from our Nassau facility to the consignee.", rules: [],
  });
  await chargeType({
    code: "RUSH", label: "Rush processing", payee: "BROKER", basis: "FLAT",
    sortOrder: 130, description: "Expedited processing for time-sensitive shipments.", rules: [],
  });

  await prisma.pricingRule.createMany({
    data: [
      { chargeCode: "BROKERAGE", scope: "GLOBAL", percentRate: "0.025", minFee: "40.00", maxFee: "450.00", priority: 100 },
      { chargeCode: "BROKERAGE", scope: "BUSINESS", businessId: business.id, percentRate: "0.015", minFee: "30.00", priority: 100 },
      { chargeCode: "BROKERAGE", scope: "PLAN", planCode: "BUSINESS_PRO", percentRate: "0.018", minFee: "32.00", priority: 100 },
      { chargeCode: "PROCESSING", scope: "GLOBAL", flatAmount: "15.00", perLineAmount: "2.50", priority: 100 },
      { chargeCode: "DELIVERY", scope: "GLOBAL", flatAmount: "25.00", priority: 100 },
      { chargeCode: "RUSH", scope: "GLOBAL", flatAmount: "60.00", priority: 100 },
    ],
  });

  const [globalMarine, amazon, techDirect] = await Promise.all([
    prisma.supplier.create({ data: { name: "Global Marine Supply Co", country: "US", businessId: business.id } }),
    prisma.supplier.create({ data: { name: "Amazon.com", country: "US" } }),
    prisma.supplier.create({ data: { name: "Tech Direct Wholesale", country: "US", businessId: business.id } }),
  ]);

  await prisma.product.createMany({
    data: [
      { businessId: business.id, sku: "LPT-14BIZ", description: "14-inch business laptop (dispatch office standard issue)", hsCodeId: hsCodeIdByCode.get("8471.30.00")! },
      { businessId: business.id, sku: "BRK-STD-01", description: "Standard import vehicle brake pad set", hsCodeId: hsCodeIdByCode.get("8708.99.00")! },
    ],
  });

  // ─────────────────────────────── Shipments ───────────────────────────────────
  let shipmentSeq = 0;
  const nextReference = () => `KCB-2026-${String(++shipmentSeq).padStart(6, "0")}`;

  // Shipment A — a consumer's shipment moments after starting, nothing done yet.
  {
    const items: { description: string; quantity: string; unitValue: string }[] = [
      { description: "Bluetooth over-ear headphones", quantity: "1", unitValue: "85.00" },
    ];
    const goodsValue = items[0]!.unitValue;
    const lines: LineInput[] = items.map((it, i) => ({
      lineNumber: i + 1, description: it.description, quantity: it.quantity,
      lineValue: cents(money(it.quantity).times(money(it.unitValue))).toFixed(2), hsCode: null,
    }));
    const result = await estimate(
      { goodsValue, freightCost: "0", insuranceCost: "0" }, lines,
      { businessId: null, importType: "PERSONAL" },
    );

    const reference = nextReference();
    const shipment = await prisma.shipment.create({
      data: {
        reference, ownerId: consumer2.id, importType: "PERSONAL", freightMode: "AIR",
        supplierId: amazon.id, description: "Headphones, personal use",
        goodsValue, freightCost: "0", insuranceCost: "0",
        status: "DRAFT", estimateJson: result as never, estimatedAt: hoursAgo(3),
        createdAt: hoursAgo(3), updatedAt: hoursAgo(3),
        items: { create: items.map((it, i) => ({
          lineNumber: i + 1, description: it.description, quantity: it.quantity, unitValue: it.unitValue,
          lineValue: cents(money(it.quantity).times(money(it.unitValue))).toFixed(2),
        })) },
        history: { create: { to: "DRAFT", actorId: consumer2.id, note: "Shipment created", createdAt: hoursAgo(3) } },
      },
      include: { items: true },
    });

    const exceptionInput: ExceptionInput = {
      hasCommercialInvoice: false, freightCost: "0", goodsValue, freightMode: "AIR",
      lines: shipment.items.map((i) => ({ lineNumber: i.lineNumber, hsCode: null, lineValue: i.lineValue.toString() })),
      status: "DRAFT", statusChangedAt: hoursAgo(3), now: NOW,
    };
    const flags = detectExceptions(exceptionInput);
    await prisma.exceptionFlag.createMany({
      data: flags.map((f) => ({ shipmentId: shipment.id, code: f.code, severity: f.severity, message: f.message })),
    });

    await prisma.auditLog.create({
      data: { actorId: consumer2.id, action: "shipment.created", entityType: "Shipment", entityId: shipment.id, newValue: { reference, goodsValue } as never },
    });
  }

  // Shipment B — Island Hardware's recurring commercial order, quoted, awaiting payment.
  {
    const items = [
      { description: "14-inch business laptop, dispatch office", quantity: "3", unitValue: "900.00", hsCode: "8471.30.00" },
      { description: "Assorted vehicle brake pad sets", quantity: "20", unitValue: "35.00", hsCode: "8708.99.00" },
    ];
    const lines: LineInput[] = items.map((it, i) => ({
      lineNumber: i + 1, description: it.description, quantity: it.quantity,
      lineValue: cents(money(it.quantity).times(money(it.unitValue))).toFixed(2), hsCode: it.hsCode,
    }));
    const goodsValue = cents(lines.reduce((acc, l) => acc.plus(money(l.lineValue)), money(0))).toFixed(2);
    const freightCost = "220.00";
    const insuranceCost = "15.00";

    const result = await estimate(
      { goodsValue, freightCost, insuranceCost, grossWeightKg: "42.500" }, lines,
      { businessId: business.id, importType: "COMMERCIAL", planCode: "BUSINESS_PRO", brokerageDiscount: businessPro.brokerageDiscount.toString(), deliveryDiscount: businessPro.deliveryDiscount.toString() },
    );

    const reference = nextReference();
    const shipment = await prisma.shipment.create({
      data: {
        reference, ownerId: bizUser.id, businessId: business.id, importType: "COMMERCIAL", freightMode: "SEA",
        supplierId: techDirect.id, description: "Recurring dispatch-office hardware order",
        goodsValue, freightCost, insuranceCost, grossWeightKg: "42.500",
        status: "DRAFT", estimateJson: result as never, estimatedAt: daysAgo(4),
        createdAt: daysAgo(6), updatedAt: daysAgo(4),
        items: { create: items.map((it, i) => ({
          lineNumber: i + 1, description: it.description, quantity: it.quantity, unitValue: it.unitValue,
          lineValue: cents(money(it.quantity).times(money(it.unitValue))).toFixed(2),
          hsCodeId: hsCodeIdByCode.get(it.hsCode)!, suggestedHsCode: it.hsCode, confidence: "1.000",
          classificationStatus: "BROKER_APPROVED", brokerNote: "Recurring SKU, matches prior approved entries.",
        })) },
        history: { create: { to: "DRAFT", actorId: bizUser.id, note: "Shipment created", createdAt: daysAgo(6) } },
      },
      include: { items: true },
    });

    await prisma.shipmentDocument.create({
      data: {
        shipmentId: shipment.id, kind: "COMMERCIAL_INVOICE", fileName: "tech-direct-invoice-8842.pdf",
        mimeType: "application/pdf", sizeBytes: 184_233, storageKey: `shipments/${shipment.id}/commercial-invoice.pdf`,
        scanStatus: "CLEAN", uploadedBy: bizUser.id, createdAt: daysAgo(6),
      },
    });

    const ctx: TransitionGuardContext = { brokerApproved: true, invoiceSettled: false, hasRequiredDocuments: true };
    await walk(shipment.id, "DRAFT", [
      { to: "DOCUMENTS_RECEIVED", ctx, at: daysAgo(6), actorId: bizUser.id, note: "Commercial invoice uploaded" },
      { to: "UNDER_REVIEW", ctx, at: daysAgo(5), actorId: ops.id },
      { to: "CLASSIFICATION_REVIEW", ctx, at: daysAgo(5), actorId: ops.id },
      { to: "QUOTE_READY", ctx, at: daysAgo(4), actorId: broker.id, note: "Both lines already broker-approved from history" },
    ]);

    const { invoice, total } = await issueQuoteAndInvoice({
      shipmentReference: reference, shipmentId: shipment.id, estimateResult: result, chargeTypeIdByCode,
      brokerApproved: true, quoteStatus: "ISSUED", quotedAt: daysAgo(4),
      billToEmail: business.billingEmail!, businessId: business.id,
      invoiceStatus: "ISSUED", issuedAt: daysAgo(4),
    });
    void total;

    await walk(shipment.id, "QUOTE_READY", [
      { to: "AWAITING_PAYMENT", ctx, at: daysAgo(4), actorId: bizAdmin.id },
    ]);

    const exceptionInput: ExceptionInput = {
      hasCommercialInvoice: true, freightCost, goodsValue, freightMode: "SEA",
      lines: shipment.items.map((i) => ({
        lineNumber: i.lineNumber, hsCode: items[i.lineNumber - 1]!.hsCode, lineValue: i.lineValue.toString(),
        regulated: REGULATED_CODES.has(items[i.lineNumber - 1]!.hsCode),
      })),
      status: "AWAITING_PAYMENT", statusChangedAt: daysAgo(4), now: NOW,
      quotedGovernmentTotal: result.governmentTotal,
    };
    const flags = detectExceptions(exceptionInput);
    if (flags.length) {
      await prisma.exceptionFlag.createMany({
        data: flags.map((f) => ({ shipmentId: shipment.id, code: f.code, severity: f.severity, message: f.message })),
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: broker.id, action: "quote.issued", entityType: "Invoice", entityId: invoice.id,
        newValue: { reference: invoice.reference, governmentTotal: result.governmentTotal, brokerTotal: result.brokerTotal } as never,
      },
    });
  }

  // Shipment C — a consumer's regulated shipment, all the way through to delivery.
  {
    const description = "Rum, 750ml, 6 bottles";
    const suggestion = rankSuggestions([
      suggestFromKeywords(description, HS_CODES.map((h): KeywordRule => ({ hsCode: h.code, description: h.description, keywords: h.keywords, alwaysReview: h.alwaysReview }))),
    ])[0];

    const quantity = "6";
    const unitValue = "28.00";
    const lineValue = cents(money(quantity).times(money(unitValue))).toFixed(2);
    const lines: LineInput[] = [{ lineNumber: 1, description, quantity, lineValue, hsCode: "2208.40.00" }];
    const goodsValue = lineValue;
    const freightCost = "35.00";
    const insuranceCost = "0";

    const result = await estimate(
      { goodsValue, freightCost, insuranceCost, grossWeightKg: "3.200" }, lines,
      { businessId: null, importType: "PERSONAL", planCode: "CONSUMER_PLUS", brokerageDiscount: consumerPlus.brokerageDiscount.toString(), deliveryDiscount: consumerPlus.deliveryDiscount.toString() },
    );

    const reference = nextReference();
    const shipment = await prisma.shipment.create({
      data: {
        reference, ownerId: consumer1.id, importType: "PERSONAL", freightMode: "COURIER",
        supplierId: amazon.id, description,
        goodsValue, freightCost, insuranceCost, grossWeightKg: "3.200",
        status: "DRAFT", estimateJson: result as never, estimatedAt: daysAgo(9),
        createdAt: daysAgo(10), updatedAt: daysAgo(9),
        items: { create: [{
          lineNumber: 1, description, quantity, unitValue, lineValue,
          hsCodeId: hsCodeIdByCode.get("2208.40.00")!,
          suggestedHsCode: suggestion?.hsCode ?? "2208.40.00", confidence: (suggestion?.confidence ?? 0.57).toFixed(3),
          classificationStatus: "BROKER_APPROVED",
          brokerNote: "Regulated line, always reviewed. Liquor import permit sighted before approval.",
        }] },
        history: { create: { to: "DRAFT", actorId: consumer1.id, note: "Shipment created", createdAt: daysAgo(10) } },
      },
      include: { items: true },
    });

    await prisma.shipmentDocument.create({
      data: {
        shipmentId: shipment.id, kind: "COMMERCIAL_INVOICE", fileName: "amazon-order-invoice.pdf",
        mimeType: "application/pdf", sizeBytes: 92_411, storageKey: `shipments/${shipment.id}/commercial-invoice.pdf`,
        scanStatus: "CLEAN", uploadedBy: consumer1.id, createdAt: daysAgo(10),
      },
    });

    const ctxApproved: TransitionGuardContext = { brokerApproved: true, invoiceSettled: false, hasRequiredDocuments: true };
    await walk(shipment.id, "DRAFT", [
      { to: "DOCUMENTS_RECEIVED", ctx: ctxApproved, at: daysAgo(10), actorId: consumer1.id },
      { to: "UNDER_REVIEW", ctx: ctxApproved, at: daysAgo(9), actorId: ops.id },
      { to: "CLASSIFICATION_REVIEW", ctx: ctxApproved, at: daysAgo(9), actorId: broker.id, note: "Regulated line — broker review required" },
      { to: "QUOTE_READY", ctx: ctxApproved, at: daysAgo(8), actorId: broker.id },
    ]);

    const { invoice, total } = await issueQuoteAndInvoice({
      shipmentReference: reference, shipmentId: shipment.id, estimateResult: result, chargeTypeIdByCode,
      brokerApproved: true, quoteStatus: "ACCEPTED", quotedAt: daysAgo(8),
      billToEmail: consumer1.email, businessId: null,
      invoiceStatus: "ISSUED", issuedAt: daysAgo(8),
    });

    await walk(shipment.id, "QUOTE_READY", [{ to: "AWAITING_PAYMENT", ctx: ctxApproved, at: daysAgo(8), actorId: consumer1.id }]);
    await payInFull(invoice.id, total, daysAgo(7), ops.id);

    const ctxPaid: TransitionGuardContext = { brokerApproved: true, invoiceSettled: true, hasRequiredDocuments: true };
    await walk(shipment.id, "AWAITING_PAYMENT", [
      { to: "PAID", ctx: ctxPaid, at: daysAgo(7), actorId: ops.id },
      { to: "ARRIVED_BAHAMAS", ctx: ctxPaid, at: daysAgo(5), actorId: ops.id, note: "Courier manifest confirms arrival" },
      { to: "DECLARATION_PREPARED", ctx: ctxPaid, at: daysAgo(4), actorId: broker.id },
      { to: "SUBMITTED_TO_CUSTOMS", ctx: ctxPaid, at: daysAgo(4), actorId: broker.id },
      { to: "CUSTOMS_REVIEW", ctx: ctxPaid, at: daysAgo(4), actorId: broker.id },
      { to: "CUSTOMS_RELEASED", ctx: ctxPaid, at: daysAgo(3), actorId: broker.id },
      { to: "READY_FOR_DELIVERY", ctx: ctxPaid, at: daysAgo(2), actorId: ops.id },
      { to: "OUT_FOR_DELIVERY", ctx: ctxPaid, at: daysAgo(1), actorId: driverUser.id },
      { to: "DELIVERED", ctx: ctxPaid, at: hoursAgo(20), actorId: driverUser.id },
    ]);

    await prisma.customsDeclaration.create({
      data: {
        shipmentId: shipment.id, status: "RELEASED", entryNumber: "C2C-2026-004821", regimeCode: "IM4",
        submittedAt: daysAgo(4), submittedBy: broker.id, assessedTotal: result.governmentTotal,
        releasedAt: daysAgo(3), adapter: "manual",
        payloadJson: { reference, lines: 1, declarant: broker.id } as never,
      },
    });

    const deliveryFee = summariseCharges(result.charges).find((c) => c.chargeCode === "DELIVERY")?.amount ?? "25.00";
    await prisma.delivery.create({
      data: {
        shipmentId: shipment.id, addressId: marcusAddress.id, driverId: driver.id, status: "DELIVERED",
        scheduledFor: daysAgo(2), fee: deliveryFee, signatureName: "M. Deveaux",
        podStorageKey: `shipments/${shipment.id}/pod.jpg`, deliveredAt: hoursAgo(20),
      },
    });

    const exceptionInput: ExceptionInput = {
      hasCommercialInvoice: true, freightCost, goodsValue, freightMode: "COURIER",
      lines: [{ lineNumber: 1, hsCode: "2208.40.00", lineValue: goodsValue, regulated: true }],
      status: "DELIVERED", statusChangedAt: hoursAgo(20), now: NOW,
      quotedGovernmentTotal: result.governmentTotal, assessedGovernmentTotal: result.governmentTotal,
    };
    const flags = detectExceptions(exceptionInput);
    await prisma.exceptionFlag.createMany({
      data: flags.map((f) => ({
        shipmentId: shipment.id, code: f.code, severity: f.severity, message: f.message,
        resolvedAt: f.code === "PERMIT_REQUIRED" ? daysAgo(4) : null,
        resolvedBy: f.code === "PERMIT_REQUIRED" ? broker.id : null,
      })),
    });
  }

  // Shipment D — Island Hardware's shipment, currently held by customs for inspection.
  {
    const description = "Frozen fish fillets, assorted, 200kg";
    const quantity = "200";
    const unitValue = "6.50";
    const lineValue = cents(money(quantity).times(money(unitValue))).toFixed(2);
    const lines: LineInput[] = [{ lineNumber: 1, description, quantity, lineValue, hsCode: "0303.00.00" }];
    const goodsValue = lineValue;
    const freightCost = "640.00";
    const insuranceCost = "25.00";

    const result = await estimate(
      { goodsValue, freightCost, insuranceCost, grossWeightKg: "205.000" }, lines,
      { businessId: business.id, importType: "COMMERCIAL", planCode: "BUSINESS_PRO", brokerageDiscount: businessPro.brokerageDiscount.toString(), deliveryDiscount: businessPro.deliveryDiscount.toString() },
    );

    const reference = nextReference();
    const shipment = await prisma.shipment.create({
      data: {
        reference, ownerId: bizUser.id, businessId: business.id, importType: "COMMERCIAL", freightMode: "SEA",
        supplierId: globalMarine.id, description,
        goodsValue, freightCost, insuranceCost, grossWeightKg: "205.000",
        status: "DRAFT", estimateJson: result as never, estimatedAt: daysAgo(6),
        createdAt: daysAgo(7), updatedAt: daysAgo(6),
        items: { create: [{
          lineNumber: 1, description, quantity, unitValue, lineValue,
          hsCodeId: hsCodeIdByCode.get("0303.00.00")!, suggestedHsCode: "0303.00.00", confidence: "0.570",
          classificationStatus: "BROKER_APPROVED", brokerNote: "Fisheries permit on file for this supplier.",
        }] },
        history: { create: { to: "DRAFT", actorId: bizUser.id, note: "Shipment created", createdAt: daysAgo(7) } },
      },
      include: { items: true },
    });

    await prisma.shipmentDocument.create({
      data: {
        shipmentId: shipment.id, kind: "COMMERCIAL_INVOICE", fileName: "global-marine-invoice-2216.pdf",
        mimeType: "application/pdf", sizeBytes: 143_009, storageKey: `shipments/${shipment.id}/commercial-invoice.pdf`,
        scanStatus: "CLEAN", uploadedBy: bizUser.id, createdAt: daysAgo(7),
      },
    });

    const ctxApproved: TransitionGuardContext = { brokerApproved: true, invoiceSettled: false, hasRequiredDocuments: true };
    await walk(shipment.id, "DRAFT", [
      { to: "DOCUMENTS_RECEIVED", ctx: ctxApproved, at: daysAgo(7), actorId: bizUser.id },
      { to: "UNDER_REVIEW", ctx: ctxApproved, at: daysAgo(6), actorId: ops.id },
      { to: "CLASSIFICATION_REVIEW", ctx: ctxApproved, at: daysAgo(6), actorId: broker.id },
      { to: "QUOTE_READY", ctx: ctxApproved, at: daysAgo(5), actorId: broker.id },
    ]);

    const { invoice, total } = await issueQuoteAndInvoice({
      shipmentReference: reference, shipmentId: shipment.id, estimateResult: result, chargeTypeIdByCode,
      brokerApproved: true, quoteStatus: "ACCEPTED", quotedAt: daysAgo(5),
      billToEmail: business.billingEmail!, businessId: business.id,
      invoiceStatus: "ISSUED", issuedAt: daysAgo(5),
    });

    await walk(shipment.id, "QUOTE_READY", [{ to: "AWAITING_PAYMENT", ctx: ctxApproved, at: daysAgo(5), actorId: bizAdmin.id }]);
    await payInFull(invoice.id, total, daysAgo(4), ops.id);

    const ctxPaid: TransitionGuardContext = { brokerApproved: true, invoiceSettled: true, hasRequiredDocuments: true };
    const finalStatus = await walk(shipment.id, "AWAITING_PAYMENT", [
      { to: "PAID", ctx: ctxPaid, at: daysAgo(4), actorId: ops.id },
      { to: "FREIGHT_IN_TRANSIT", ctx: ctxPaid, at: daysAgo(4), actorId: ops.id },
      { to: "ARRIVED_BAHAMAS", ctx: ctxPaid, at: daysAgo(3), actorId: ops.id },
      { to: "DECLARATION_PREPARED", ctx: ctxPaid, at: daysAgo(3), actorId: broker.id },
      { to: "SUBMITTED_TO_CUSTOMS", ctx: ctxPaid, at: daysAgo(3), actorId: broker.id },
      { to: "CUSTOMS_HOLD", ctx: ctxPaid, at: daysAgo(3), actorId: ops.id, note: "Selected for physical inspection per manifest risk score" },
    ]);

    await prisma.customsDeclaration.create({
      data: {
        shipmentId: shipment.id, status: "QUERIED", entryNumber: "C2C-2026-004907", regimeCode: "IM4",
        submittedAt: daysAgo(3), submittedBy: broker.id, adapter: "manual",
        payloadJson: { reference, lines: 1, declarant: broker.id, hold: "physical inspection" } as never,
      },
    });

    const exceptionInput: ExceptionInput = {
      hasCommercialInvoice: true, freightCost, goodsValue, freightMode: "SEA",
      lines: [{ lineNumber: 1, hsCode: "0303.00.00", lineValue: goodsValue, regulated: true }],
      status: finalStatus as ShipmentStatus, statusChangedAt: daysAgo(3), now: NOW,
      quotedGovernmentTotal: result.governmentTotal,
    };
    const flags = detectExceptions(exceptionInput);
    await prisma.exceptionFlag.createMany({
      data: flags.map((f) => ({ shipmentId: shipment.id, code: f.code, severity: f.severity, message: f.message })),
    });

    const ticket = await prisma.supportTicket.create({
      data: {
        reference: `TCK-${reference}`, userId: bizUser.id, shipmentId: shipment.id, category: "customs",
        subject: "Why is my shipment on hold?", status: "WAITING_STAFF", createdAt: daysAgo(2),
      },
    });
    await prisma.supportMessage.createMany({
      data: [
        { ticketId: ticket.id, authorId: bizUser.id, body: "Customs has held our frozen fish shipment for two days now — can you find out what's happening?", internal: false, createdAt: daysAgo(2) },
        { ticketId: ticket.id, authorId: ops.id, body: "Flagged for physical inspection per manifest risk score. Following up with the examining officer.", internal: true, createdAt: daysAgo(2) },
        { ticketId: ticket.id, authorId: ops.id, body: "Your shipment was selected for a routine physical inspection. We expect an update within two business days and will let you know the moment it clears.", internal: false, createdAt: daysAgo(1) },
      ],
    });
  }

  // ─────────────────────────────── CRM & procurement ────────────────────────────
  const leadNauticalTraders = await prisma.lead.create({
    data: {
      company: "Nassau Auto Traders", contactName: "Ryan Munroe", email: "ryan@nassauautotraders.example.com",
      industry: "Auto parts retail", monthlyVolume: "45000.00", currentBroker: "Self-filed",
      stage: "QUALIFIED", ownerId: ops.id, nextFollowUp: daysAgo(-5),
      notes: "Interested in switching from self-filing. Wants a brokerage + delivery bundle.",
      createdAt: daysAgo(14),
    },
  });
  await prisma.crmActivity.create({
    data: { leadId: leadNauticalTraders.id, actorId: ops.id, kind: "call", summary: "Intro call — walked through the Business Pro plan and delivery bundle.", occurredAt: daysAgo(14) },
  });

  const leadBoutique = await prisma.lead.create({
    data: {
      company: "Paradise Isle Boutique", contactName: "Alicia Curry", email: "alicia@paradiseisleboutique.example.com",
      industry: "Retail apparel", monthlyVolume: "12000.00", currentBroker: "Competitor brokerage",
      stage: "PROPOSAL", ownerId: broker.id, nextFollowUp: daysAgo(-2),
      notes: "Sent Business Starter plan proposal after a rate comparison.",
      createdAt: daysAgo(9),
    },
  });
  await prisma.crmActivity.create({
    data: { leadId: leadBoutique.id, actorId: broker.id, kind: "email", summary: "Sent Business Starter plan proposal and sample landed-cost breakdown.", occurredAt: daysAgo(9) },
  });

  const procurement = await prisma.procurementRequest.create({
    data: {
      reference: "PR-2026-0001", businessId: business.id, requestedBy: bizUser.id,
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
  const procurementTotal = cents(Object.values(procurementLines).reduce((acc, v) => acc.plus(v), money(0))).toFixed(2);
  await prisma.procurementQuote.create({
    data: {
      requestId: procurement.id,
      productCost: procurementLines.productCost.toFixed(2), domesticTransport: procurementLines.domesticTransport.toFixed(2),
      internationalFreight: procurementLines.internationalFreight.toFixed(2), insurance: procurementLines.insurance.toFixed(2),
      governmentEstimate: procurementLines.governmentEstimate.toFixed(2), procurementFee: procurementLines.procurementFee.toFixed(2),
      brokerageFee: procurementLines.brokerageFee.toFixed(2), deliveryFee: procurementLines.deliveryFee.toFixed(2),
      total: procurementTotal, validUntil: daysAgo(-14), preparedBy: ops.id, createdAt: daysAgo(4),
    },
  });

  // ─────────────────────────────── Summary ──────────────────────────────────────
  console.log("\nSeed complete.\n");
  console.log(`Dev login password for every seeded account: ${DEV_PASSWORD}\n`);
  console.log("Accounts:");
  for (const u of [admin, broker, ops, driverUser, bizAdmin, bizUser, consumer1, consumer2]) {
    console.log(`  ${u.role.padEnd(14)} ${u.email}`);
  }
  console.log(`\nBusiness: ${business.legalName} (${business.id})`);
  console.log(`Shipments seeded: ${shipmentSeq}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
