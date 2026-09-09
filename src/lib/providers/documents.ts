import { env } from "@/lib/env";

/**
 * Invoice data extraction.
 *
 * Whatever comes back from here is a proposal shown next to the document for a
 * human to confirm. It never writes straight to a declaration, and the original
 * extraction is kept alongside every correction so a disputed value can always be
 * traced back to what the paperwork actually said.
 */

export interface ExtractedLine {
  description: string;
  quantity?: number;
  unitCost?: number;
  lineTotal?: number;
  countryOfOrigin?: string;
}

export interface ExtractedInvoice {
  seller?: string;
  buyer?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  currency?: string;
  goodsTotal?: number;
  freight?: number;
  insurance?: number;
  countryOfOrigin?: string;
  trackingNumber?: string;
  lines: ExtractedLine[];
  /** 0–1. Anything under 0.8 lands in the operations queue rather than the customer's form. */
  confidence: number;
}

export interface DocumentProvider {
  readonly name: string;
  extractInvoice(input: { body: Buffer; mimeType: string; fileName: string }): Promise<ExtractedInvoice>;
}

/**
 * Development provider. Returns an empty extraction with zero confidence rather
 * than inventing plausible figures — a fake seller name on a customs entry is a
 * far more expensive bug than an empty form.
 */
class MockDocumentProvider implements DocumentProvider {
  readonly name = "mock";
  async extractInvoice(): Promise<ExtractedInvoice> {
    return { lines: [], confidence: 0 };
  }
}

class ExternalDocumentProvider implements DocumentProvider {
  readonly name = "external";
  async extractInvoice(input: { body: Buffer; mimeType: string; fileName: string }) {
    if (!env.DOCUMENT_AI_URL || !env.DOCUMENT_AI_KEY) {
      throw new Error("DOCUMENT_AI_URL and DOCUMENT_AI_KEY are required for the external provider.");
    }
    const res = await fetch(env.DOCUMENT_AI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.DOCUMENT_AI_KEY}`,
      },
      body: JSON.stringify({
        fileName: input.fileName,
        mimeType: input.mimeType,
        content: input.body.toString("base64"),
      }),
    });
    if (!res.ok) throw new Error(`Extraction failed with status ${res.status}.`);
    const data = (await res.json()) as Partial<ExtractedInvoice>;
    return { lines: data.lines ?? [], confidence: data.confidence ?? 0, ...data };
  }
}

export const documentAi: DocumentProvider =
  env.DOCUMENT_AI_PROVIDER === "external" ? new ExternalDocumentProvider() : new MockDocumentProvider();

export const EXTRACTION_REVIEW_THRESHOLD = 0.8;
