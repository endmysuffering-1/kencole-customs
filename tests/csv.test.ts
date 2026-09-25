import { describe, expect, it } from "vitest";
import { CsvError, parseCsv, toCsv } from "@/lib/csv";

describe("reading CSV", () => {
  it("reads quoted fields holding commas, quotes and line breaks", () => {
    const rows = parseCsv('code,description\r\n8471.30.00,"Laptops, notebooks"\r\n2208.40.00,"Rum ""dark""\nand light"\r\n');
    expect(rows).toEqual([
      ["code", "description"],
      ["8471.30.00", "Laptops, notebooks"],
      ["2208.40.00", 'Rum "dark"\nand light'],
    ]);
  });

  it("drops Excel's byte-order mark and skips blank lines", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n,\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps empty cells, and a last row without a line break", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });

  it("refuses a quote that is never closed", () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvError);
  });
});

describe("writing CSV", () => {
  it("quotes what needs quoting and reads back the same", () => {
    const rows = [["code", "note"], ["1", 'has "quotes", commas\nand lines'], ["2", null]];
    expect(parseCsv(toCsv(rows))).toEqual([["code", "note"], ["1", 'has "quotes", commas\nand lines'], ["2", ""]]);
  });

  it("stops a spreadsheet running free text as a formula, but leaves numbers alone", () => {
    expect(toCsv([["=HYPERLINK(1)", "-5", "-12.5%", "+x"]])).toBe("'=HYPERLINK(1),-5,-12.5%,'+x\r\n");
  });
});
