import { z } from "zod";
import { db } from "@/lib/db";
import { handle, json, parseQuery } from "@/lib/api/respond";

const query = z.object({ q: z.string().trim().max(60).default("") });

/** Public: tariff headings for the calculator's picker. The tariff is public. */
export const GET = handle(async (req) => {
  const { q } = parseQuery(req, query);
  const codes = await db.hsCode.findMany({
    where: {
      active: true,
      ...(q ? { OR: [{ code: { startsWith: q } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { code: "asc" },
    take: 20,
    select: { code: true, description: true },
  });
  return json({ codes });
});
