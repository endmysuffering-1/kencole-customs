import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { canAccessResource, type Principal } from "@/lib/auth/rbac";
import { scanner, storage, UploadRejected, validateUpload } from "@/lib/providers/storage";
import { documentAi } from "@/lib/providers/documents";
import type { documentKindSchema } from "@/lib/validation/schemas";
import type { z } from "zod";
import { DomainError } from "./errors";
import { shipmentScope } from "./shipment-queries";
import { refreshExceptions, transitionShipment } from "./shipment-service";

type DocumentKind = z.infer<typeof documentKindSchema>;

/**
 * Attaches a document to a shipment. The file is checked (size, declared type
 * and its own magic bytes) before anything touches disk, and scanned before it
 * is kept. A commercial invoice arriving on a shipment still waiting for one
 * moves it on to DOCUMENTS_RECEIVED.
 *
 * Whatever the extraction provider reads is stored beside the document as a
 * proposal for a person to confirm. It never writes to the shipment itself.
 */
export async function uploadDocument(input: {
  principal: Principal;
  shipmentId: string;
  kind: DocumentKind;
  file: { name: string; type: string; body: Buffer };
}) {
  const { principal, shipmentId, kind, file } = input;
  const shipment = await db.shipment.findFirst({ where: { AND: [shipmentScope(principal), { id: shipmentId }] } });
  if (!shipment || !canAccessResource(principal, shipment, "write")) throw new DomainError("Shipment not found.", 404);
  if (shipment.status === "DELIVERED" || shipment.status === "CANCELLED") {
    throw new DomainError("Documents can't be added to a finished shipment.", 409);
  }

  validateUpload({ mimeType: file.type, sizeBytes: file.body.byteLength, body: file.body });
  const scanStatus = await scanner.scan(file.body);
  if (scanStatus === "INFECTED") throw new UploadRejected("That file failed the virus scan.");

  const stored = await storage.put({
    body: file.body, contentType: file.type, fileName: file.name, prefix: `shipments/${shipment.id}`,
  });

  let document;
  try {
    document = await db.$transaction(async (tx) => {
      const created = await tx.shipmentDocument.create({
        data: {
          shipmentId: shipment.id, kind, fileName: file.name.slice(0, 200), mimeType: file.type,
          sizeBytes: stored.sizeBytes, storageKey: stored.key, checksum: stored.checksum, scanStatus,
          uploadedBy: principal.id,
        },
      });
      await recordAudit(
        {
          actorId: principal.id, action: "document.uploaded", entityType: "ShipmentDocument", entityId: created.id,
          newValue: { shipment: shipment.reference, kind, fileName: created.fileName, checksum: stored.checksum },
        },
        tx,
      );
      return created;
    });
  } catch (e) {
    // No record points at the file, so it must not stay on disk.
    await storage.remove(stored.key);
    throw e;
  }

  if (kind === "COMMERCIAL_INVOICE") {
    const extraction = await documentAi
      .extractInvoice({ body: file.body, mimeType: file.type, fileName: file.name })
      .catch((e) => {
        console.error("invoice extraction failed", e);
        return null;
      });
    if (extraction) {
      await db.documentExtraction.create({
        data: {
          documentId: document.id,
          provider: documentAi.name,
          rawJson: extraction as unknown as Prisma.InputJsonValue,
          extractedJson: extraction as unknown as Prisma.InputJsonValue,
          confidence: extraction.confidence.toFixed(3),
        },
      });
    }
    if (shipment.status === "DRAFT" || shipment.status === "DOCUMENTS_REQUIRED") {
      await transitionShipment({
        shipmentId: shipment.id, to: "DOCUMENTS_RECEIVED", actorId: principal.id, note: "Commercial invoice uploaded",
      });
    }
  }

  await refreshExceptions(shipment.id);
  return document;
}

/** A document's bytes, for anyone who may see its shipment. */
export async function readDocument(principal: Principal, documentId: string) {
  const document = await db.shipmentDocument.findFirst({
    where: { id: documentId, deletedAt: null, shipment: shipmentScope(principal) },
  });
  if (!document) throw new DomainError("Document not found.", 404);
  const body = await storage.get(document.storageKey).catch((e: NodeJS.ErrnoException) => {
    // The record outlived its file. Say so, rather than failing as a server error.
    if (e.code === "ENOENT") throw new DomainError("The file for this document is missing from storage.", 404);
    throw e;
  });
  return { document, body };
}
