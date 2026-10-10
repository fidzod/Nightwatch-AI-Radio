// Standalone entry point: creates data/airadio.sqlite3 and applies the
// schema if it doesn't already exist. Run via `pnpm --filter @airadio/db init`.
import { openDb } from "./client.ts";

const db = openDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all() as { name: string }[];

console.log(`Database initialized. Tables: ${tables.map((t) => t.name).join(", ")}`);
db.close();
