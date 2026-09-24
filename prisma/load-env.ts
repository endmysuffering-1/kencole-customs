import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Imported first by seed.ts, as a module of its own, because ES imports are
// hoisted: code written between import statements runs only after every
// imported module has been evaluated. A module imported first is evaluated first.
//
// `prisma migrate dev` / `prisma db seed` load .env before running the seed, but
// a plain `tsx prisma/seed.ts` (npm run db:seed) does not.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);
