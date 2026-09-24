import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Principal, Role } from "@/lib/auth/rbac";

/** Empties every table, so each integration test starts from nothing. */
export async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

let seq = 0;
const next = () => ++seq;

export function createUser(role: Role, name = role.toLowerCase()) {
  const n = next();
  return db.user.create({
    data: { email: `${name}-${n}@test.invalid`, fullName: `${name} ${n}`, role, passwordHash: "not-a-real-hash" },
  });
}

export async function createBusiness(members: { userId: string; isAdmin?: boolean }[], planCode?: string) {
  const subscription = planCode
    ? await db.subscription.create({
        data: { plan: { connect: { code: planCode } } },
      })
    : null;
  return db.business.create({
    data: {
      legalName: `Test Business ${next()} Ltd`,
      billingEmail: `billing-${next()}@test.invalid`,
      subscriptionId: subscription?.id ?? null,
      members: { create: members.map((m) => ({ userId: m.userId, isAdmin: m.isAdmin ?? false })) },
    },
  });
}

/** How the session layer sees a user: role plus the businesses they belong to. */
export async function principalOf(userId: string): Promise<Principal> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } });
  return { id: user.id, role: user.role, businessIds: user.memberships.map((m) => m.businessId) };
}

/**
 * Invented round-number rates, as in tests/fixtures.ts. They are not Bahamian
 * tariff rates and exist only so the engine has something to resolve.
 */
export async function seedRates() {
  const [shirts, rum] = await Promise.all([
    db.hsCode.create({ data: { code: "6109.10.00", description: "T-shirts", chapter: "61" } }),
    db.hsCode.create({ data: { code: "2208.40.00", description: "Rum", chapter: "22" } }),
  ]);
  const rule = (rate: string, extra: Partial<Prisma.RateRuleCreateWithoutChargeTypeInput> = {}) => ({
    rate, effectiveFrom: new Date("2020-01-01"), ...extra,
  });
  await db.chargeType.create({
    data: {
      code: "IMPORT_DUTY", label: "Import duty", payee: "GOVERNMENT", basis: "PERCENT_OF_CUSTOMS_VALUE", sortOrder: 10,
      rateRules: { create: [rule("0.25"), rule("0.50", { hsCode: { connect: { id: rum.id } } })] },
    },
  });
  await db.chargeType.create({
    data: {
      code: "VAT", label: "VAT", payee: "GOVERNMENT", basis: "PERCENT_OF_DUTIABLE_TOTAL", sortOrder: 30,
      baseIncludes: ["IMPORT_DUTY"], rateRules: { create: [rule("0.10")] },
    },
  });
  for (const [code, sortOrder] of [["BROKERAGE", 100], ["PROCESSING", 110], ["DELIVERY", 120]] as const) {
    await db.chargeType.create({ data: { code, label: code, payee: "BROKER", basis: "FLAT", sortOrder } });
  }
  await db.pricingRule.createMany({
    data: [
      { chargeCode: "BROKERAGE", scope: "GLOBAL", percentRate: "0.02", minFee: "10", priority: 100 },
      { chargeCode: "PROCESSING", scope: "GLOBAL", flatAmount: "5", priority: 100 },
      { chargeCode: "DELIVERY", scope: "GLOBAL", flatAmount: "20", priority: 100 },
    ],
  });
  return { shirts, rum };
}

export async function createPlan(code: string, brokerageDiscount = "0") {
  return db.plan.create({
    data: { code, name: code, audience: "B2B", monthlyPrice: "10", features: [], brokerageDiscount },
  });
}

/** A shipment with lines, straight into the database. Lines given an hsCode are
 *  broker-approved unless a status says otherwise. */
export async function createShipment(input: {
  ownerId: string;
  businessId?: string | null;
  status?: Prisma.ShipmentCreateInput["status"];
  lines: { lineValue: string; hsCodeId?: string; status?: Prisma.ShipmentItemCreateWithoutShipmentInput["classificationStatus"] }[];
  commercialInvoice?: boolean;
}) {
  const goods = input.lines.reduce((acc, l) => acc + Number(l.lineValue), 0).toFixed(2);
  return db.shipment.create({
    data: {
      reference: `T-${next()}`,
      owner: { connect: { id: input.ownerId } },
      business: input.businessId ? { connect: { id: input.businessId } } : undefined,
      status: input.status ?? "DRAFT",
      goodsValue: goods,
      freightCost: "0",
      items: {
        create: input.lines.map((l, i) => ({
          lineNumber: i + 1,
          description: `Line ${i + 1}`,
          lineValue: l.lineValue,
          unitValue: l.lineValue,
          hsCode: l.hsCodeId ? { connect: { id: l.hsCodeId } } : undefined,
          classificationStatus: l.status ?? (l.hsCodeId ? "BROKER_APPROVED" : "UNCLASSIFIED"),
        })),
      },
      documents: input.commercialInvoice
        ? { create: { kind: "COMMERCIAL_INVOICE", fileName: "ci.pdf", mimeType: "application/pdf", sizeBytes: 1, storageKey: "ci", uploadedBy: input.ownerId } }
        : undefined,
    },
    include: { items: true },
  });
}

export function createInvoice(input: {
  shipmentId?: string;
  businessId?: string | null;
  governmentTotal: string;
  brokerTotal: string;
  status?: Prisma.InvoiceCreateInput["status"];
  amountPaid?: string;
  issuedAt?: Date;
}) {
  const total = (Number(input.governmentTotal) + Number(input.brokerTotal)).toFixed(2);
  return db.invoice.create({
    data: {
      reference: `INV-T-${next()}`,
      shipmentId: input.shipmentId ?? null,
      businessId: input.businessId ?? null,
      billToEmail: "billing@test.invalid",
      status: input.status ?? "ISSUED",
      governmentTotal: input.governmentTotal,
      brokerTotal: input.brokerTotal,
      total,
      amountPaid: input.amountPaid ?? "0",
      issuedAt: input.issuedAt ?? new Date(),
    },
  });
}
