import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyImport, exportReference, IMPORT_KIND_LIST, previewImport } from "@/lib/services/reference-import";
import { createBusiness, createPlan, createUser, principalOf, resetDatabase, seedRates } from "../helpers/db";

beforeEach(resetDatabase);

const NOW = new Date("2026-09-25T16:00:00Z");
const WHY = "2026 tariff schedule";

async function setup() {
  const codes = await seedRates();
  const broker = await principalOf((await createUser("CUSTOMS_BROKER")).id);
  const admin = await principalOf((await createUser("SUPER_ADMIN")).id);
  const ops = await principalOf((await createUser("OPERATIONS")).id);
  return { ...codes, broker, admin, ops };
}

const csv = (...lines: string[]) => lines.join("\n");

describe("tariff codes", () => {
  it("adds new codes, updates changed ones and leaves the rest, with one audit entry", async () => {
    const { broker } = await setup();
    const file = csv(
      "Tariff code,Description,Chapter,Active",
      "8471.30.00,Laptops,,",
      "2208.40.00,Rum and tafia,22,yes",
      "6109.10.00,T-shirts,,",
    );
    const preview = await previewImport(broker, "tariff-codes", file);
    expect(preview.counts).toMatchObject({ create: 1, change: 1, unchanged: 1, error: 0 });
    expect(preview.rows.map((r) => r.action)).toEqual(["change", "create"]);
    expect(await db.hsCode.count()).toBe(2); // the check writes nothing

    await applyImport(broker, "tariff-codes", file, WHY);
    expect(await db.hsCode.findUniqueOrThrow({ where: { code: "8471.30.00" } })).toMatchObject({ chapter: "84", active: true });
    expect((await db.hsCode.findUniqueOrThrow({ where: { code: "2208.40.00" } })).description).toBe("Rum and tafia");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "reference.imported" } });
    expect(log).toMatchObject({ actorId: broker.id, reason: WHY });
    expect(log.newValue).toMatchObject({ added: ["8471.30.00"] });
  });

  it("reports every problem on a row and saves nothing while any remain", async () => {
    const { broker } = await setup();
    const file = csv(
      "tariff_code,description,chapter",
      "8471.3,Laptops,",
      "8471.30.00,,85",
      "9403.20.00,Furniture,",
      "9403.20.00,Furniture again,",
    );
    const preview = await previewImport(broker, "tariff-codes", file);
    expect(preview.canApply).toBe(false);
    const errors = preview.rows.filter((r) => r.action === "error");
    expect(errors.map((r) => r.line)).toEqual([2, 3, 5]);
    expect(errors[0]!.errors[0]).toMatch(/dropped a trailing zero/);
    expect(errors[1]!.errors).toEqual(["Enter a description.", "Chapter 85 does not match code 8471.30.00."]);
    await expect(applyImport(broker, "tariff-codes", file, WHY)).rejects.toMatchObject({ status: 409 });
    expect(await db.hsCode.count()).toBe(2);
  });

  it("names a missing column instead of guessing", async () => {
    const { broker } = await setup();
    const preview = await previewImport(broker, "tariff-codes", csv("code,desc", "8471.30.00,Laptops"));
    expect(preview.fileErrors).toEqual([expect.stringMatching(/no "description" column/)]);
  });
});

describe("government rates", () => {
  const RATES = csv(
    "charge,tariff_code,chapter,rate,minimum,maximum,effective_from,confirmed,source",
    "Import duty,,,25%,,,,,",
    "import_duty,2208.40.00,,45%,,,,yes,Tariff Act 2026 First Schedule",
    "Import duty,,61,20,,,,,",
    "VAT,,,10%,,,,no,",
  );

  it("changes, adds and leaves rates in the units people write them", async () => {
    const { broker, rum } = await setup();
    const preview = await previewImport(broker, "rates", RATES, NOW);
    expect(preview.counts).toMatchObject({ change: 1, create: 1, unchanged: 2, error: 0 });
    expect(preview.rows[0]).toMatchObject({ action: "change", label: "Import duty · Heading 2208.40.00" });
    expect(preview.rows[0]!.detail).toBe("50%, unverified → 45%, confirmed, from when applied");

    await applyImport(broker, "rates", RATES, WHY, NOW);
    const rumRules = await db.rateRule.findMany({ where: { hsCodeId: rum.id }, orderBy: { effectiveFrom: "asc" } });
    expect(rumRules).toHaveLength(2);
    expect(rumRules[0]!.effectiveTo).toEqual(NOW);
    expect(rumRules[1]).toMatchObject({ effectiveFrom: NOW, effectiveTo: null, confirmed: true, sourceNote: "Tariff Act 2026 First Schedule" });
    expect(rumRules[1]!.rate.toString()).toBe("0.45");
    expect((await db.rateRule.findFirstOrThrow({ where: { chapter: "61" } })).rate.toString()).toBe("0.2");

    const logs = await db.auditLog.findMany({ where: { action: { in: ["rate.changed", "rate.created"] } } });
    expect(logs.map((l) => l.action).sort()).toEqual(["rate.changed", "rate.created"]);
    expect(logs.every((l) => l.reason === WHY && l.actorId === broker.id)).toBe(true);
    expect(logs.find((l) => l.action === "rate.changed")!.oldValue).toMatchObject({ ruleId: rumRules[0]!.id, rate: "0.5" });

    // The same file again changes nothing.
    const again = await previewImport(broker, "rates", RATES, new Date(NOW.getTime() + 60_000));
    expect(again.counts).toMatchObject({ change: 0, create: 0, unchanged: 4 });
    expect(again.canApply).toBe(false);
  });

  it("refuses fees, unknown codes, uncited confirmations, past dates and duplicates", async () => {
    const { broker } = await setup();
    const file = csv(
      "charge,tariff_code,chapter,rate,effective_from,confirmed,source",
      "BROKERAGE,,,2%,,,",
      "Import duty,9999.99.99,,5%,,,",
      "Import duty,,84,5%,,yes,",
      "Import duty,,85,5%,2026-01-01,,",
      "Import duty,,86,5%,,,",
      "import duty,,86,6%,,,",
      "Excise,,,1%,,,",
      "VAT,,,ten,,,",
      "Import duty,,87,5%,1/10/2026,,",
      "Import duty,,,25%,,,",
    );
    const preview = await previewImport(broker, "rates", file, NOW);
    const byLine = new Map(preview.rows.map((r) => [r.line, r.errors.join(" ")]));
    expect(byLine.get(2)).toMatch(/one of Kencole's fees/);
    expect(byLine.get(3)).toMatch(/not in the classification table/);
    expect(byLine.get(3)).not.toMatch(/more than once/);
    expect(byLine.get(4)).toMatch(/must cite the instrument/);
    expect(byLine.get(5)).toMatch(/cannot start in the past/);
    expect(byLine.get(7)).toMatch(/more than once/);
    expect(byLine.get(8)).toMatch(/no government charge called "Excise"/);
    expect(byLine.get(9)).toMatch(/number/);
    expect(byLine.get(10)).toMatch(/YYYY-MM-DD/);
    expect(preview.counts.error).toBe(8);
    const before = await db.rateRule.count();
    await expect(applyImport(broker, "rates", file, WHY, NOW)).rejects.toMatchObject({ status: 409 });
    expect(await db.rateRule.count()).toBe(before);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("schedules a change for a later date, and will not stack a second one on it", async () => {
    const { broker } = await setup();
    const later = csv("charge,rate,effective_from", "VAT,12%,2026-10-01");
    await applyImport(broker, "rates", later, WHY, NOW);
    const vat = await db.rateRule.findMany({ where: { chargeType: { code: "VAT" } }, orderBy: { effectiveFrom: "asc" } });
    expect(vat[0]!.effectiveTo).toEqual(new Date("2026-10-01T04:00:00Z")); // midnight in Nassau
    expect(vat[1]!.effectiveFrom).toEqual(new Date("2026-10-01T04:00:00Z"));

    expect((await previewImport(broker, "rates", later, NOW)).counts.unchanged).toBe(1);
    const clash = await previewImport(broker, "rates", csv("charge,rate", "VAT,13%"), NOW);
    expect(clash.rows[0]!.errors[0]).toMatch(/already scheduled for 2026-10-01/);
  });

  it("needs a reason, and is closed to staff who cannot edit rates", async () => {
    const { broker, ops } = await setup();
    await expect(applyImport(broker, "rates", RATES, "  ", NOW)).rejects.toThrow(/Say why/);
    await expect(previewImport(ops, "rates", RATES, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(exportReference(ops, "fees")).rejects.toMatchObject({ status: 404 });
    await expect(previewImport(broker, "fees", "fee\n", NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe("Kencole's fees", () => {
  it("replaces a fee's list and plan prices, leaving other fees and business agreements alone", async () => {
    const { admin } = await setup();
    await createPlan("PRO");
    const business = await createBusiness([]);
    const agreement = await db.pricingRule.create({
      data: { chargeCode: "BROKERAGE", scope: "BUSINESS", businessId: business.id, percentRate: "0.01", priority: 100 },
    });
    const file = csv(
      "fee,plan,import_type,goods_value_from,goods_value_to,flat,percent,per_line,minimum,maximum,priority",
      "BROKERAGE,,,,,,2%,,10,,",
      "BROKERAGE,PRO,,,,,1.5%,,$8.00,,",
      "PROCESSING,,commercial,,,$7.50,,2.50,,,",
    );
    const preview = await previewImport(admin, "fees", file);
    expect(preview.counts).toMatchObject({ unchanged: 1, create: 2, remove: 1, error: 0 });
    expect(preview.rows.find((r) => r.action === "remove")!.label).toBe("PROCESSING · Everyone");

    await applyImport(admin, "fees", file, "New price list");
    const active = await db.pricingRule.findMany({ where: { active: true } });
    expect(active.map((r) => `${r.chargeCode}:${r.scope}:${r.planCode ?? ""}`).sort()).toEqual([
      "BROKERAGE:BUSINESS:", "BROKERAGE:GLOBAL:", "BROKERAGE:PLAN:PRO", "DELIVERY:GLOBAL:", "PROCESSING:GLOBAL:",
    ]);
    const processing = active.find((r) => r.chargeCode === "PROCESSING")!;
    expect(processing).toMatchObject({ importType: "COMMERCIAL" });
    expect(processing.flatAmount?.toString()).toBe("7.5");
    expect(processing.perLineAmount?.toString()).toBe("2.5");
    expect((await db.pricingRule.findUniqueOrThrow({ where: { id: agreement.id } })).active).toBe(true);
    const logs = await db.auditLog.findMany({ where: { action: "pricing.changed" } });
    expect(logs.map((l) => l.entityId).sort()).toEqual(["BROKERAGE", "PROCESSING"]);
  });

  it("refuses a row with no price, a government charge and an unknown plan", async () => {
    const { admin } = await setup();
    const preview = await previewImport(admin, "fees", csv("fee,plan,flat", "BROKERAGE,,", "VAT,,1", "DELIVERY,Gold,5"));
    expect(preview.rows.map((r) => r.errors[0])).toEqual([
      expect.stringMatching(/flat amount, a percentage or a per-line/),
      expect.stringMatching(/government charge/),
      expect.stringMatching(/no plan called "Gold"/),
    ]);
    expect(preview.counts.remove).toBe(0);
  });
});

describe("permits", () => {
  it("sets a code's permits from its rows, and a blank row clears them", async () => {
    const { broker, rum } = await setup();
    await applyImport(broker, "permits", csv(
      "tariff_code,agency,permit,notes",
      "2208.40.00,Ministry of Finance,Liquor import licence,",
    ), WHY);
    expect(await db.permitRequirement.count({ where: { hsCodeId: rum.id } })).toBe(1);

    const clear = csv("tariff_code,agency,permit", "2208.40.00,,");
    const preview = await previewImport(broker, "permits", clear);
    expect(preview.counts).toMatchObject({ remove: 1, unchanged: 1 });
    await applyImport(broker, "permits", clear, WHY);
    expect(await db.permitRequirement.count()).toBe(0);
  });
});

describe("the download is a template", () => {
  it("reads back as no change for every kind", async () => {
    const { admin, broker, rum } = await setup();
    await createPlan("PRO");
    await db.pricingRule.create({ data: { chargeCode: "BROKERAGE", scope: "PLAN", planCode: "PRO", percentRate: "0.0175", minFee: "8", maxFee: "300", importType: "PERSONAL", minValue: "0", maxValue: "5000", priority: 120 } });
    await db.permitRequirement.create({ data: { hsCodeId: rum.id, agency: "Ministry, of Finance", permit: "Licence \"A\"", notes: "=check" } });
    await db.hsCode.update({ where: { id: rum.id }, data: { notes: "Spirits, over 40%" } });
    await applyImport(broker, "rates", csv("charge,chapter,rate,minimum,maximum,effective_from,confirmed,source", "Import duty,03,7.5%,1.00,99.99,2026-12-01,yes,Act s.4", "VAT,,12%,,,2026-11-01,,"), WHY, NOW);

    for (const kind of IMPORT_KIND_LIST) {
      const file = await exportReference(admin, kind, NOW);
      const preview = await previewImport(admin, kind, file, NOW);
      expect({ kind, fileErrors: preview.fileErrors, rows: preview.rows }).toEqual({ kind, fileErrors: [], rows: [] });
      expect(preview.counts.unchanged).toBeGreaterThan(0);
    }
  });
});
