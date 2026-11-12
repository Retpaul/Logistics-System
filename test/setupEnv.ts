// Runs before each test file imports the app, so config and Prisma see the test database.
import { testDatabaseUrl } from "./testDb.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_ACCESS_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.REFRESH_REUSE_GRACE_MS = "0";
