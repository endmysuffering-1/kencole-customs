import { Badge } from "@/components/ui/badge";

const TONE = { CRITICAL: "alert", WARNING: "warn", INFO: "neutral" } as const;

export function SeverityBadge({ severity }: { severity: keyof typeof TONE }) {
  return <Badge tone={TONE[severity]}>{severity.charAt(0) + severity.slice(1).toLowerCase()}</Badge>;
}
