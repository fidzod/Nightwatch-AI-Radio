import { fail, redirect } from '@sveltejs/kit';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { all, nullable, run } from '#lib/server/db.ts';
import { AUDIO_LIBRARY_DIR, slugify } from '#lib/server/paths.ts';
import type { CollectionSummary, Track } from '#lib/types.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const collections = all<CollectionSummary>(
		`SELECT c.*,
		        COUNT(t.id) AS track_count,
		        COALESCE(SUM(t.duration_seconds), 0) AS total_seconds
		 FROM collections c
		 LEFT JOIN tracks t ON t.collection_id = c.id
		 GROUP BY c.id
		 ORDER BY c.name COLLATE NOCASE`
	);

	// a short A-side preview for each sleeve
	const previews = all<Pick<Track, 'id' | 'collection_id' | 'title' | 'file_path' | 'duration_seconds' | 'sort_order'>>(
		`SELECT id, collection_id, title, file_path, duration_seconds, sort_order
		 FROM tracks ORDER BY collection_id, sort_order, id`
	);

	return { collections, previews };
};

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const name = nullable(form.get('name'));
		if (!name) return fail(400, { error: 'A collection needs a name.' });

		const existing = all<{ id: number }>('SELECT id FROM collections WHERE name = ?', name);
		if (existing.length > 0) {
			return fail(400, { error: `A collection called "${name}" already exists.` });
		}

		const result = run(
			'INSERT INTO collections (name, mood_tag, description) VALUES (?, ?, ?)',
			name,
			nullable(form.get('mood_tag')),
			nullable(form.get('description'))
		);

		// create the library directory up-front so uploads have somewhere to land
		mkdirSync(join(AUDIO_LIBRARY_DIR, slugify(name)), { recursive: true });

		redirect(303, `/collections/${Number(result.lastInsertRowid)}`);
	}
};
