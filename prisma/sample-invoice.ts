/**
 * A one-page PDF standing in for a supplier's commercial invoice, so seeded
 * shipments have a document the broker review screen can show. Plain text in
 * Helvetica, built by hand to avoid a PDF dependency for seed data. Every page
 * says it is sample data.
 */
export function sampleInvoicePdf(input: {
  reference: string;
  supplier: string;
  date: Date;
  lines: { description: string; quantity: string; unitValue: string; lineValue: string }[];
  goodsValue: string;
}): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?");
  const text: [number, number, number, string][] = [
    [50, 780, 9, "SAMPLE DOCUMENT - SEED DATA, NOT A REAL INVOICE"],
    [50, 740, 20, "COMMERCIAL INVOICE"],
    [50, 712, 11, `Seller: ${input.supplier}`],
    [50, 696, 11, `Date: ${input.date.toISOString().slice(0, 10)}`],
    [50, 680, 11, `Buyer reference: ${input.reference}`],
    [50, 640, 10, "Description"],
    [330, 640, 10, "Qty"],
    [390, 640, 10, "Unit USD"],
    [480, 640, 10, "Total USD"],
  ];
  let y = 620;
  for (const l of input.lines) {
    text.push([50, y, 10, l.description.slice(0, 48)], [330, y, 10, l.quantity], [390, y, 10, l.unitValue], [480, y, 10, l.lineValue]);
    y -= 18;
  }
  text.push([390, y - 12, 11, "TOTAL"], [480, y - 12, 11, input.goodsValue]);

  const content = text.map(([x, ty, size, s]) => `BT /F1 ${size} Tf ${x} ${ty} Td (${esc(s)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
