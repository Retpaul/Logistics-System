import "dotenv/config";

/** Same server and credentials as DATABASE_URL, but always the bike_dispatch_test database. */
export function testDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error("Set DATABASE_URL (or TEST_DATABASE_URL) in .env to run the tests");
  const url = new URL(base);
  url.pathname = "/bike_dispatch_test";
  return url.toString();
}
