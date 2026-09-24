/**
 * The database the integration tests run against. It is dropped and recreated
 * on every run, so it must never be one anyone cares about: the name has to end
 * in `_test` and the host has to be local.
 *
 * TEST_DATABASE_URL wins if set; otherwise it is DATABASE_URL with `_test`
 * appended to the database name.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/kencole";
  const url = new URL(base);
  if (!explicit) url.pathname = `${url.pathname}_test`;

  const name = url.pathname.slice(1);
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(`Refusing to use "${name}" as the test database: its name must end in _test.`);
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (!local && process.env.TEST_DB_ALLOW_NON_LOCAL !== "1") {
    throw new Error(
      `Refusing to recreate a test database on ${url.hostname}. Set TEST_DB_ALLOW_NON_LOCAL=1 ` +
      "if that server is disposable.",
    );
  }
  return url.toString();
}
