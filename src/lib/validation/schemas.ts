import { z } from "zod";

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
