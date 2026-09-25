import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { handle, json, parseBody } from "@/lib/api/respond";
import { applyImport, isImportKind, previewImport } from "@/lib/services/reference-import";
import { DomainError } from "@/lib/services/errors";

type Ctx = { params: Promise<{ kind: string }> };

// A full tariff schedule is thousands of rows; applying it takes a while.
export const maxDuration = 120;

const body = z.object({
  csv: z.string().max(4_500_000, "That file is larger than 4 MB. Split it into smaller files."),
  /** Omitted or false: check the file and report. True: apply it. */
  apply: z.boolean().optional(),
  reason: z.string().trim().max(1000).optional(),
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser();
  const kind = (await params).kind;
  if (!isImportKind(kind)) throw new DomainError("Not found.", 404);
  const input = await parseBody(req, body);
  const result = input.apply
    ? await applyImport(user, kind, input.csv, input.reason ?? "")
    : await previewImport(user, kind, input.csv);
  return json(result);
});
