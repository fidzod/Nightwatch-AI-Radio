import { fail } from '@sveltejs/kit';
import { all, boolInt, nullable, run } from '#lib/server/db.ts';
import type { Collection, Presenter, ScheduleSlotView } from '#lib/types.ts';
import type { Actions, PageServerLoad } from './$types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const load: PageServerLoad = () => {
	const slots = all<ScheduleSlotView>(
		`SELECT s.*, p.name AS presenter_name, c.name AS collection_name
		 FROM schedule_slots s
		 JOIN presenters p ON p.id = s.presenter_id
		 JOIN collections c ON c.id = s.collection_id
		 ORDER BY s.recurrence_type, s.day_of_week, s.specific_date, s.start_time`
	);

	return {
		slots,
		presenters: all<Pick<Presenter, 'id' | 'name' | 'active'>>(
			'SELECT id, name, active FROM presenters ORDER BY id'
		),
		collections: all<Pick<Collection, 'id' | 'name'>>(
			'SELECT id, name FROM collections ORDER BY name COLLATE NOCASE'
		)
	};
};

type Parsed =
	| { ok: true; values: [string, number | null, string | null, string, string, number, number, number, number] }
	| { ok: false; message: string };

function parseSlot(form: FormData): Parsed {
	const recurrence = String(form.get('recurrence_type') ?? 'weekly');
	if (recurrence !== 'weekly' && recurrence !== 'date_override') {
		return { ok: false, message: 'Recurrence must be weekly or a date override.' };
	}

	const start = String(form.get('start_time') ?? '');
	const end = String(form.get('end_time') ?? '');
	if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
		return { ok: false, message: 'Start and end must be HH:MM (24h).' };
	}
	if (start === end) {
		return { ok: false, message: 'Start and end cannot be identical.' };
	}

	let dayOfWeek: number | null = null;
	let specificDate: string | null = null;

	if (recurrence === 'weekly') {
		const raw = Number(form.get('day_of_week'));
		if (!Number.isInteger(raw) || raw < 0 || raw > 6) {
			return { ok: false, message: 'Pick a day of the week.' };
		}
		dayOfWeek = raw;
	} else {
		specificDate = nullable(form.get('specific_date'));
		if (!specificDate || !DATE_RE.test(specificDate)) {
			return { ok: false, message: 'A date override needs a YYYY-MM-DD date.' };
		}
	}

	const presenterId = Number(form.get('presenter_id'));
	const collectionId = Number(form.get('collection_id'));
	if (!Number.isInteger(presenterId) || !Number.isInteger(collectionId)) {
		return { ok: false, message: 'Pick a presenter and a collection.' };
	}

	const priorityRaw = Number(form.get('priority'));
	const priority = Number.isFinite(priorityRaw) ? Math.trunc(priorityRaw) : 0;
	const enabled = boolInt(form.get('enabled'));

	return {
		ok: true,
		values: [
			recurrence,
			dayOfWeek,
			specificDate,
			start,
			end,
			presenterId,
			collectionId,
			priority,
			enabled
		]
	};
}

export const actions: Actions = {
	create: async ({ request }) => {
		const parsed = parseSlot(await request.formData());
		if (!parsed.ok) return fail(400, { error: parsed.message });

		run(
			`INSERT INTO schedule_slots
			   (recurrence_type, day_of_week, specific_date, start_time, end_time,
			    presenter_id, collection_id, priority, enabled)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			...parsed.values
		);
		return { ok: 'Slot added.' };
	},

	update: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Bad slot id.' });

		const parsed = parseSlot(form);
		if (!parsed.ok) return fail(400, { error: parsed.message });

		run(
			`UPDATE schedule_slots
			 SET recurrence_type = ?, day_of_week = ?, specific_date = ?, start_time = ?,
			     end_time = ?, presenter_id = ?, collection_id = ?, priority = ?, enabled = ?
			 WHERE id = ?`,
			...parsed.values,
			id
		);
		return { ok: `Slot ${id} updated.` };
	},

	toggle: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Bad slot id.' });
		run('UPDATE schedule_slots SET enabled = 1 - enabled WHERE id = ?', id);
		return { ok: `Slot ${id} toggled.` };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Bad slot id.' });
		run('DELETE FROM schedule_slots WHERE id = ?', id);
		return { ok: `Slot ${id} deleted.` };
	},

	/** Copy every weekly slot on one day onto another day. */
	copyDay: async ({ request }) => {
		const form = await request.formData();
		const from = Number(form.get('from_day'));
		const to = Number(form.get('to_day'));
		if (![from, to].every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || from === to) {
			return fail(400, { error: 'Pick two different days.' });
		}
		const rows = all<{ n: number }>(
			`INSERT INTO schedule_slots
			   (recurrence_type, day_of_week, specific_date, start_time, end_time,
			    presenter_id, collection_id, priority, enabled)
			 SELECT 'weekly', ?, NULL, start_time, end_time, presenter_id, collection_id,
			        priority, enabled
			 FROM schedule_slots
			 WHERE recurrence_type = 'weekly' AND day_of_week = ?
			 RETURNING id AS n`,
			to,
			from
		);
		return { ok: `Copied ${rows.length} slot(s).` };
	}
};
