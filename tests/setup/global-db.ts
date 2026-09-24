import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { testDatabaseUrl } from "./test-database";

/** Runs once per `vitest run`: a fresh test database with every migration applied,
 *  so the integration tests exercise the real schema, constraints and SQL. */
export default async function setup() {
  const url = testDatabaseUrl();
  const name = new URL(url).pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  admin.search = "";
  const client = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    // `name` is validated by testDatabaseUrl() to [A-Za-z0-9_]+_test.
    await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await client.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
