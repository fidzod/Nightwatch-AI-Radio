// First-run seeding so the UI has something to show before the engine or the
// user has put anything in the database. Every step is guarded by an existence
// check, so this is safe to run on every boot and safe to race against the
// engine doing its own seeding.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { probeAudio } from './audio.ts';
import { PERSONA_SEEDS, SLOT_SEEDS } from './personas.ts';
import { AUDIO_LIBRARY_DIR } from './paths.ts';

function count(db: DatabaseSync, table: string): number {
	const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
	return row?.n ?? 0;
}

function seedPresenters(db: DatabaseSync) {
	const insert = db.prepare(
		`INSERT INTO presenters (name, station_role, tone_description, system_prompt, voice_archetype_notes)
		 VALUES (?, ?, ?, ?, ?)`
	);
	const exists = db.prepare('SELECT id FROM presenters WHERE name = ?');
	for (const p of PERSONA_SEEDS) {
		if (exists.get(p.name)) continue;
		insert.run(
			p.name,
			p.station_role,
			p.tone_description,
			p.system_prompt,
			p.voice_archetype_notes
		);
	}
}

/**
 * Phase 1 left mp3s in `audio/library/<dir>/` with no rows pointing at them.
 * Register whatever is already on disk so the collections browser isn't empty
 * on first load.
 */
function seedCollectionsFromDisk(db: DatabaseSync) {
	if (!existsSync(AUDIO_LIBRARY_DIR)) return;
	const dirs = readdirSync(AUDIO_LIBRARY_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);

	const findCollection = db.prepare('SELECT id FROM collections WHERE name = ?');
	const insertCollection = db.prepare(
		'INSERT INTO collections (name, mood_tag, description) VALUES (?, ?, ?)'
	);
	const findTrack = db.prepare('SELECT id FROM tracks WHERE file_path = ?');
	const insertTrack = db.prepare(
		`INSERT INTO tracks (collection_id, file_path, title, artist, duration_seconds, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?)`
	);

	for (const dir of dirs) {
		const files = readdirSync(join(AUDIO_LIBRARY_DIR, dir))
			.filter((f) => /\.(mp3|m4a|flac|ogg|wav|opus)$/i.test(f))
			.sort();
		if (files.length === 0) continue;

		let collectionId = (findCollection.get(dir) as { id: number } | undefined)?.id;
		if (collectionId === undefined) {
			const res = insertCollection.run(
				dir,
				null,
				'Imported from audio/library on first run.'
			);
			collectionId = Number(res.lastInsertRowid);
		}

		files.forEach((file, index) => {
			// absolute paths, matching the rows the engine/Phase 1 writes — LiquidSoap
			// resolves them straight from /next-music
			const absolute = join(AUDIO_LIBRARY_DIR, dir, file);
			if (findTrack.get(absolute)) return;
			const probe = probeAudio(absolute);
			insertTrack.run(
				collectionId,
				absolute,
				probe.title ?? file.replace(/\.[^.]+$/, ''),
				probe.artist,
				probe.duration_seconds,
				index
			);
		});
	}
}

function seedSchedule(db: DatabaseSync) {
	const collection = db.prepare('SELECT id FROM collections ORDER BY id LIMIT 1').get() as
		| { id: number }
		| undefined;
	if (!collection) return; // nothing to point a slot at yet

	const findPresenter = db.prepare('SELECT id FROM presenters WHERE name = ?');
	const hasSlots = db.prepare('SELECT id FROM schedule_slots WHERE presenter_id = ? LIMIT 1');
	const insert = db.prepare(
		`INSERT INTO schedule_slots
		   (recurrence_type, day_of_week, specific_date, start_time, end_time,
		    presenter_id, collection_id, priority, enabled)
		 VALUES ('weekly', ?, NULL, ?, ?, ?, ?, 0, 1)`
	);

	for (const slot of SLOT_SEEDS) {
		const presenter = findPresenter.get(slot.presenter) as { id: number } | undefined;
		if (!presenter) continue;
		if (hasSlots.get(presenter.id)) continue; // already scheduled (by us or the engine)
		for (let day = 0; day <= 6; day++) {
			insert.run(day, slot.start_time, slot.end_time, presenter.id, collection.id);
		}
	}
}

export function seedIfEmpty(db: DatabaseSync) {
	// Each step is idempotent per row, so this is safe to run every boot and
	// safe to race against the engine seeding the same tables.
	try {
		seedPresenters(db);
		// Disk import is first-run only: otherwise deleting a collection in the UI
		// would resurrect it from the files still sitting in audio/library.
		if (count(db, 'collections') === 0) seedCollectionsFromDisk(db);
		seedSchedule(db);
	} catch (error) {
		// Seeding is a convenience, never a reason to fail a request — the engine
		// may be writing concurrently.
		console.error('[airadio/web] seed skipped:', error);
	}
}
