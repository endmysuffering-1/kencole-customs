import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./tests/setup/test-database";

if (existsSync(resolve(__dirname, ".env"))) process.loadEnvFile(resolve(__dirname, ".env"));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-db.ts"],
    setupFiles: ["tests/setup/quiet.ts"],
    // Integration files share one database and reset it between tests.
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl(),
      SESSION_SECRET: process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-characters-long",
      EMAIL_PROVIDER: "console",
    },
  },
  resolve: { alias: { "@": resolve(__dirname, "./src") } },
});
