import { requireUser } from "@/lib/auth/session";
import { handle } from "@/lib/api/respond";
import { exportReference, isImportKind } from "@/lib/services/reference-import";
import { DomainError } from "@/lib/services/errors";

type Ctx = { params: Promise<{ kind: string }> };

/** The current data in the import's columns, to edit in a spreadsheet and upload again. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  const kind = (await params).kind;
  if (!isImportKind(kind)) throw new DomainError("Not found.", 404);
  const csv = await exportReference(user, kind);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kencole-${kind}-${day}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
