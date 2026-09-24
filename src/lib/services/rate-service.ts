import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { can, type Principal } from "@/lib/auth/rbac";
import { money } from "@/lib/money";
import { DomainError } from "./errors";

const DECIMAL = /^\d+(\.\d{1,6})?$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
/** Column limits: rate Decimal(9, 6), minimum and maximum Decimal(14, 2). */
const MAX_RATE = money("999.999999");
const MAX_AMOUNT = money("999999999999.99");

/** Checked before any write, so a bad number is a 400 and never a database error. */
function validateFigures(input: { rate: string; minAmount?: string | null; maxAmount?: string | null }) {
  if (!DECIMAL.test(input.rate)) throw new DomainError("Enter the rate as a number of zero or more.");
  if (money(input.rate).greaterThan(MAX_RATE)) throw new DomainError("That rate is too large to store.");
  for (const [label, value] of [["minimum", input.minAmount], ["maximum", input.maxAmount]] as const) {
    if (value == null) continue;
    if (!MONEY.test(value)) throw new DomainError(`Enter the ${label} in dollars and cents, zero or more.`);
    if (money(value).greaterThan(MAX_AMOUNT)) throw new DomainError(`That ${label} is too large to store.`);
  }
  if (input.minAmount != null && input.maxAmount != null && money(input.minAmount).greaterThan(money(input.maxAmount))) {
    throw new DomainError("The minimum cannot be more than the maximum.");
  }
}

async function editor(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor || !actor.active || actor.deletedAt || !can(actor.role, "rates:edit")) {
    throw new DomainError("Your account cannot change rates.", 403);
  }
  return actor;
}

const figures = (r: { rate: Prisma.Decimal; minAmount: Prisma.Decimal | null; maxAmount: Prisma.Decimal | null; confirmed: boolean; sourceNote: string | null }) => ({
  rate: r.rate.toString(),
  minAmount: r.minAmount?.toString() ?? null,
  maxAmount: r.maxAmount?.toString() ?? null,
  confirmed: r.confirmed,
  sourceNote: r.sourceNote,
});

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
  validateFigures(input);
  const effectiveFrom = input.effectiveFrom ?? new Date();

  return db.$transaction(async (tx) => {
    const actor = await editor(tx, input.actorId);

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
        oldValue: { ruleId: current.id, ...figures(current) },
        newValue: { ruleId: next.id, ...figures(next), effectiveFrom: effectiveFrom.toISOString() },
        reason,
      },
      tx,
    );

    return next;
  });
}

/**
 * A rate for goods no rule covers yet at that scope: one tariff heading, or one
 * chapter. The most specific live rule wins when a line is priced, so this is
 * how a heading gets a duty rate different from its chapter's.
 *
 * It will not open a second rule over the same goods. Changing an existing
 * rate is supersedeRateRule, which keeps the history.
 */
export async function createRateRule(input: {
  actorId: string;
  chargeTypeId: string;
  hsCode?: string | null;
  chapter?: string | null;
  rate: string;
  minAmount?: string | null;
  maxAmount?: string | null;
  confirmed: boolean;
  sourceNote?: string | null;
  reason: string;
  effectiveFrom?: Date;
}) {
  const reason = input.reason?.trim();
  if (!reason) throw new DomainError("Say why this rate is being added.");
  const sourceNote = input.sourceNote?.trim() || null;
  if (input.confirmed && !sourceNote) {
    throw new DomainError("A confirmed rate must cite the instrument it was checked against.");
  }
  const hsCode = input.hsCode?.trim() || null;
  const chapter = input.chapter?.trim() || null;
  if (hsCode && chapter) throw new DomainError("A rule covers a heading or a chapter, not both.");
  if (chapter && !/^\d{2}$/.test(chapter)) throw new DomainError("A chapter is two digits, such as 84.");
  validateFigures(input);
  const effectiveFrom = input.effectiveFrom ?? new Date();

  return db.$transaction(async (tx) => {
    const actor = await editor(tx, input.actorId);

    // Serialises additions to one charge, so two people cannot both add the
    // same heading at once.
    await tx.$queryRaw`SELECT id FROM "ChargeType" WHERE id = ${input.chargeTypeId} FOR UPDATE`;
    const type = await tx.chargeType.findUnique({ where: { id: input.chargeTypeId } });
    if (!type) throw new DomainError("Charge not found.", 404);
    if (type.payee !== "GOVERNMENT") {
      throw new DomainError("Kencole's own fees are set in pricing rules, not in the rate table.");
    }

    const heading = hsCode ? await tx.hsCode.findUnique({ where: { code: hsCode } }) : null;
    if (hsCode && (!heading || !heading.active)) {
      throw new DomainError(`Tariff heading ${hsCode} is not in the classification table.`);
    }

    const overlapping = await tx.rateRule.findFirst({
      where: {
        chargeTypeId: type.id,
        hsCodeId: heading?.id ?? null,
        chapter: heading ? undefined : chapter,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
      },
    });
    if (overlapping) {
      throw new DomainError("There is already a rate for those goods. Change that rate instead of adding another.", 409);
    }

    const created = await tx.rateRule.create({
      data: {
        chargeTypeId: type.id,
        hsCodeId: heading?.id ?? null,
        chapter: heading ? null : chapter,
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
        action: "rate.created",
        entityType: "RateRule",
        entityId: created.id,
        newValue: {
          ruleId: created.id, chargeCode: type.code, hsCode, chapter: created.chapter,
          ...figures(created), effectiveFrom: effectiveFrom.toISOString(),
        },
        reason,
      },
      tx,
    );
    return created;
  });
}

const SPECIFICITY = (r: { hsCodeId: string | null; chapter: string | null }) => (r.hsCodeId ? 2 : r.chapter ? 1 : 0);

/**
 * The rate table as staff see it: each government charge with the rules in
 * force now, those scheduled to start later, and those already superseded.
 */
export async function listRateTable(p: Principal, now = new Date()) {
  if (!can(p.role, "rates:read")) throw new DomainError("Not found.", 404);
  const [types, recent] = await Promise.all([
    db.chargeType.findMany({
      where: { payee: "GOVERNMENT" },
      orderBy: { sortOrder: "asc" },
      include: {
        rateRules: {
          include: { hsCode: { select: { code: true, description: true } } },
          orderBy: { effectiveFrom: "desc" },
        },
      },
    }),
    db.auditLog.findMany({
      where: { action: { in: ["rate.changed", "rate.created"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { fullName: true } } },
    }),
  ]);

  return {
    charges: types.map((t) => {
      const rules = t.rateRules.map((r) => ({
        id: r.id,
        hsCode: r.hsCode?.code ?? null,
        hsDescription: r.hsCode?.description ?? null,
        chapter: r.chapter,
        rate: r.rate.toString(),
        minAmount: r.minAmount?.toString() ?? null,
        maxAmount: r.maxAmount?.toString() ?? null,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        confirmed: r.confirmed,
        sourceNote: r.sourceNote,
        specificity: SPECIFICITY(r),
      }));
      const bySpecificity = (a: (typeof rules)[number], b: (typeof rules)[number]) =>
        a.specificity - b.specificity || (a.chapter ?? a.hsCode ?? "").localeCompare(b.chapter ?? b.hsCode ?? "");
      return {
        id: t.id,
        code: t.code,
        label: t.label,
        basis: t.basis,
        level: t.level,
        description: t.description,
        baseIncludes: t.baseIncludes,
        active: t.active,
        current: rules.filter((r) => r.effectiveFrom <= now && (!r.effectiveTo || r.effectiveTo > now)).sort(bySpecificity),
        scheduled: rules.filter((r) => r.effectiveFrom > now).sort(bySpecificity),
        past: rules.filter((r) => r.effectiveTo && r.effectiveTo <= now),
      };
    }),
    recent: recent.map((a) => ({
      id: a.id, action: a.action, actor: a.actor?.fullName ?? "System", reason: a.reason,
      oldValue: a.oldValue, newValue: a.newValue, at: a.createdAt,
    })),
  };
}
