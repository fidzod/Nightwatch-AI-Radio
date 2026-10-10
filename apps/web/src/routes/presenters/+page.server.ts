import { fail } from '@sveltejs/kit';
import { all, boolInt, nullable, one, run } from '#lib/server/db.ts';
import type { Presenter } from '#lib/types.ts';
import type { Actions, PageServerLoad } from './$types';

type Usage = { presenter_id: number; slot_count: number; clip_count: number };

export const load: PageServerLoad = () => {
	const presenters = all<Presenter>('SELECT * FROM presenters ORDER BY id');

	const usage = all<Usage>(
		`SELECT p.id AS presenter_id,
		        (SELECT COUNT(*) FROM schedule_slots s WHERE s.presenter_id = p.id) AS slot_count,
		        (SELECT COUNT(*) FROM generated_clips g WHERE g.presenter_id = p.id) AS clip_count
		 FROM presenters p`
	);

	return { presenters, usage };
};

function readForm(form: FormData) {
	return {
		name: nullable(form.get('name')),
		station_role: nullable(form.get('station_role')),
		tone_description: nullable(form.get('tone_description')),
		voice_archetype_notes: nullable(form.get('voice_archetype_notes')),
		system_prompt: nullable(form.get('system_prompt')),
		elevenlabs_voice_id: nullable(form.get('elevenlabs_voice_id')),
		active: boolInt(form.get('active'))
	};
}

export const actions: Actions = {
	create: async ({ request }) => {
		const values = readForm(await request.formData());
		if (!values.name) return fail(400, { error: 'A presenter needs a name.' });
		if (!values.system_prompt) return fail(400, { error: 'A presenter needs a system prompt.' });

		run(
			`INSERT INTO presenters
			   (name, station_role, tone_description, system_prompt, voice_archetype_notes,
			    elevenlabs_voice_id, active)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			values.name,
			values.station_role ?? '',
			values.tone_description ?? '',
			values.system_prompt,
			values.voice_archetype_notes ?? '',
			values.elevenlabs_voice_id,
			values.active
		);
		return { ok: `${values.name} added to the roster.` };
	},

	update: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Bad presenter id.' });

		const values = readForm(form);
		if (!values.name) return fail(400, { error: 'A presenter needs a name.' });
		if (!values.system_prompt) return fail(400, { error: 'A presenter needs a system prompt.' });

		run(
			`UPDATE presenters
			 SET name = ?, station_role = ?, tone_description = ?, system_prompt = ?,
			     voice_archetype_notes = ?, elevenlabs_voice_id = ?, active = ?,
			     updated_at = datetime('now')
			 WHERE id = ?`,
			values.name,
			values.station_role ?? '',
			values.tone_description ?? '',
			values.system_prompt,
			values.voice_archetype_notes ?? '',
			values.elevenlabs_voice_id,
			values.active,
			id
		);
		return { ok: `${values.name} updated — the engine picks this up on its next generation.` };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const slots = one<{ n: number }>(
			'SELECT COUNT(*) AS n FROM schedule_slots WHERE presenter_id = ?',
			id
		);
		if ((slots?.n ?? 0) > 0) {
			return fail(400, {
				error: `Still on the schedule in ${slots?.n} slot(s) — remove those first.`
			});
		}
		const clips = one<{ n: number }>(
			'SELECT COUNT(*) AS n FROM generated_clips WHERE presenter_id = ?',
			id
		);
		if ((clips?.n ?? 0) > 0) {
			return fail(400, {
				error: `${clips?.n} generated clip(s) reference this presenter — deactivate instead.`
			});
		}
		run('DELETE FROM presenters WHERE id = ?', id);
		return { ok: 'Presenter removed.' };
	}
};
