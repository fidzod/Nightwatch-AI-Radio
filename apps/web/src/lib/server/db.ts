// Server-only SQLite access for the web app. SvelteKit refuses to bundle
// anything under `src/lib/server/` into client code, so this module (and the
// `node:sqlite` handle it owns) can never leak to the browser.
import { openDb } from '@airadio/db';
import type { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './paths.ts';
import { seedIfEmpty } from './seed.ts';

// Cached on globalThis so vite's HMR re-evaluating this module doesn't leave
// orphaned database handles behind.
const CACHE_KEY = Symbol.for('airadio.web.db');
type Cache = { db: DatabaseSync };
const globalCache = globalThis as unknown as Record<symbol, Cache | undefined>;

export function getDb(): DatabaseSync {
	let cached = globalCache[CACHE_KEY];
	if (!cached) {
		const db = openDb(DB_PATH);
		db.exec('PRAGMA journal_mode = WAL;');
		db.exec('PRAGMA foreign_keys = ON;');
		seedIfEmpty(db);
		cached = { db };
		globalCache[CACHE_KEY] = cached;
	}
	return cached.db;
}

/** `db.prepare(sql).all(...)` with a result type. */
export function all<T>(sql: string, ...params: unknown[]): T[] {
	return getDb()
		.prepare(sql)
		.all(...(params as never[])) as T[];
}

/** `db.prepare(sql).get(...)` with a result type. */
export function one<T>(sql: string, ...params: unknown[]): T | undefined {
	return getDb()
		.prepare(sql)
		.get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: unknown[]) {
	return getDb()
		.prepare(sql)
		.run(...(params as never[]));
}

/** SQLite has no boolean type; checkbox values arrive as 'on' | null. */
export function boolInt(value: FormDataEntryValue | null): number {
	return value === null || value === undefined || value === 'false' ? 0 : 1;
}

/** Empty form fields should land as NULL, not ''. */
export function nullable(value: FormDataEntryValue | null): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed === '' ? null : trimmed;
}

export const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
