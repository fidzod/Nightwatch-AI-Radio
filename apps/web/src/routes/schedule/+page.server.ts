import { fail } from '@sveltejs/kit';
import { all, boolInt, nullable, run } from '#lib/server/db.ts';
import { getSlotsForNow } from '#lib/server/live.ts';
import type { Collection, Presenter, ScheduleSlotView } from '#lib/types.ts';
import type { Actions, PageServerLoad } from './$types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- conflict detection -----------------------------------------------------
// Mirrors apps/engine/src/scheduler/resolveActiveSlot.ts's `beats()` ordering
// (date_override > priority > lowest id) so "who wins" on this page matches
// what the engine actually does, not a simplified guess.

export type SlotRival = {
	id: number;
	presenter_name: string;
	recurrence_type: 'weekly' | 'date_override';
	start_time: string;
	end_time: string;
	priority: number;
	/** true: this rival beats the slot it's attached to. */
	wins: boolean;
};

export type SlotConflict = {
	/** true: at least one rival beats this slot — it never actually airs in the overlap. */
	shadowed: boolean;
	rivals: SlotRival[];
};

function toMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(':').map(Number);
	return (h ?? 0) * 60 + (m ?? 0);
}

/** A slot's window as one or two [start, end) minute ranges, splitting a
 *  past-midnight wrap (21:00 -> 01:00) the same way the engine treats it. */
function windowSegments(start: string, end: string): Array<[number, number]> {
	const s = toMinutes(start);
	const e = toMinutes(end);
	return e > s
		? [[s, e]]
		: [
				[s, 1440],
				[0, e]
			];
}

function segmentsOverlap(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
	for (const [aStart, aEnd] of a) {
		for (const [bStart, bEnd] of b) {
			if (aStart < bEnd && bStart < aEnd) return true;
		}
	}
	return false;
}

function weekdayOfDate(dateStr: string): number {
	const [y, m, d] = dateStr.split('-').map(Number);
	return new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
}

/** Two slots can only fight over the same instants if they land on the same
 *  calendar weekday (two weeklys) or the same literal date (an override
 *  against a weekly, or two overrides). */
function sameDayContext(a: ScheduleSlotView, b: ScheduleSlotView): boolean {
	const aOverride = a.recurrence_type === 'date_override';
	const bOverride = b.recurrence_type === 'date_override';
	if (!aOverride && !bOverride) return a.day_of_week === b.day_of_week;
	if (aOverride && bOverride) return a.specific_date === b.specific_date;
	const override = aOverride ? a : b;
	const weekly = aOverride ? b : a;
	return override.specific_date != null && weekdayOfDate(override.specific_date) === weekly.day_of_week;
}

/** date_override beats weekly, then higher priority, then lowest id — same
 *  total order as the engine's `beats()`. */
function slotBeats(a: ScheduleSlotView, b: ScheduleSlotView): boolean {
	const aOverride = a.recurrence_type === 'date_override' ? 1 : 0;
	const bOverride = b.recurrence_type === 'date_override' ? 1 : 0;
	if (aOverride !== bOverride) return aOverride > bOverride;
	if (a.priority !== b.priority) return a.priority > b.priority;
	return a.id < b.id;
}

/**
 * Pairwise overlap among slots that could actually contend for airtime (i.e.
 * the engine would ever consider them): enabled, with an active presenter.
 * A disabled slot or one whose presenter was deactivated is invisible to
 * resolveActiveSlot, so it can't be "fighting" for a window either.
 */
function computeConflicts(
	slots: ScheduleSlotView[],
	presenterActive: Map<number, boolean>
): Map<number, SlotConflict> {
	const live = slots.filter((s) => !!s.enabled && presenterActive.get(s.presenter_id) !== false);
	const byId = new Map<number, SlotConflict>();

	const ensure = (id: number): SlotConflict => {
		let entry = byId.get(id);
		if (!entry) {
			entry = { shadowed: false, rivals: [] };
			byId.set(id, entry);
		}
		return entry;
	};

	for (let i = 0; i < live.length; i++) {
		for (let j = i + 1; j < live.length; j++) {
			const a = live[i];
			const b = live[j];
			if (!sameDayContext(a, b)) continue;
			if (!segmentsOverlap(windowSegments(a.start_time, a.end_time), windowSegments(b.start_time, b.end_time))) {
				continue;
			}

			const aWins = slotBeats(a, b);

			const aEntry = ensure(a.id);
			aEntry.rivals.push({
				id: b.id,
				presenter_name: b.presenter_name,
				recurrence_type: b.recurrence_type,
				start_time: b.start_time,
				end_time: b.end_time,
				priority: b.priority,
				wins: !aWins
			});
			if (!aWins) aEntry.shadowed = true;

			const bEntry = ensure(b.id);
			bEntry.rivals.push({
				id: a.id,
				presenter_name: a.presenter_name,
				recurrence_type: a.recurrence_type,
				start_time: a.start_time,
				end_time: a.end_time,
				priority: a.priority,
				wins: aWins
			});
			if (aWins) bEntry.shadowed = true;
		}
	}

	return byId;
}

export const load: PageServerLoad = () => {
	const slots = all<ScheduleSlotView>(
		`SELECT s.*, p.name AS presenter_name, c.name AS collection_name
		 FROM schedule_slots s
		 JOIN presenters p ON p.id = s.presenter_id
		 JOIN collections c ON c.id = s.collection_id
		 ORDER BY s.recurrence_type, s.day_of_week, s.specific_date, s.start_time`
	);

	const presenters = all<Pick<Presenter, 'id' | 'name' | 'active'>>(
		'SELECT id, name, active FROM presenters ORDER BY id'
	);
	const presenterActive = new Map(presenters.map((p) => [p.id, !!p.active]));
	const conflicts = computeConflicts(slots, presenterActive);

	// Same resolution the engine (and /live) would land on right now — so the
	// user doesn't have to cross-reference the live view to see who's airing.
	const nowSlot = getSlotsForNow()[0] ?? null;

	return {
		slots: slots.map((s) => ({
			...s,
			conflict: conflicts.get(s.id) ?? null,
			presenterInactive: presenterActive.get(s.presenter_id) === false
		})),
		presenters,
		collections: all<Pick<Collection, 'id' | 'name'>>(
			'SELECT id, name FROM collections ORDER BY name COLLATE NOCASE'
		),
		nowSlot
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
