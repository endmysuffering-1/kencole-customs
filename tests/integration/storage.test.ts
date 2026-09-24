import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DatabaseStorage } from "@/lib/providers/storage";
import { resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);

describe("database storage", () => {
  const storage = new DatabaseStorage();
  const PDF = Buffer.from("%PDF-1.4\nsample\n%%EOF\n");

  it("returns exactly the bytes it was given, under a key it chose", async () => {
    const stored = await storage.put({ body: PDF, contentType: "application/pdf", fileName: "my invoice (1).pdf", prefix: "shipments/abc" });
    expect(stored.key).toMatch(/^shipments\/abc\/[0-9a-f-]{36}-my_invoice__1_\.pdf$/);
    expect(stored.sizeBytes).toBe(PDF.byteLength);
    expect((await storage.get(stored.key)).equals(PDF)).toBe(true);
  });

  it("answers a missing object the way the disk provider does, so callers can tell", async () => {
    const stored = await storage.put({ body: PDF, contentType: "application/pdf", fileName: "x.pdf", prefix: "p" });
    await storage.remove(stored.key);
    await expect(storage.get(stored.key)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(storage.remove(stored.key)).resolves.toBeUndefined();
    expect(await db.storedObject.count()).toBe(0);
  });
});
