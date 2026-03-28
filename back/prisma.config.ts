import { defineConfig } from "prisma/config";

/**
 * URL для CLI (generate, db push, migrate). В Docker при сборке переменной нет —
 * нужна синтаксически валидная заглушка; в рантайме и при db push используется реальный DATABASE_URL.
 */
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://user:password@127.0.0.1:5432/dnd_canvas";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
