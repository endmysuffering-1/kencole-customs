/** Customer wording for things that have internal names. */
export const INVOICE_STATUS: Record<string, string> = {
  DRAFT: "Draft", ISSUED: "Due", PARTIALLY_PAID: "Part paid", PAID: "Paid",
  OVERDUE: "Overdue", VOIDED: "Cancelled", REFUNDED: "Refunded",
};

export const DOCUMENT_KIND: Record<string, string> = {
  COMMERCIAL_INVOICE: "Commercial invoice", AIRWAY_BILL: "Air waybill", BILL_OF_LADING: "Bill of lading",
  PACKING_LIST: "Packing list", PERMIT: "Permit or licence", RECEIPT: "Receipt", CUSTOMS_ENTRY: "Customs entry",
  PROOF_OF_DELIVERY: "Proof of delivery", OTHER: "Other document",
};

export const FREIGHT_MODE: Record<string, string> = { AIR: "Air freight", SEA: "Sea freight", COURIER: "Courier" };
