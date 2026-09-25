/**
 * Reading and writing CSV, the format every spreadsheet can save as.
 *
 * RFC 4180: comma-separated, fields in double quotes may hold commas, line
 * breaks and doubled quotes. Excel adds a byte-order mark and CRLF line
 * endings; both are accepted. Blank lines are skipped.
 */

export class CsvError extends Error {}

export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    if (row.some((f) => f.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === "") { field = ""; quoted = true; i++; continue; }
    if (c === ",") { endField(); i++; continue; }
    if (c === "\r") { endRow(); i += src[i + 1] === "\n" ? 2 : 1; continue; }
    if (c === "\n") { endRow(); i++; continue; }
    field += c; i++;
  }
  if (quoted) throw new CsvError("A quoted field is never closed. Check for a stray quote mark.");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Formula-looking text is prefixed with an apostrophe so a spreadsheet shows it
 * rather than running it (CSV injection). Nothing this app exports starts that
 * way on purpose, but descriptions and notes are free text.
 */
function cell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?%?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
