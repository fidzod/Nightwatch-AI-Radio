import { error, fail, redirect } from '@sveltejs/kit';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { all, nullable, one, run } from '#lib/server/db.ts';
import { probeAudio, safeFileName, sha256 } from '#lib/server/audio.ts';
import { AUDIO_LIBRARY_DIR, slugify } from '#lib/server/paths.ts';
import type { Collection, Track } from '#lib/types.ts';
import type { Actions, PageServerLoad } from './$types';

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|opus|wav)$/i;

function loadCollection(id: number): Collection {
	const collection = one<Collection>('SELECT * FROM collections WHERE id = ?', id);
	if (!collection) error(404, 'No such collection');
	return collection;
}

export const load: PageServerLoad = ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(400, 'Bad collection id');
	const collection = loadCollection(id);

	const tracks = all<Track>(
		'SELECT * FROM tracks WHERE collection_id = ? ORDER BY sort_order, id',
		id
	);

	const slots = all<{ id: number; presenter_name: string; day_of_week: number | null; start_time: string; end_time: string }>(
		`SELECT s.id, p.name AS presenter_name, s.day_of_week, s.start_time, s.end_time
		 FROM schedule_slots s JOIN presenters p ON p.id = s.presenter_id
		 WHERE s.collection_id = ? ORDER BY s.day_of_week, s.start_time`,
		id
	);

	return {
		collection,
		tracks,
		slots,
		libraryDir: join(AUDIO_LIBRARY_DIR, slugify(collection.name))
	};
};

export const actions: Actions = {
	/** Edit name / mood / description. */
	update: async ({ request, params }) => {
		const id = Number(params.id);
		const form = await request.formData();
		const name = nullable(form.get('name'));
		if (!name) return fail(400, { error: 'A collection needs a name.' });

		const clash = one<{ id: number }>(
			'SELECT id FROM collections WHERE name = ? AND id <> ?',
			name,
			id
		);
		if (clash) return fail(400, { error: `"${name}" is already taken by another collection.` });

		run(
			`UPDATE collections
			 SET name = ?, mood_tag = ?, description = ?, updated_at = datetime('now')
			 WHERE id = ?`,
			name,
			nullable(form.get('mood_tag')),
			nullable(form.get('description')),
			id
		);
		return { ok: 'Collection updated.' };
	},

	/** Upload one or more audio files into this collection. */
	upload: async ({ request, params }) => {
		const id = Number(params.id);
		const collection = loadCollection(id);
		const form = await request.formData();

		const files = form
			.getAll('files')
			.filter((entry): entry is File => entry instanceof File && entry.size > 0);

		if (files.length === 0) return fail(400, { error: 'No files selected.' });

		const dir = join(AUDIO_LIBRARY_DIR, slugify(collection.name));
		mkdirSync(dir, { recursive: true });

		const maxOrder =
			one<{ m: number | null }>(
				'SELECT MAX(sort_order) AS m FROM tracks WHERE collection_id = ?',
				id
			)?.m ?? -1;

		let order = maxOrder + 1;
		const added: string[] = [];
		const skipped: string[] = [];

		for (const file of files) {
			const name = safeFileName(file.name);
			if (!AUDIO_EXT.test(name)) {
				skipped.push(`${name} (not an audio file)`);
				continue;
			}

			const bytes = new Uint8Array(await file.arrayBuffer());
			const checksum = sha256(bytes);

			const duplicate = one<{ id: number }>(
				'SELECT id FROM tracks WHERE checksum = ? AND collection_id = ?',
				checksum,
				id
			);
			if (duplicate) {
				skipped.push(`${name} (already in this collection)`);
				continue;
			}

			// don't clobber an existing file of the same name
			let target = join(dir, name);
			if (existsSync(target)) {
				const stem = name.replace(AUDIO_EXT, '');
				const ext = name.slice(stem.length);
				target = join(dir, `${stem}-${checksum.slice(0, 6)}${ext}`);
			}

			writeFileSync(target, bytes);
			const probe = probeAudio(target);

			run(
				`INSERT INTO tracks
				   (collection_id, file_path, title, artist, duration_seconds, sort_order, checksum)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				id,
				target, // absolute — this is what LiquidSoap gets handed
				probe.title ?? basename(target).replace(AUDIO_EXT, ''),
				probe.artist,
				probe.duration_seconds,
				order++,
				checksum
			);
			added.push(basename(target));
		}

		run("UPDATE collections SET updated_at = datetime('now') WHERE id = ?", id);

		if (added.length === 0) {
			return fail(400, { error: `Nothing ingested. ${skipped.join('; ')}` });
		}
		return {
			ok: `Ingested ${added.length} file${added.length === 1 ? '' : 's'}.${
				skipped.length ? ` Skipped: ${skipped.join('; ')}` : ''
			}`
		};
	},

	/** Fill in or fix a track's title/artist. */
	updateTrack: async ({ request }) => {
		const form = await request.formData();
		const trackId = Number(form.get('track_id'));
		if (!Number.isInteger(trackId)) return fail(400, { error: 'Bad track id.' });

		run(
			'UPDATE tracks SET title = ?, artist = ? WHERE id = ?',
			nullable(form.get('title')),
			nullable(form.get('artist')),
			trackId
		);
		return { ok: 'Track updated.' };
	},

	/** Remove a track row; optionally delete the file from the library too. */
	deleteTrack: async ({ request }) => {
		const form = await request.formData();
		const trackId = Number(form.get('track_id'));
		const track = one<Track>('SELECT * FROM tracks WHERE id = ?', trackId);
		if (!track) return fail(404, { error: 'Track not found.' });

		run('DELETE FROM tracks WHERE id = ?', trackId);

		if (form.get('delete_file') && track.file_path.startsWith(AUDIO_LIBRARY_DIR)) {
			try {
				rmSync(track.file_path, { force: true });
			} catch (cause) {
				console.error('[airadio/web] could not remove file', cause);
			}
		}
		return { ok: 'Track removed.' };
	},

	/** Delete the collection. Files on disk are left alone. */
	delete: async ({ params }) => {
		const id = Number(params.id);
		const usage = one<{ n: number }>(
			'SELECT COUNT(*) AS n FROM schedule_slots WHERE collection_id = ?',
			id
		);
		if ((usage?.n ?? 0) > 0) {
			return fail(400, {
				error: `Still referenced by ${usage?.n} schedule slot(s) — remove those first.`
			});
		}
		run('DELETE FROM collections WHERE id = ?', id); // tracks cascade
		redirect(303, '/collections');
	}
};
