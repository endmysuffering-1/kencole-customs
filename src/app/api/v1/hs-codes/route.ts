import { z } from "zod";
import { handle, json, parseQuery } from "@/lib/api/respond";
import { searchTariff } from "@/lib/services/tariff-service";

const query = z.object({ q: z.string().trim().max(60).default("") });

/** Public: tariff headings for the calculator's picker. The tariff is public. */
export const GET = handle(async (req) => {
  const { q } = parseQuery(req, query);
  const codes = (await searchTariff(q)).map(({ code, description }) => ({ code, description }));
  return json({ codes });
});
