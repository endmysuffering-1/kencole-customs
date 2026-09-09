import type { ShipmentStatus } from "@/lib/domain/shipment-state";

/**
 * Click2Clear boundary.
 *
 * The Bahamas processes entries through Click2Clear. There is no open public API
 * for it, and this application does not pretend otherwise: the default adapter
 * produces a structured entry summary for a licensed declarant to key in, and
 * records the entry number that comes back.
 *
 * Nothing in this file scrapes a portal, replays a session or automates a login.
 * If a sanctioned integration is granted later, implement CustomsAdapter against
 * it and the rest of the application does not change.
 */

export interface DeclarationLine {
  lineNumber: number;
  description: string;
  hsCode: string;
  originCountry: string;
  quantity: string;
  customsValue: string;
  dutyEstimate: string;
}

export interface DeclarationPayload {
  shipmentReference: string;
  importerName: string;
  importerNumber?: string | null;
  supplierName?: string | null;
  supplierCountry?: string | null;
  transportDocument?: string | null;
  freightMode: string;
  currency: string;
  goodsValue: string;
  freight: string;
  insurance: string;
  customsValue: string;
  lines: DeclarationLine[];
  preparedAt: string;
  preparedBy: string;
}

export interface SubmissionResult {
  adapter: string;
  status: "PREPARED" | "SUBMITTED";
  entryNumber?: string;
  message: string;
}

export interface CustomsAdapter {
  readonly name: string;
  /** Whether the entry can be transmitted from inside the application. */
  readonly canTransmit: boolean;
  prepare(payload: DeclarationPayload): Promise<SubmissionResult>;
  /** Only meaningful when canTransmit is true. */
  transmit?(payload: DeclarationPayload): Promise<SubmissionResult>;
}

class ManualAdapter implements CustomsAdapter {
  readonly name = "manual";
  readonly canTransmit = false;

  async prepare(payload: DeclarationPayload): Promise<SubmissionResult> {
    return {
      adapter: this.name,
      status: "PREPARED",
      message:
        `Entry summary ready for ${payload.shipmentReference}. ` +
        `Key it into Click2Clear and record the entry number here.`,
    };
  }
}

export const customs: CustomsAdapter = new ManualAdapter();

/** Statuses staff may record against a declaration after submission. */
export const DECLARATION_STATUSES: ShipmentStatus[] = [
  "SUBMITTED_TO_CUSTOMS", "CUSTOMS_REVIEW", "CUSTOMS_HOLD", "DUTIES_DUE", "CUSTOMS_RELEASED",
];
