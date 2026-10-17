import { fail } from '@sveltejs/kit';
import { one, run } from '#lib/server/db.ts';
import { COUNTRY_OPTIONS } from '#lib/countries.ts';
import type { StationSettings } from '#lib/types.ts';
import type { Actions, PageServerLoad } from './$types';

const VALID_CODES = new Set(COUNTRY_OPTIONS.map((c) => c.code));

export const load: PageServerLoad = () => {
	// Same singleton-row pattern as station_state: create it on first read if
	// the engine hasn't booted yet (the schema's own DEFAULT 'GB' covers a
	// fresh column, this covers a row that doesn't exist at all yet).
	run(`INSERT INTO station_settings (id) VALUES (1) ON CONFLICT(id) DO NOTHING`);
	const settings = one<StationSettings>('SELECT * FROM station_settings WHERE id = 1');

	return { settings: settings!, countries: COUNTRY_OPTIONS };
};

export const actions: Actions = {
	update: async ({ request }) => {
		const form = await request.formData();
		const country = String(form.get('country') ?? '').trim().toUpperCase();

		if (!VALID_CODES.has(country)) {
			return fail(400, { error: `"${country}" isn't a supported country code.` });
		}

		run(
			`INSERT INTO station_settings (id, country) VALUES (1, ?)
			 ON CONFLICT(id) DO UPDATE SET country = excluded.country, updated_at = datetime('now')`,
			country
		);

		const name = COUNTRY_OPTIONS.find((c) => c.code === country)?.name ?? country;
		return {
			ok: `Station country set to ${name}. The engine picks this up on its next news/weather fetch.`
		};
	}
};
