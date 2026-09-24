import { z } from "zod";
import { TRANSITIONS, type ShipmentStatus } from "@/lib/domain/shipment-state";
import { nassauMidnight } from "@/lib/domain/rates";

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d{1,6})?$/.test(v), "Enter a number.")
  .refine((v) => Number(v) >= 0, "Enter a value of zero or more.");

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const registrationSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  password: z.string().min(12, "Use at least 12 characters."),
  accountType: z.enum(["personal", "business"]).default("personal"),
  companyName: z.string().trim().max(200).optional().or(z.literal("")),
});

export const shipmentItemSchema = z.object({
  description: z.string().trim().min(2, "Describe the item.").max(500),
  quantity: decimalString.default("1"),
  unitValue: decimalString.default("0"),
  originCountry: z.string().trim().length(2).optional().or(z.literal("")),
  hsCode: z.string().trim().max(20).optional().or(z.literal("")),
});

export const shipmentSchema = z.object({
  importType: z.enum(["PERSONAL", "COMMERCIAL"]).default("PERSONAL"),
  freightMode: z.enum(["AIR", "SEA", "COURIER"]).default("AIR"),
  supplierName: z.string().trim().max(200).optional().or(z.literal("")),
  supplierCountry: z.string().trim().max(2).optional().or(z.literal("")),
  trackingNumber: z.string().trim().max(80).optional().or(z.literal("")),
  airwayBill: z.string().trim().max(80).optional().or(z.literal("")),
  originCountry: z.string().trim().max(2).optional().or(z.literal("")),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  currency: z.string().trim().length(3).default("USD"),
  goodsValue: decimalString,
  freightCost: decimalString.default("0"),
  insuranceCost: decimalString.default("0"),
  items: z.array(shipmentItemSchema).max(200).default([]),
});

export const estimateSchema = z.object({
  goodsValue: decimalString,
  freightCost: decimalString.default("0"),
  insuranceCost: decimalString.default("0"),
  currency: z.string().trim().length(3).default("USD"),
  importType: z.enum(["PERSONAL", "COMMERCIAL"]).default("PERSONAL"),
  hsCode: z.string().trim().max(20).optional().or(z.literal("")),
  deliveryRequested: z.boolean().default(true),
  rush: z.boolean().default(false),
});

export const classificationDecisionSchema = z.object({
  itemId: z.string().cuid(),
  hsCode: z.string().trim().min(4, "Enter a tariff code.").max(20),
  decision: z.enum(["APPROVE", "MODIFY", "EXCEPTION"]),
  /** Required whenever the broker departs from the suggestion. */
  reason: z.string().trim().max(1000).optional().or(z.literal("")),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
}).refine((v) => v.decision === "APPROVE" || (v.reason && v.reason.length >= 4), {
  message: "Give a reason when changing or flagging a classification.",
  path: ["reason"],
});

export const statusChangeSchema = z.object({
  to: z.string().min(1),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export const rateRuleSchema = z.object({
  chargeTypeId: z.string().cuid(),
  hsCodeId: z.string().cuid().optional().or(z.literal("")),
  chapter: z.string().trim().max(2).optional().or(z.literal("")),
  rate: decimalString,
  minAmount: decimalString.optional(),
  maxAmount: decimalString.optional(),
  confirmed: z.boolean().default(false),
  sourceNote: z.string().trim().max(500).optional().or(z.literal("")),
  reason: z.string().trim().min(4, "Say why this rate is changing."),
});

export type ShipmentInput = z.infer<typeof shipmentSchema>;
export type EstimateInput = z.infer<typeof estimateSchema>;

// ─── Step 5 route inputs ──────────────────────────────────────────────────────


const STATUSES = Object.keys(TRANSITIONS) as [ShipmentStatus, ...ShipmentStatus[]];
export const shipmentStatusSchema = z.enum(STATUSES);

/**
 * Only these currencies can be costed today. BSD is pegged 1:1 to USD; any
 * other currency needs an exchange rate the system does not hold yet.
 * TODO(fx): make exchange rates configurable (effective-dated, like RateRule)
 * before accepting other currencies.
 */
export const SUPPORTED_CURRENCIES = ["USD", "BSD"] as const;

export const createShipmentSchema = shipmentSchema.extend({
  businessId: z.string().cuid().optional(),
});

/** Every field optional and no defaults, so a missing field is left alone rather
 *  than reset. `items`, when sent, replaces every line. */
export const shipmentUpdateSchema = z.object({
  freightMode: z.enum(["AIR", "SEA", "COURIER"]).optional(),
  supplierName: z.string().trim().max(200).optional(),
  supplierCountry: z.string().trim().max(2).optional(),
  trackingNumber: z.string().trim().max(80).optional(),
  airwayBill: z.string().trim().max(80).optional(),
  originCountry: z.string().trim().max(2).optional(),
  description: z.string().trim().max(1000).optional(),
  currency: z.string().trim().length(3).optional(),
  goodsValue: decimalString.optional(),
  freightCost: decimalString.optional(),
  insuranceCost: decimalString.optional(),
  items: z.array(shipmentItemSchema).max(200).optional(),
  /** Required when values change on a shipment already past intake. */
  reason: z.string().trim().max(500).optional(),
});

export const listShipmentsQuery = z.object({
  status: shipmentStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(40).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});

export const transitionSchema = z.object({
  to: shipmentStatusSchema,
  note: z.string().trim().max(500).optional(),
});

export const documentKindSchema = z.enum([
  "COMMERCIAL_INVOICE", "AIRWAY_BILL", "BILL_OF_LADING", "PACKING_LIST", "PERMIT",
  "RECEIPT", "CUSTOMS_ENTRY", "PROOF_OF_DELIVERY", "OTHER",
]);

export const issueInvoiceSchema = z.object({ quoteId: z.string().cuid() });

export const paymentSchema = z.object({
  amount: decimalString.refine((v) => Number(v) > 0, "Enter an amount above zero."),
  provider: z.enum(["manual", "bank_transfer", "card", "credit"]),
  providerRef: z.string().trim().max(120).optional(),
});

export const suggestSchema = z.object({ itemId: z.string().cuid() });

// ─── Staff administration ─────────────────────────────────────────────────────

const optionalAmount = z.string().trim().max(20).optional().nullable()
  .transform((v) => (v ? v : null));

/** A calendar date, taken as midnight in Nassau. Omitted means now. */
const effectiveDate = z.string().trim().optional().or(z.literal(""))
  .transform((v, ctx) => {
    if (!v) return undefined;
    try {
      return nassauMidnight(v);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: e instanceof Error ? e.message : "Enter a valid date." });
      return z.NEVER;
    }
  });

const rateFields = {
  /** As stored: a fraction for percentage bases (0.35 for 35%), dollars otherwise. */
  rate: z.string().trim().min(1, "Enter a rate.").max(20),
  minAmount: optionalAmount,
  maxAmount: optionalAmount,
  confirmed: z.boolean().default(false),
  sourceNote: z.string().trim().max(500).optional().nullable(),
  reason: z.string().trim().min(1, "Say why this rate is changing.").max(1000),
  effectiveFrom: effectiveDate,
};

export const rateSupersedeSchema = z.object(rateFields);

export const rateCreateSchema = z.object({
  ...rateFields,
  chargeTypeId: z.string().cuid(),
  hsCode: z.string().trim().max(20).optional().nullable(),
  chapter: z.string().trim().max(2).optional().nullable(),
});

const roleSchema = z.enum([
  "CONSUMER", "BUSINESS_USER", "BUSINESS_ADMIN", "CUSTOMS_BROKER", "OPERATIONS", "DRIVER", "SUPER_ADMIN",
]);

export const userRoleSchema = z.object({
  role: roleSchema,
  reason: z.string().trim().min(1, "Give a reason for changing someone's role.").max(1000),
});

export const userAccessSchema = z.object({
  active: z.boolean(),
  reason: z.string().trim().min(1, "Give a reason for changing this account's access.").max(1000),
});

export const listUsersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: roleSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
  cursor: z.string().max(40).optional(),
});
