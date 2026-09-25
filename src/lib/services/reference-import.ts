import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAuditMany, type AuditEntry } from "@/lib/audit";
import { can, type Capability, type Principal } from "@/lib/auth/rbac";
import { CsvError, parseCsv, toCsv } from "@/lib/csv";
import { Decimal } from "@/lib/money";
import {
  formatRate, isPercentBasis, nassauMidnight, RateInputError, scopeLabel, toInputRate, toStoredRate,
  type ChargeBasis,
} from "@/lib/domain/rates";
import { DomainError } from "./errors";

/**
 * Loading reference data from a spreadsheet: tariff codes, government rates,
 * Kencole's fees and permits.
 *
 * Every import is checked first and applied second. The check says, row by
 * row, what would be added, changed, removed or left alone, and refuses the
 * whole file if any row is wrong. Applying re-checks inside the transaction, so
 * what is written is what the database looked like at that moment, and the
 * changes and their audit records commit together or not at all.
 *
 * Government rates follow the same rule as the Rates page: a rate is never
 * edited in place. A changed row closes the rule in force and opens a new one.
 * A row left out of the file leaves its rule alone; the import cannot end a
 * rate. Rates arrive unconfirmed unless the row says "confirmed" and cites the
 * instrument it was checked against.
 */

export type ImportKind = "tariff-codes" | "rates" | "fees" | "permits";
export const IMPORT_KIND_LIST: ImportKind[] = ["tariff-codes", "rates", "fees", "permits"];
export const isImportKind = (v: string): v is ImportKind => (IMPORT_KIND_LIST as string[]).includes(v);

interface Column {
  key: string;
  aliases?: string[];
  required?: boolean;
  help: string;
}

export interface ImportKindInfo {
  title: string;
  capability: Capability;
  summary: string;
  columns: Column[];
}

export const IMPORT_KINDS: Record<ImportKind, ImportKindInfo> = {
  "tariff-codes": {
    title: "Tariff codes",
    capability: "rates:edit",
    summary: "The classification table. New codes are added and changed descriptions updated. Codes left out of the file are kept.",
    columns: [
      { key: "tariff_code", aliases: ["code", "hs_code", "heading"], required: true, help: "Such as 8471.30.00" },
      { key: "description", required: true, help: "As it reads in the tariff" },
      { key: "chapter", help: "Optional; taken from the code" },
      { key: "active", help: "yes or no; blank means yes" },
      { key: "notes", help: "Optional" },
    ],
  },
  rates: {
    title: "Government rates",
    capability: "rates:edit",
    summary: "Duty, VAT, levies and the customs processing fee. A changed rate replaces the one in force from its start date; the old one stays in the history. Rates left out of the file are kept.",
    columns: [
      { key: "charge", aliases: ["charge_code", "charge_type"], required: true, help: "Import duty, VAT, Environmental levy or Customs processing fee" },
      { key: "tariff_code", aliases: ["code", "hs_code", "heading"], help: "For one heading. Leave blank with chapter blank for all goods" },
      { key: "chapter", help: "Two digits, for a whole chapter" },
      { key: "rate", required: true, help: "35% for a percentage; 15.00 for a dollar amount" },
      { key: "minimum", aliases: ["min"], help: "Optional, in dollars" },
      { key: "maximum", aliases: ["max"], help: "Optional, in dollars" },
      { key: "effective_from", aliases: ["takes_effect", "from", "start_date"], help: "YYYY-MM-DD, midnight in Nassau; blank means when applied" },
      { key: "confirmed", help: "yes once checked against the law; blank means no" },
      { key: "source", aliases: ["source_note"], help: "The instrument it was checked against; needed when confirmed" },
    ],
  },
  fees: {
    title: "Kencole's fees",
    capability: "pricing:edit",
    summary: "The list prices and plan prices for brokerage, processing, delivery and rush. For each fee in the file, its rows replace all of that fee's list and plan prices. Agreements with individual businesses are not touched.",
    columns: [
      { key: "fee", aliases: ["charge", "charge_code"], required: true, help: "Brokerage fee, Processing & handling fee, Local delivery or Rush processing" },
      { key: "plan", help: "Blank for everyone, or a plan name" },
      { key: "import_type", help: "Blank for both, personal or commercial" },
      { key: "goods_value_from", aliases: ["value_from"], help: "Optional band, in dollars of customs value" },
      { key: "goods_value_to", aliases: ["value_to"], help: "Optional band, in dollars of customs value" },
      { key: "flat", aliases: ["flat_amount"], help: "Dollars" },
      { key: "percent", aliases: ["percent_rate"], help: "Of customs value, such as 2.5%" },
      { key: "per_line", aliases: ["per_line_amount"], help: "Dollars for each item line" },
      { key: "minimum", aliases: ["min", "min_fee"], help: "Optional, in dollars" },
      { key: "maximum", aliases: ["max", "max_fee"], help: "Optional, in dollars" },
      { key: "priority", help: "Higher wins when two rows match; blank means 100" },
    ],
  },
  permits: {
    title: "Permits",
    capability: "rates:edit",
    summary: "Which tariff codes need a permit, and from which agency. For each code in the file, its rows replace that code's permits. A row with agency and permit blank means the code needs none.",
    columns: [
      { key: "tariff_code", aliases: ["code", "hs_code", "heading"], required: true, help: "Such as 2208.40.00" },
      { key: "agency", help: "Such as Department of Environmental Health Services" },
      { key: "permit", help: "The permit or licence needed" },
      { key: "notes", help: "Optional" },
    ],
  },
};

export type RowAction = "create" | "change" | "unchanged" | "remove" | "error";

export interface PlannedRow {
  /** The spreadsheet row number, counting the header as row 1. Null for removals. */
  line: number | null;
  action: RowAction;
  label: string;
  detail?: string;
  errors: string[];
}

export interface ImportPreview {
  kind: ImportKind;
  /** Every row except those left unchanged, errors first. */
  rows: PlannedRow[];
  counts: Record<RowAction, number>;
  fileErrors: string[];
  canApply: boolean;
}

type Client = Prisma.TransactionClient;
type Apply = (tx: Client, actorId: string, reason: string, now: Date) => Promise<void>;
interface Plan { rows: PlannedRow[]; apply: Apply }

const MAX_BYTES = 4_000_000;
const MAX_ROWS = 20_000;

// ─── Reading cells ────────────────────────────────────────────────────────────

class CellError extends Error {}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const normalizeName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9%&]+/g, " ").trim();

/** Export guards formula-looking text with an apostrophe; reading takes it off again. */
function text(v: string | undefined): string {
  const t = (v ?? "").trim();
  return /^'[=+\-@]/.test(t) ? t.slice(1) : t;
}

function yesNo(v: string, fallback: boolean): boolean {
  const t = v.trim().toLowerCase();
  if (!t) return fallback;
  if (["yes", "y", "true", "1", "x"].includes(t)) return true;
  if (["no", "n", "false", "0"].includes(t)) return false;
  throw new CellError(`Write yes or no, not "${v}".`);
}

const MAX_AMOUNT = new Decimal("999999999999.99");

/** Dollars and cents. "$1,250.00" and "1250" both read as 1250.00. */
function amount(v: string, label: string): string | null {
  const t = v.replace(/[$,\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new CellError(`Write the ${label} in dollars and cents, such as 40.00.`);
  const d = new Decimal(t);
  if (d.greaterThan(MAX_AMOUNT)) throw new CellError(`That ${label} is too large.`);
  return d.toFixed(2);
}

function storedRate(basis: ChargeBasis, v: string): string {
  const t = v.replace(/[$,\s]/g, "");
  if (!t) throw new CellError("Enter a rate.");
  try {
    return toStoredRate(basis, t);
  } catch (e) {
    throw new CellError(e instanceof RateInputError ? e.message : "Check the rate.");
  }
}

function date(v: string): Date | undefined {
  const t = v.trim();
  if (!t) return undefined;
  try {
    return nassauMidnight(t);
  } catch {
    throw new CellError(`Write dates as YYYY-MM-DD, such as 2026-10-01, not "${t}".`);
  }
}

/** Codes are four digits then pairs: 8471.30.00. */
function tariffCode(v: string): string {
  const t = v.replace(/\s/g, "");
  if (!/^\d{4}(\.\d{2}){1,3}$/.test(t)) {
    const hint = /^\d{4}\.\d$/.test(t) ? " The spreadsheet may have dropped a trailing zero; format the column as text." : "";
    throw new CellError(`"${v}" is not a tariff code such as 8471.30.00.${hint}`);
  }
  return t;
}

/** Spreadsheets drop the leading zero of chapter 03, so one digit is padded. */
function chapterOf(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (!/^\d{1,2}$/.test(t)) throw new CellError(`A chapter is two digits, such as 84, not "${v}".`);
  return t.padStart(2, "0");
}

const same = (a: string | null, b: string | null) =>
  a === b || (a != null && b != null && new Decimal(a).equals(new Decimal(b)));

interface Record_ { line: number; values: Record<string, string> }

function readTable(csv: string, info: ImportKindInfo): { records: Record_[]; fileErrors: string[] } {
  if (csv.length > MAX_BYTES) return { records: [], fileErrors: ["That file is larger than 4 MB. Split it into smaller files."] };
  let table: string[][];
  try {
    table = parseCsv(csv);
  } catch (e) {
    return { records: [], fileErrors: [e instanceof CsvError ? e.message : "That file could not be read as CSV."] };
  }
  if (table.length === 0) return { records: [], fileErrors: ["The file is empty."] };

  const header = table[0]!.map(normalizeHeader);
  const index = new Map<string, number>();
  const fileErrors: string[] = [];
  for (const col of info.columns) {
    const names = [col.key, ...(col.aliases ?? [])];
    const at = header.findIndex((h) => names.includes(h));
    if (at >= 0) index.set(col.key, at);
    else if (col.required) fileErrors.push(`The file has no "${col.key}" column. The first row must hold the column names.`);
  }
  if (table.length - 1 > MAX_ROWS) fileErrors.push(`The file has more than ${MAX_ROWS.toLocaleString("en-US")} rows. Split it into smaller files.`);
  if (fileErrors.length) return { records: [], fileErrors };

  const records = table.slice(1).map((row, i) => ({
    line: i + 2,
    values: Object.fromEntries(info.columns.map((c) => [c.key, text(index.has(c.key) ? row[index.get(c.key)!] : "")])),
  }));
  if (records.length === 0) fileErrors.push("The file has column names but no rows.");
  return { records, fileErrors };
}

/** Runs each cell reader, collecting every problem on the row instead of the first. */
function cells() {
  const errors: string[] = [];
  const read = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof CellError) errors.push(e.message);
      else throw e;
      return fallback;
    }
  };
  return { errors, read };
}

function matchByName<T extends { code: string; label?: string; name?: string }>(items: T[], v: string): T | undefined {
  const n = normalizeName(v);
  return items.find((i) => normalizeName(i.code) === n || normalizeName(i.label ?? i.name ?? "") === n);
}

// ─── Tariff codes ─────────────────────────────────────────────────────────────

async function planTariffCodes(records: Record_[], client: Client): Promise<Plan> {
  const existing = new Map((await client.hsCode.findMany()).map((h) => [h.code, h]));
  const seen = new Set<string>();
  const rows: PlannedRow[] = [];
  const creates: Prisma.HsCodeCreateManyInput[] = [];
  const updates: { id: string; code: string; before: object; after: { description: string; active: boolean; notes: string | null } }[] = [];

  for (const r of records) {
    const { errors, read } = cells();
    const code = read(() => tariffCode(r.values.tariff_code!), "");
    const description = r.values.description!;
    if (!description) errors.push("Enter a description.");
    if (description.length > 500) errors.push("Keep the description under 500 characters.");
    const chapter = read(() => chapterOf(r.values.chapter!), null);
    if (code && chapter && chapter !== code.slice(0, 2)) errors.push(`Chapter ${chapter} does not match code ${code}.`);
    const active = read(() => yesNo(r.values.active!, true), true);
    const notes = r.values.notes || null;
    if (code && seen.has(code)) errors.push(`Code ${code} appears more than once in the file.`);
    if (code) seen.add(code);

    const label = code || r.values.tariff_code || "(no code)";
    if (errors.length) { rows.push({ line: r.line, action: "error", label, errors }); continue; }

    const before = existing.get(code);
    if (!before) {
      creates.push({ code, description, chapter: code.slice(0, 2), active, notes });
      rows.push({ line: r.line, action: "create", label, detail: description, errors });
    } else if (before.description !== description || before.active !== active || (before.notes ?? null) !== notes) {
      const detail = [
        before.description !== description ? `description: "${before.description}" → "${description}"` : null,
        before.active !== active ? (active ? "made active" : "made inactive") : null,
        (before.notes ?? null) !== notes ? "notes changed" : null,
      ].filter(Boolean).join("; ");
      updates.push({
        id: before.id, code,
        before: { description: before.description, active: before.active, notes: before.notes },
        after: { description, active, notes },
      });
      rows.push({ line: r.line, action: "change", label, detail, errors });
    } else {
      rows.push({ line: r.line, action: "unchanged", label, errors });
    }
  }

  return {
    rows,
    apply: async (tx, actorId, reason) => {
      for (let i = 0; i < creates.length; i += 1000) await tx.hsCode.createMany({ data: creates.slice(i, i + 1000) });
      // One statement for every changed code; thousands of single updates are slow over the network.
      for (let i = 0; i < updates.length; i += 2000) {
        const chunk = updates.slice(i, i + 2000);
        await tx.$executeRaw`
          UPDATE "HsCode" AS h
          SET "description" = v.description, "active" = v.active, "notes" = v.notes, "updatedAt" = now()
          FROM unnest(
            ${chunk.map((u) => u.id)}::text[], ${chunk.map((u) => u.after.description)}::text[],
            ${chunk.map((u) => u.after.active)}::boolean[], ${chunk.map((u) => u.after.notes)}::text[]
          ) AS v(id, description, active, notes)
          WHERE h.id = v.id`;
      }
      await recordAuditMany([{
        actorId, action: "reference.imported", entityType: "HsCode", entityId: "import", reason,
        newValue: {
          kind: "tariff-codes",
          added: creates.map((c) => c.code),
          changed: updates.map((u) => ({ code: u.code, before: u.before, after: u.after })),
        },
      }], tx);
    },
  };
}

// ─── Government rates ─────────────────────────────────────────────────────────

interface RuleFigures { rate: string; minAmount: string | null; maxAmount: string | null; confirmed: boolean; sourceNote: string | null }

const figuresOf = (r: { rate: Prisma.Decimal; minAmount: Prisma.Decimal | null; maxAmount: Prisma.Decimal | null; confirmed: boolean; sourceNote: string | null }): RuleFigures => ({
  rate: r.rate.toString(), minAmount: r.minAmount?.toString() ?? null, maxAmount: r.maxAmount?.toString() ?? null,
  confirmed: r.confirmed, sourceNote: r.sourceNote,
});

const sameFigures = (a: RuleFigures, b: RuleFigures) =>
  same(a.rate, b.rate) && same(a.minAmount, b.minAmount) && same(a.maxAmount, b.maxAmount)
  && a.confirmed === b.confirmed && (a.sourceNote ?? null) === (b.sourceNote ?? null);

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Nassau", year: "numeric", month: "2-digit", day: "2-digit" });
const isoDay = (d: Date) => DAY.format(d);

function describeFigures(basis: ChargeBasis, f: RuleFigures): string {
  const limits = [f.minAmount ? `min $${f.minAmount}` : null, f.maxAmount ? `max $${f.maxAmount}` : null].filter(Boolean).join(", ");
  return `${formatRate(basis, f.rate)}${limits ? ` (${limits})` : ""}${f.confirmed ? ", confirmed" : ", unverified"}`;
}

async function planRates(records: Record_[], client: Client, now: Date): Promise<Plan> {
  const [types, codes, live] = await Promise.all([
    client.chargeType.findMany(),
    client.hsCode.findMany({ select: { id: true, code: true, chapter: true, active: true } }),
    client.rateRule.findMany({ where: { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] } }),
  ]);
  const government = types.filter((t) => t.payee === "GOVERNMENT");
  const codeByCode = new Map(codes.map((c) => [c.code, c]));
  const rulesByKey = new Map<string, typeof live>();
  for (const rule of live) {
    const key = `${rule.chargeTypeId}|${rule.hsCodeId ?? ""}|${rule.hsCodeId ? "" : rule.chapter ?? ""}`;
    rulesByKey.set(key, [...(rulesByKey.get(key) ?? []), rule]);
  }
  const today = nassauMidnight(isoDay(now));

  const seen = new Set<string>();
  const rows: PlannedRow[] = [];
  type Write = {
    kind: "create" | "change";
    type: (typeof government)[number];
    hs: { id: string; code: string } | null;
    chapter: string | null;
    figures: RuleFigures;
    effectiveFrom: Date | undefined;
    replaces?: (typeof live)[number];
  };
  const writes: Write[] = [];

  for (const r of records) {
    const { errors, read } = cells();
    const v = r.values;
    const typeName = v.charge!;
    const type = typeName ? matchByName(government, typeName) : undefined;
    if (!typeName) errors.push("Say which charge this rate is for.");
    else if (!type) {
      errors.push(matchByName(types, typeName)
        ? `${typeName} is one of Kencole's fees. Fees are imported on their own sheet.`
        : `There is no government charge called "${typeName}". Use one of: ${government.map((t) => t.label).join(", ")}.`);
    }

    const code = v.tariff_code ? read(() => tariffCode(v.tariff_code!), "") : "";
    let chapter = read(() => chapterOf(v.chapter!), null);
    const hs = code ? codeByCode.get(code) : undefined;
    if (code && !hs) errors.push(`Tariff code ${code} is not in the classification table. Import it on the Tariff codes sheet first.`);
    else if (hs && !hs.active) errors.push(`Tariff code ${code} is marked inactive.`);
    if (hs && chapter && chapter !== hs.chapter) errors.push(`Code ${code} is in chapter ${hs.chapter}, not ${chapter}. Fill in one or the other.`);
    if (hs) chapter = null;

    const basis = (type?.basis ?? "PERCENT_OF_CUSTOMS_VALUE") as ChargeBasis;
    const rate = read(() => storedRate(basis, v.rate!), "0");
    const minAmount = read(() => amount(v.minimum!, "minimum"), null);
    const maxAmount = read(() => amount(v.maximum!, "maximum"), null);
    if (minAmount && maxAmount && new Decimal(minAmount).greaterThan(maxAmount)) errors.push("The minimum is more than the maximum.");
    const effectiveFrom = read(() => date(v.effective_from!), undefined);
    if (effectiveFrom && effectiveFrom < today) errors.push("A rate cannot start in the past. Leave the date blank to start it when you apply the file.");
    const confirmed = read(() => yesNo(v.confirmed!, false), false);
    const sourceNote = v.source || null;
    if (sourceNote && sourceNote.length > 500) errors.push("Keep the source under 500 characters.");
    if (confirmed && !sourceNote) errors.push("A confirmed rate must cite the instrument it was checked against, in the source column.");

    const scope = scopeLabel({ hsCode: code || (v.tariff_code ? v.tariff_code : null), chapter });
    const label = `${type?.label ?? (typeName || "?")} · ${scope}`;
    // A row whose code is wrong has no scope yet; it must not collide with the all-goods row.
    const scoped = !v.tariff_code || !!hs;
    const key = type && scoped ? `${type.id}|${hs?.id ?? ""}|${hs ? "" : chapter ?? ""}` : "";
    if (key && seen.has(key)) errors.push(`${label} appears more than once in the file.`);
    if (key) seen.add(key);
    if (errors.length || !type) { rows.push({ line: r.line, action: "error", label, errors }); continue; }

    const figures: RuleFigures = { rate, minAmount, maxAmount, confirmed, sourceNote };
    const existing = rulesByKey.get(key) ?? [];
    const scheduled = existing.find((x) => x.effectiveFrom > now);
    const current = existing.find((x) => x.effectiveFrom <= now);
    const hsRef = hs ? { id: hs.id, code } : null;

    if (scheduled) {
      if (sameFigures(figuresOf(scheduled), figures) && (!effectiveFrom || effectiveFrom.getTime() === scheduled.effectiveFrom.getTime())) {
        rows.push({ line: r.line, action: "unchanged", label, errors });
      } else {
        rows.push({
          line: r.line, action: "error", label,
          errors: [`A change to this rate is already scheduled for ${isoDay(scheduled.effectiveFrom)}. Sort that out on the Rates page first.`],
        });
      }
    } else if (current) {
      const before = figuresOf(current);
      if (current.effectiveTo) {
        rows.push({ line: r.line, action: "error", label, errors: [`This rate is set to end on ${isoDay(current.effectiveTo)}. Sort that out on the Rates page first.`] });
      } else if (sameFigures(before, figures)) {
        rows.push({ line: r.line, action: "unchanged", label, errors });
      } else if (effectiveFrom && effectiveFrom <= current.effectiveFrom) {
        rows.push({ line: r.line, action: "error", label, errors: [`The new rate must start after ${isoDay(current.effectiveFrom)}, when the current one did.`] });
      } else {
        writes.push({ kind: "change", type, hs: hsRef, chapter, figures, effectiveFrom, replaces: current });
        rows.push({
          line: r.line, action: "change", label,
          detail: `${describeFigures(basis, before)} → ${describeFigures(basis, figures)}, from ${effectiveFrom ? isoDay(effectiveFrom) : "when applied"}`,
          errors,
        });
      }
    } else {
      writes.push({ kind: "create", type, hs: hsRef, chapter, figures, effectiveFrom });
      rows.push({
        line: r.line, action: "create", label,
        detail: `${describeFigures(basis, figures)}, from ${effectiveFrom ? isoDay(effectiveFrom) : "when applied"}`,
        errors,
      });
    }
  }

  return {
    rows,
    apply: async (tx, actorId, reason, at) => {
      // Close the replaced rules, one statement per start date.
      const closing = new Map<number, string[]>();
      for (const w of writes) {
        if (!w.replaces) continue;
        const when = (w.effectiveFrom ?? at).getTime();
        closing.set(when, [...(closing.get(when) ?? []), w.replaces.id]);
      }
      for (const [when, ids] of closing) {
        await tx.rateRule.updateMany({ where: { id: { in: ids } }, data: { effectiveTo: new Date(when) } });
      }
      const created = await tx.rateRule.createManyAndReturn({
        data: writes.map((w) => ({
          chargeTypeId: w.type.id, hsCodeId: w.hs?.id ?? null, chapter: w.chapter,
          rate: w.figures.rate, minAmount: w.figures.minAmount, maxAmount: w.figures.maxAmount,
          confirmed: w.figures.confirmed, sourceNote: w.figures.sourceNote, effectiveFrom: w.effectiveFrom ?? at,
        })),
      });
      // createManyAndReturn keeps the order of its input on Postgres.
      const entries: AuditEntry[] = writes.map((w, i) => {
        const next = created[i]!;
        const effectiveFrom = next.effectiveFrom.toISOString();
        return w.replaces
          ? {
              actorId, action: "rate.changed", entityType: "RateRule", entityId: next.id, reason,
              oldValue: { ruleId: w.replaces.id, ...figuresOf(w.replaces) },
              newValue: { ruleId: next.id, ...figuresOf(next), effectiveFrom, via: "import" },
            }
          : {
              actorId, action: "rate.created", entityType: "RateRule", entityId: next.id, reason,
              newValue: {
                ruleId: next.id, chargeCode: w.type.code, hsCode: w.hs?.code ?? null, chapter: w.chapter,
                ...figuresOf(next), effectiveFrom, via: "import",
              },
            };
      });
      await recordAuditMany(entries, tx);
    },
  };
}

// ─── Kencole's fees ───────────────────────────────────────────────────────────

interface FeeRow {
  chargeCode: string;
  scope: "GLOBAL" | "PLAN";
  planCode: string | null;
  importType: "PERSONAL" | "COMMERCIAL" | null;
  minValue: string | null;
  maxValue: string | null;
  flatAmount: string | null;
  percentRate: string | null;
  perLineAmount: string | null;
  minFee: string | null;
  maxFee: string | null;
  priority: number;
}

const dec = (v: Prisma.Decimal | string | null) => (v == null ? "" : new Decimal(v.toString()).toFixed());
type DecimalLike = Prisma.Decimal | string | null;
interface FeeShape {
  chargeCode: string; scope: string; planCode: string | null; importType: string | null; priority: number;
  minValue: DecimalLike; maxValue: DecimalLike; flatAmount: DecimalLike; percentRate: DecimalLike;
  perLineAmount: DecimalLike; minFee: DecimalLike; maxFee: DecimalLike;
}
const feeSignature = (f: FeeShape) =>
  [f.chargeCode, f.scope, f.planCode ?? "", f.importType ?? "", dec(f.minValue), dec(f.maxValue), dec(f.flatAmount),
    dec(f.percentRate), dec(f.perLineAmount), dec(f.minFee), dec(f.maxFee), f.priority].join("|");

function describeFee(f: { flatAmount: unknown; percentRate: unknown; perLineAmount: unknown; minFee: unknown; maxFee: unknown; importType: string | null; minValue: unknown; maxValue: unknown }): string {
  const s = (v: unknown) => (v == null ? null : new Decimal(String(v)));
  const parts = [
    s(f.percentRate) ? `${s(f.percentRate)!.times(100).toFixed()}%` : null,
    s(f.flatAmount) ? `$${s(f.flatAmount)!.toFixed(2)}` : null,
    s(f.perLineAmount) ? `$${s(f.perLineAmount)!.toFixed(2)} per line` : null,
  ].filter(Boolean).join(" + ");
  const limits = [s(f.minFee) ? `min $${s(f.minFee)!.toFixed(2)}` : null, s(f.maxFee) ? `max $${s(f.maxFee)!.toFixed(2)}` : null].filter(Boolean);
  const band = s(f.minValue) || s(f.maxValue)
    ? `goods $${s(f.minValue)?.toFixed(2) ?? "0.00"}–${s(f.maxValue) ? `$${s(f.maxValue)!.toFixed(2)}` : "up"}`
    : null;
  const who = f.importType ? f.importType.toLowerCase() : null;
  return [parts || "no charge", ...limits, band, who].filter(Boolean).join(", ");
}

async function planFees(records: Record_[], client: Client): Promise<Plan> {
  const [types, plans, existing] = await Promise.all([
    client.chargeType.findMany(),
    client.plan.findMany(),
    client.pricingRule.findMany({ where: { active: true, scope: { in: ["GLOBAL", "PLAN"] } } }),
  ]);
  const fees = types.filter((t) => t.payee === "BROKER");
  const rows: PlannedRow[] = [];
  const touched = new Set<string>();
  const wanted = new Map<string, { line: number; row: FeeRow }>();
  let broken = false;

  for (const r of records) {
    const { errors, read } = cells();
    const v = r.values;
    const fee = v.fee ? matchByName(fees, v.fee) : undefined;
    if (!v.fee) errors.push("Say which fee this row is for.");
    else if (!fee) {
      errors.push(matchByName(types, v.fee)
        ? `${v.fee} is a government charge. Government rates are imported on their own sheet.`
        : `There is no Kencole fee called "${v.fee}". Use one of: ${fees.map((t) => t.label).join(", ")}.`);
    }
    const planText = v.plan!.trim();
    const everyone = !planText || ["everyone", "all", "list", "list price"].includes(planText.toLowerCase());
    const plan = everyone ? null : matchByName(plans, planText);
    if (!everyone && !plan) errors.push(`There is no plan called "${planText}". Use one of: ${plans.map((p) => p.name).join(", ") || "none yet"}, or leave it blank.`);

    const typeText = v.import_type!.trim().toLowerCase();
    let importType: FeeRow["importType"] = null;
    if (typeText === "personal") importType = "PERSONAL";
    else if (typeText === "commercial" || typeText === "business") importType = "COMMERCIAL";
    else if (typeText && !["both", "any", "all"].includes(typeText)) errors.push(`Import type is personal, commercial or blank, not "${v.import_type}".`);

    const minValue = read(() => amount(v.goods_value_from!, "goods value"), null);
    const maxValue = read(() => amount(v.goods_value_to!, "goods value"), null);
    const flatAmount = read(() => amount(v.flat!, "flat amount"), null);
    const percentRate = v.percent!.trim() ? read(() => storedRate("PERCENT_OF_CUSTOMS_VALUE", v.percent!), null) : null;
    const perLineAmount = read(() => amount(v.per_line!, "per-line amount"), null);
    const minFee = read(() => amount(v.minimum!, "minimum"), null);
    const maxFee = read(() => amount(v.maximum!, "maximum"), null);
    const priorityText = v.priority!.trim();
    const priority = priorityText ? Number(priorityText) : 100;
    if (!Number.isInteger(priority) || priority < 0 || priority > 10000) errors.push("Priority is a whole number from 0 to 10000.");
    if (percentRate && new Decimal(percentRate).greaterThan(1)) errors.push("A fee percentage cannot be more than 100%.");
    if (!flatAmount && !percentRate && !perLineAmount && errors.length === 0) errors.push("Give a flat amount, a percentage or a per-line amount.");
    if (minValue && maxValue && new Decimal(minValue).greaterThan(maxValue)) errors.push("The goods value band starts above where it ends.");
    if (minFee && maxFee && new Decimal(minFee).greaterThan(maxFee)) errors.push("The minimum is more than the maximum.");

    const label = `${fee?.label ?? (v.fee || "?")} · ${plan?.name ?? "Everyone"}`;
    const row: FeeRow = {
      chargeCode: fee?.code ?? "", scope: plan ? "PLAN" : "GLOBAL", planCode: plan?.code ?? null, importType,
      minValue, maxValue, flatAmount, percentRate, perLineAmount, minFee, maxFee, priority,
    };
    const sig = feeSignature(row);
    if (fee && wanted.has(sig)) errors.push(`The same row appears twice (row ${wanted.get(sig)!.line}).`);
    if (errors.length || !fee) { broken = true; rows.push({ line: r.line, action: "error", label, errors }); continue; }

    touched.add(fee.code);
    wanted.set(sig, { line: r.line, row });
    const kept = existing.some((e) => feeSignature(e) === sig);
    rows.push({ line: r.line, action: kept ? "unchanged" : "create", label, detail: kept ? undefined : describeFee(row), errors });
  }

  const retire = broken ? [] : existing.filter((e) => touched.has(e.chargeCode) && !wanted.has(feeSignature(e)));
  const planName = new Map(plans.map((p) => [p.code, p.name]));
  const feeLabel = new Map(fees.map((f) => [f.code, f.label]));
  for (const e of retire) {
    rows.push({
      line: null, action: "remove",
      label: `${feeLabel.get(e.chargeCode) ?? e.chargeCode} · ${e.planCode ? planName.get(e.planCode) ?? e.planCode : "Everyone"}`,
      detail: `${describeFee(e)}; not in the file, so it stops applying`,
      errors: [],
    });
  }
  const creates = [...wanted.values()].filter(({ row }) => !existing.some((e) => feeSignature(e) === feeSignature(row))).map(({ row }) => row);

  return {
    rows,
    apply: async (tx, actorId, reason) => {
      if (retire.length) await tx.pricingRule.updateMany({ where: { id: { in: retire.map((e) => e.id) } }, data: { active: false } });
      const created = creates.length ? await tx.pricingRule.createManyAndReturn({ data: creates }) : [];
      const entries: AuditEntry[] = [...touched].filter((code) =>
        retire.some((e) => e.chargeCode === code) || creates.some((c) => c.chargeCode === code),
      ).map((code) => ({
        actorId, action: "pricing.changed", entityType: "PricingRule", entityId: code, reason,
        oldValue: { retired: retire.filter((e) => e.chargeCode === code).map((e) => ({ id: e.id, rule: describeFee(e), planCode: e.planCode })) },
        newValue: { added: created.filter((c) => c.chargeCode === code).map((c) => ({ id: c.id, rule: describeFee(c), planCode: c.planCode })), via: "import" },
      }));
      await recordAuditMany(entries, tx);
    },
  };
}

// ─── Permits ──────────────────────────────────────────────────────────────────

async function planPermits(records: Record_[], client: Client): Promise<Plan> {
  const [codes, existing] = await Promise.all([
    client.hsCode.findMany({ select: { id: true, code: true } }),
    client.permitRequirement.findMany({ include: { hsCode: { select: { code: true } } } }),
  ]);
  const codeByCode = new Map(codes.map((c) => [c.code, c]));
  const sig = (p: { agency: string; permit: string; notes: string | null }) => `${p.agency}|${p.permit}|${p.notes ?? ""}`;
  const rows: PlannedRow[] = [];
  const wanted = new Map<string, Map<string, { agency: string; permit: string; notes: string | null }>>();
  let broken = false;

  for (const r of records) {
    const { errors, read } = cells();
    const v = r.values;
    const code = read(() => tariffCode(v.tariff_code!), "");
    const hs = code ? codeByCode.get(code) : undefined;
    if (code && !hs) errors.push(`Tariff code ${code} is not in the classification table. Import it on the Tariff codes sheet first.`);
    const agency = v.agency!, permit = v.permit!, notes = v.notes || null;
    if (!agency !== !permit) errors.push("Fill in both the agency and the permit, or leave both blank for none.");
    const none = !agency && !permit;
    const label = none ? `${code || v.tariff_code} · no permit` : `${code || v.tariff_code} · ${permit}`;
    const set = wanted.get(code) ?? new Map();
    if (!none && set.has(sig({ agency, permit, notes }))) errors.push("The same permit appears twice for this code.");
    if (errors.length || !hs) { broken = true; rows.push({ line: r.line, action: "error", label, errors }); continue; }

    wanted.set(code, set);
    if (none) {
      rows.push({ line: r.line, action: "unchanged", label, errors });
      continue;
    }
    set.set(sig({ agency, permit, notes }), { agency, permit, notes });
    const kept = existing.some((e) => e.hsCode.code === code && sig(e) === sig({ agency, permit, notes }));
    rows.push({ line: r.line, action: kept ? "unchanged" : "create", label, detail: kept ? undefined : agency, errors });
  }

  const remove = broken ? [] : existing.filter((e) => wanted.has(e.hsCode.code) && !wanted.get(e.hsCode.code)!.has(sig(e)));
  for (const e of remove) {
    rows.push({ line: null, action: "remove", label: `${e.hsCode.code} · ${e.permit}`, detail: `${e.agency}; not in the file, so no longer required`, errors: [] });
  }
  const creates = [...wanted.entries()].flatMap(([code, set]) =>
    [...set.values()]
      .filter((p) => !existing.some((e) => e.hsCode.code === code && sig(e) === sig(p)))
      .map((p) => ({ hsCodeId: codeByCode.get(code)!.id, code, ...p })),
  );

  return {
    rows,
    apply: async (tx, actorId, reason) => {
      if (remove.length) await tx.permitRequirement.deleteMany({ where: { id: { in: remove.map((e) => e.id) } } });
      if (creates.length) {
        await tx.permitRequirement.createMany({ data: creates.map(({ code: _code, ...p }) => p) });
      }
      await recordAuditMany([{
        actorId, action: "reference.imported", entityType: "PermitRequirement", entityId: "import", reason,
        oldValue: { removed: remove.map((e) => ({ code: e.hsCode.code, agency: e.agency, permit: e.permit, notes: e.notes })) },
        newValue: { kind: "permits", added: creates.map(({ hsCodeId: _id, ...p }) => p) },
      }], tx);
    },
  };
}

// ─── Entry points ─────────────────────────────────────────────────────────────

function authorise(p: Principal, kind: ImportKind) {
  if (!can(p.role, IMPORT_KINDS[kind].capability)) throw new DomainError("Not found.", 404);
}

async function plan(kind: ImportKind, records: Record_[], client: Client, now: Date): Promise<Plan> {
  switch (kind) {
    case "tariff-codes": return planTariffCodes(records, client);
    case "rates": return planRates(records, client, now);
    case "fees": return planFees(records, client);
    case "permits": return planPermits(records, client);
  }
}

const ORDER: Record<RowAction, number> = { error: 0, remove: 1, change: 2, create: 3, unchanged: 4 };

function summarise(kind: ImportKind, rows: PlannedRow[], fileErrors: string[]): ImportPreview {
  const counts: Record<RowAction, number> = { create: 0, change: 0, unchanged: 0, remove: 0, error: 0 };
  for (const r of rows) counts[r.action]++;
  return {
    kind,
    rows: rows.filter((r) => r.action !== "unchanged").sort((a, b) => ORDER[a.action] - ORDER[b.action] || (a.line ?? 1e9) - (b.line ?? 1e9)),
    counts,
    fileErrors,
    canApply: fileErrors.length === 0 && counts.error === 0 && counts.create + counts.change + counts.remove > 0,
  };
}

/** What the file would do. Writes nothing. */
export async function previewImport(p: Principal, kind: ImportKind, csv: string, now = new Date()): Promise<ImportPreview> {
  authorise(p, kind);
  const { records, fileErrors } = readTable(csv, IMPORT_KINDS[kind]);
  if (fileErrors.length) return summarise(kind, [], fileErrors);
  const { rows } = await plan(kind, records, db, now);
  return summarise(kind, rows, []);
}

/**
 * Checks the file again and applies it, all or nothing. Rows that would change
 * nothing are skipped. The reason is recorded on every audit entry.
 */
export async function applyImport(
  p: Principal, kind: ImportKind, csv: string, reason: string, now = new Date(),
): Promise<ImportPreview> {
  authorise(p, kind);
  const why = reason?.trim();
  if (!why) throw new DomainError("Say why you are importing this file.");
  const { records, fileErrors } = readTable(csv, IMPORT_KINDS[kind]);
  if (fileErrors.length) throw new DomainError(fileErrors[0]!);

  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: p.id } });
    if (!actor || !actor.active || actor.deletedAt || !can(actor.role, IMPORT_KINDS[kind].capability)) {
      throw new DomainError("Your account cannot make this change.", 403);
    }
    // Serialise with the Rates page and with another import, so the check below
    // sees what the write will land on.
    if (kind === "rates") {
      await tx.$queryRaw`SELECT id FROM "ChargeType" FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "RateRule" WHERE "effectiveTo" IS NULL OR "effectiveTo" > ${now} FOR UPDATE`;
    } else {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import:${kind}`}))`;
    }
    const planned = await plan(kind, records, tx, now);
    const preview = summarise(kind, planned.rows, []);
    if (preview.counts.error > 0) {
      throw new DomainError("Some rows have problems. Check the file again, fix them and try once more.", 409);
    }
    if (preview.canApply) await planned.apply(tx, actor.id, why, now);
    return preview;
  }, { timeout: 120_000, maxWait: 10_000 });
}

/** The data as it stands, in the import's own columns: a template to edit and upload. */
export async function exportReference(p: Principal, kind: ImportKind, now = new Date()): Promise<string> {
  if (!can(p.role, "rates:read") || (kind === "fees" && !can(p.role, IMPORT_KINDS.fees.capability))) {
    throw new DomainError("Not found.", 404);
  }
  const header = IMPORT_KINDS[kind].columns.map((c) => c.key);
  switch (kind) {
    case "tariff-codes": {
      const codes = await db.hsCode.findMany({ orderBy: { code: "asc" } });
      return toCsv([header, ...codes.map((c) => [c.code, c.description, c.chapter, c.active ? "yes" : "no", c.notes])]);
    }
    case "rates": {
      let rules = await db.rateRule.findMany({
        where: { chargeType: { payee: "GOVERNMENT" }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        include: { chargeType: true, hsCode: { select: { code: true } } },
      });
      // Where a change is scheduled, the file carries the scheduled rule: one row per
      // set of goods, and uploading it unchanged is then a no-op.
      const scopeKey = (r: (typeof rules)[number]) => `${r.chargeTypeId}|${r.hsCodeId ?? ""}|${r.hsCodeId ? "" : r.chapter ?? ""}`;
      const scheduled = new Set(rules.filter((r) => r.effectiveFrom > now).map(scopeKey));
      rules = rules.filter((r) => r.effectiveFrom > now || !scheduled.has(scopeKey(r)));
      rules.sort((a, b) =>
        a.chargeType.sortOrder - b.chargeType.sortOrder
        || (a.hsCode ? 2 : a.chapter ? 1 : 0) - (b.hsCode ? 2 : b.chapter ? 1 : 0)
        || (a.hsCode?.code ?? a.chapter ?? "").localeCompare(b.hsCode?.code ?? b.chapter ?? "")
        || a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
      return toCsv([header, ...rules.map((r) => {
        const basis = r.chargeType.basis as ChargeBasis;
        const rate = toInputRate(basis, r.rate.toString());
        return [
          r.chargeType.label, r.hsCode?.code ?? "", r.hsCode ? "" : r.chapter ?? "",
          isPercentBasis(basis) ? `${rate}%` : new Decimal(rate).toFixed(2),
          r.minAmount?.toFixed(2) ?? "", r.maxAmount?.toFixed(2) ?? "",
          r.effectiveFrom > now ? isoDay(r.effectiveFrom) : "",
          r.confirmed ? "yes" : "no", r.sourceNote ?? "",
        ];
      })]);
    }
    case "fees": {
      const [rules, types, plans] = await Promise.all([
        db.pricingRule.findMany({ where: { active: true, scope: { in: ["GLOBAL", "PLAN"] } }, orderBy: [{ chargeCode: "asc" }, { priority: "desc" }] }),
        db.chargeType.findMany({ where: { payee: "BROKER" } }),
        db.plan.findMany(),
      ]);
      const label = new Map(types.map((t) => [t.code, t]));
      const planName = new Map(plans.map((pl) => [pl.code, pl.name]));
      rules.sort((a, b) => (label.get(a.chargeCode)?.sortOrder ?? 0) - (label.get(b.chargeCode)?.sortOrder ?? 0));
      const m = (v: Prisma.Decimal | null) => v?.toFixed(2) ?? "";
      return toCsv([header, ...rules.map((r) => [
        label.get(r.chargeCode)?.label ?? r.chargeCode,
        r.planCode ? planName.get(r.planCode) ?? r.planCode : "",
        r.importType?.toLowerCase() ?? "",
        m(r.minValue), m(r.maxValue), m(r.flatAmount),
        r.percentRate ? `${r.percentRate.times(100).toFixed()}%` : "",
        m(r.perLineAmount), m(r.minFee), m(r.maxFee), r.priority,
      ])]);
    }
    case "permits": {
      const permits = await db.permitRequirement.findMany({ include: { hsCode: { select: { code: true } } } });
      permits.sort((a, b) => a.hsCode.code.localeCompare(b.hsCode.code) || a.permit.localeCompare(b.permit));
      return toCsv([header, ...permits.map((pm) => [pm.hsCode.code, pm.agency, pm.permit, pm.notes])]);
    }
  }
}
