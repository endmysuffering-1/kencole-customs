import { requireUser } from "@/lib/auth/session";
import { handle } from "@/lib/api/respond";
import { readDocument } from "@/lib/services/document-service";

type Ctx = { params: Promise<{ id: string }> };

/** Viewable in place: the broker review screen shows these beside the data. */
const INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  const { document, body } = await readDocument(user, (await params).id);
  const safeName = document.fileName.replace(/[^\w.\-]/g, "_");
  const disposition = INLINE.has(document.mimeType) ? "inline" : "attachment";
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${disposition}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
});
