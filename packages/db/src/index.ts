// Public entry point for @airadio/db (matches `main` in package.json), so
// consumers can `import { openDb } from "@airadio/db"` rather than reaching
// into subpaths.
export { openDb } from "./client.ts";
export { SCHEMA_SQL, applySchema } from "./schema.ts";
