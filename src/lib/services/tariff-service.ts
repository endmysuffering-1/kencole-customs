import { db } from "@/lib/db";

/** Public: tariff headings by code prefix or words in the description. The tariff is public. */
export async function searchTariff(q: string, take = 20) {
  const query = q.trim();
  return db.hsCode.findMany({
    where: {
      active: true,
      ...(query ? { OR: [{ code: { startsWith: query } }, { description: { contains: query, mode: "insensitive" } }] } : {}),
    },
    orderBy: { code: "asc" },
    take,
    select: { code: true, description: true, chapter: true },
  });
}
