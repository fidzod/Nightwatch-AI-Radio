import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applySchema } from "./schema.ts";

const DEFAULT_DB_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "data",
  "airadio.sqlite3",
);

export function openDb(path: string = DEFAULT_DB_PATH): DatabaseSync {
  const db = new DatabaseSync(path);
  applySchema(db);
  return db;
}
