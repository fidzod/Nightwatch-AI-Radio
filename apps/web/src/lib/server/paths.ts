import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walk up from this module until we find the monorepo root (identified by
 * `pnpm-workspace.yaml`). Everything on disk — the sqlite file, the audio
 * library — is anchored to the repo root, not to `apps/web`.
 */
function findRepoRoot(): string {
	const override = process.env.AIRADIO_ROOT;
	if (override) return resolve(override);

	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 12; i++) {
		if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	// last resort: cwd is apps/web when `vite dev` runs there
	return resolve(process.cwd(), '..', '..');
}

export const REPO_ROOT = findRepoRoot();
export const DB_PATH = join(REPO_ROOT, 'data', 'airadio.sqlite3');
export const AUDIO_LIBRARY_DIR = join(REPO_ROOT, 'audio', 'library');
export const AUDIO_GENERATED_DIR = join(REPO_ROOT, 'audio', 'generated');

/** Filesystem-safe directory name for a collection. */
export function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
	return slug || 'collection';
}
