import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env on its own. Hosted platforms inject variables directly.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on variables already in the environment.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema/index.ts",
  out: "./src/database/migrations",
  dbCredentials: {
    // Migrations prefer the session pooler (port 5432); the app itself uses DATABASE_URL (transaction pooler, 6543).
    url: process.env.DATABASE_URL_MIGRATIONS?.trim() || process.env.DATABASE_URL || "",
  },
  strict: true,
  verbose: true,
});
