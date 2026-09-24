import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { handle, json } from "@/lib/api/respond";
import { MAX_UPLOAD_BYTES, UploadRejected } from "@/lib/providers/storage";
import { uploadDocument } from "@/lib/services/document-service";
import { documentKindSchema } from "@/lib/validation/schemas";
import { DomainError } from "@/lib/services/errors";

const fields = z.object({ shipmentId: z.string().cuid(), kind: documentKindSchema });

/** multipart/form-data: shipmentId, kind, file. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  const form = await req.formData().catch(() => {
    throw new DomainError("Send the upload as multipart/form-data.");
  });
  const { shipmentId, kind } = fields.parse({ shipmentId: form.get("shipmentId"), kind: form.get("kind") });
  const file = form.get("file");
  if (!(file instanceof File)) throw new UploadRejected("Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadRejected("That file is larger than 20 MB. Split it or send a smaller scan.");

  const document = await uploadDocument({
    principal: user, shipmentId, kind,
    file: { name: file.name, type: file.type, body: Buffer.from(await file.arrayBuffer()) },
  });
  return json({ document: { id: document.id, kind: document.kind, fileName: document.fileName } }, 201);
});
