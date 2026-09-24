import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { can } from "@/lib/auth/rbac";
import { DomainError } from "./errors";

const DECIMAL = /^\d+(\.\d{1,6})?$/;

/**
 * Changing a regulatory rate.
 *
 * A rate is never edited in place. Rules are effective-dated so that an entry is
 * always recalculated on the rate it was assessed under; overwriting a row would
 * silently rewrite history. A change closes the current rule and opens a new one,
 * and the two writes and the audit record commit together or not at all.
 *
 * Confirming a rate is a claim that it matches the law, so it has to cite the
 * instrument it was checked against.
 */
export async function supersedeRateRule(input: {
  actorId: string;
  rateRuleId: string;
  rate: string;
  minAmount?: string | null;
  maxAmount?: string | null;
  confirmed: boolean;
  sourceNote?: string | null;
  reason: string;
  effectiveFrom?: Date;
}) {
  const reason = input.reason?.trim();
  if (!reason) throw new DomainError("Say why this rate is changing.");
  const sourceNote = input.sourceNote?.trim() || null;
  if (input.confirmed && !sourceNote) {
    throw new DomainError("A confirmed rate must cite the instrument it was checked against.");
  }
  for (const [label, value] of [["rate", input.rate], ["minimum", input.minAmount], ["maximum", input.maxAmount]] as const) {
    if (value != null && !DECIMAL.test(value)) throw new DomainError(`Enter the ${label} as a number of zero or more.`);
  }
  const effectiveFrom = input.effectiveFrom ?? new Date();

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorId } });
    if (!actor || !actor.active || actor.deletedAt || !can(actor.role, "rates:edit")) {
      throw new DomainError("Your account cannot change rates.", 403);
    }

    await tx.$queryRaw`SELECT id FROM "RateRule" WHERE id = ${input.rateRuleId} FOR UPDATE`;
    const current = await tx.rateRule.findUnique({ where: { id: input.rateRuleId } });
    if (!current) throw new DomainError("Rate not found.", 404);
    if (current.effectiveTo && current.effectiveTo <= effectiveFrom) {
      throw new DomainError("That rate has already been superseded.", 409);
    }
    if (effectiveFrom <= current.effectiveFrom) {
      throw new DomainError("A new rate must take effect after the one it replaces.");
    }

    await tx.rateRule.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
    const next = await tx.rateRule.create({
      data: {
        chargeTypeId: current.chargeTypeId,
        hsCodeId: current.hsCodeId,
        chapter: current.chapter,
        rate: input.rate,
        minAmount: input.minAmount ?? null,
        maxAmount: input.maxAmount ?? null,
        effectiveFrom,
        confirmed: input.confirmed,
        sourceNote,
      },
    });

    await recordAudit(
      {
        actorId: actor.id,
        action: "rate.changed",
        entityType: "RateRule",
        entityId: next.id,
        oldValue: {
          ruleId: current.id, rate: current.rate.toString(),
          minAmount: current.minAmount?.toString() ?? null, maxAmount: current.maxAmount?.toString() ?? null,
          confirmed: current.confirmed, sourceNote: current.sourceNote,
        },
        newValue: {
          ruleId: next.id, rate: next.rate.toString(),
          minAmount: next.minAmount?.toString() ?? null, maxAmount: next.maxAmount?.toString() ?? null,
          confirmed: next.confirmed, sourceNote: next.sourceNote, effectiveFrom: effectiveFrom.toISOString(),
        },
        reason,
      },
      tx,
    );

    return next;
  });
}
