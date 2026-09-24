export const CLASSIFICATION_TONE = {
  UNCLASSIFIED: "neutral",
  AI_SUGGESTED: "neutral",
  NEEDS_REVIEW: "warn",
  BROKER_APPROVED: "good",
  EXCEPTION: "alert",
} as const satisfies Record<string, "neutral" | "warn" | "good" | "alert">;

const LABELS: Record<string, string> = {
  UNCLASSIFIED: "Unclassified",
  AI_SUGGESTED: "Suggested",
  NEEDS_REVIEW: "Needs review",
  BROKER_APPROVED: "Broker approved",
  EXCEPTION: "Exception",
};

export const classificationLabel = (s: string | undefined) => LABELS[s ?? "UNCLASSIFIED"] ?? s ?? "Unclassified";
