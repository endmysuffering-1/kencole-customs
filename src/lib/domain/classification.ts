/**
 * Classification assistance.
 *
 * This module suggests. It never decides. Every suggestion carries a confidence
 * score and a provenance, and anything below the review threshold is routed to a
 * licensed broker before it can reach a declaration.
 *
 * The strongest signal available is not a model — it is history. If this broker
 * has already classified the same product from the same supplier and stood behind
 * it, that prior approval outranks anything else on offer.
 */

export type ClassificationStatus =
  | "UNCLASSIFIED"
  | "AI_SUGGESTED"
  | "NEEDS_REVIEW"
  | "BROKER_APPROVED"
  | "EXCEPTION";

export type SuggestionSource = "BROKER_HISTORY" | "PRODUCT_LIBRARY" | "KEYWORD" | "MODEL";

export interface Suggestion {
  hsCode: string;
  description: string;
  confidence: number;
  source: SuggestionSource;
  rationale: string;
}

export interface HistoricalClassification {
  hsCode: string;
  description: string;
  itemDescription: string;
  supplierId?: string | null;
  approvedAt: Date;
}

/** Below this, a broker looks at it. Deliberately high — the cost of a wrong
 *  classification lands on the broker's licence, not on the model. */
export const REVIEW_THRESHOLD = 0.9;

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSimilarity(a: string, b: string): number {
  const at = new Set(normalise(a).split(" ").filter((t) => t.length > 2));
  const bt = new Set(normalise(b).split(" ").filter((t) => t.length > 2));
  if (at.size === 0 || bt.size === 0) return 0;
  let shared = 0;
  at.forEach((t) => { if (bt.has(t)) shared += 1; });
  return shared / Math.max(at.size, bt.size);
}

export function suggestFromHistory(
  itemDescription: string,
  supplierId: string | null | undefined,
  history: HistoricalClassification[],
): Suggestion | null {
  let best: { entry: HistoricalClassification; score: number } | null = null;

  for (const entry of history) {
    let score = tokenSimilarity(itemDescription, entry.itemDescription);
    if (score === 0) continue;
    // Same supplier, same wording is about as certain as this gets short of
    // opening the box, so it is allowed to clear the review threshold.
    if (supplierId && entry.supplierId === supplierId) score = Math.min(1, score + 0.15);
    if (!best || score > best.score) best = { entry, score };
  }

  if (!best || best.score < 0.5) return null;

  return {
    hsCode: best.entry.hsCode,
    description: best.entry.description,
    confidence: Number(best.score.toFixed(3)),
    source: "BROKER_HISTORY",
    rationale:
      supplierId && best.entry.supplierId === supplierId
        ? "You approved this code for the same item from this supplier before."
        : "You approved this code for a closely matching item before.",
  };
}

export interface KeywordRule {
  hsCode: string;
  description: string;
  keywords: string[];
  /** Regulated goods stay under the threshold no matter how well they match. */
  alwaysReview?: boolean;
}

/** Broad first-pass rules. The real precision comes from broker history below. */
export const KEYWORD_RULES: KeywordRule[] = [
  { hsCode: "8471.30.00", description: "Portable computers", keywords: ["laptop", "notebook computer", "macbook"] },
  { hsCode: "8517.13.00", description: "Smartphones", keywords: ["smartphone", "iphone", "mobile phone", "android phone"] },
  { hsCode: "6109.10.00", description: "T-shirts, cotton, knitted", keywords: ["t-shirt", "tee shirt", "cotton shirt"] },
  { hsCode: "9403.20.00", description: "Other metal furniture", keywords: ["shelving", "metal rack", "office furniture"] },
  { hsCode: "8708.99.00", description: "Motor vehicle parts", keywords: ["brake pad", "car part", "vehicle part", "alternator"] },
  { hsCode: "2208.40.00", description: "Rum and other spirits from cane", keywords: ["rum", "spirits"], alwaysReview: true },
  { hsCode: "3004.90.00", description: "Medicaments, packaged", keywords: ["medicine", "pharmaceutical", "prescription"], alwaysReview: true },
  { hsCode: "0303.00.00", description: "Fish, frozen", keywords: ["frozen fish", "seafood"], alwaysReview: true },
];

export function suggestFromKeywords(
  itemDescription: string,
  rules: KeywordRule[],
): Suggestion | null {
  const text = normalise(itemDescription);
  let best: { rule: KeywordRule; hits: number } | null = null;

  for (const rule of rules) {
    const hits = rule.keywords.filter((k) => text.includes(normalise(k))).length;
    if (hits === 0) continue;
    if (!best || hits > best.hits) best = { rule, hits };
  }
  if (!best) return null;

  const raw = Math.min(0.85, 0.45 + best.hits * 0.12);
  return {
    hsCode: best.rule.hsCode,
    description: best.rule.description,
    confidence: best.rule.alwaysReview ? Math.min(raw, 0.6) : raw,
    source: "KEYWORD",
    rationale: best.rule.alwaysReview
      ? "Matched on description, but this category is regulated and always needs a broker."
      : "Matched on the goods description.",
  };
}

export function rankSuggestions(suggestions: (Suggestion | null)[]): Suggestion[] {
  const priority: Record<SuggestionSource, number> = {
    BROKER_HISTORY: 3, PRODUCT_LIBRARY: 2, MODEL: 1, KEYWORD: 0,
  };
  return suggestions
    .filter((s): s is Suggestion => s !== null)
    .sort((a, b) =>
      b.confidence - a.confidence || priority[b.source] - priority[a.source]);
}

export function statusForSuggestion(top: Suggestion | undefined): ClassificationStatus {
  if (!top) return "UNCLASSIFIED";
  return top.confidence >= REVIEW_THRESHOLD ? "AI_SUGGESTED" : "NEEDS_REVIEW";
}

/** A shipment can only be declared when every line carries a broker's approval. */
export function readyForDeclaration(statuses: ClassificationStatus[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s === "BROKER_APPROVED");
}
