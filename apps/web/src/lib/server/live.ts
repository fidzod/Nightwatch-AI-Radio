// Snapshot of what the station is doing right now. Phase 3's engine owns the
// `station_state` row; until it runs, every column here is null (or the row is
// missing entirely) and the UI must render "off air" rather than fall over.
import { all, one } from './db.ts';
import type {
	Collection,
	LivePayload,
	LiveSnapshot,
	Presenter,
	ScheduleSlotView,
	StationState,
	Track
} from '#lib/types.ts';

const HEARTBEAT_GRACE_SECONDS = 30;

function parseSqliteTime(value: string | null): number | null {
	if (!value) return null;
	// `datetime('now')` yields 'YYYY-MM-DD HH:MM:SS' in UTC with no zone marker
	const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
		? value.replace(' ', 'T')
		: value.replace(' ', 'T') + 'Z';
	const ms = Date.parse(normalized);
	return Number.isFinite(ms) ? ms : null;
}

function countOf(table: string): number {
	return one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
}

export function getLiveSnapshot(): LiveSnapshot {
	const state = one<StationState>('SELECT * FROM station_state WHERE id = 1') ?? null;

	const presenter = state?.current_presenter_id
		? (one<Pick<Presenter, 'id' | 'name' | 'station_role'>>(
				'SELECT id, name, station_role FROM presenters WHERE id = ?',
				state.current_presenter_id
			) ?? null)
		: null;

	const collection = state?.current_collection_id
		? (one<Pick<Collection, 'id' | 'name' | 'mood_tag'>>(
				'SELECT id, name, mood_tag FROM collections WHERE id = ?',
				state.current_collection_id
			) ?? null)
		: null;

	const slot = state?.current_schedule_slot_id
		? (one<ScheduleSlotView>(
				`SELECT s.*, p.name AS presenter_name, c.name AS collection_name
				 FROM schedule_slots s
				 JOIN presenters p ON p.id = s.presenter_id
				 JOIN collections c ON c.id = s.collection_id
				 WHERE s.id = ?`,
				state.current_schedule_slot_id
			) ?? null)
		: null;

	const heartbeatMs = parseSqliteTime(state?.last_heartbeat_at ?? null);
	const heartbeatAgeSeconds =
		heartbeatMs === null ? null : Math.max(0, Math.round((Date.now() - heartbeatMs) / 1000));

	return {
		state,
		presenter,
		collection,
		slot,
		onAir: heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= HEARTBEAT_GRACE_SECONDS,
		heartbeatAgeSeconds,
		serverTime: new Date().toISOString(),
		trackCount: countOf('tracks'),
		collectionCount: countOf('collections'),
		presenterCount: countOf('presenters'),
		slotCount: countOf('schedule_slots')
	};
}

/** Everything the live HUD renders — shared by the page load and /api/live. */
export function getLivePayload(): LivePayload {
	return {
		snapshot: getLiveSnapshot(),
		recent: getRecentTracks(),
		nowSlots: getSlotsForNow()
	};
}

/** Tracks most recently played, as a "signal log" for the live page. */
export function getRecentTracks(limit = 6) {
	return all<Track & { collection_name: string }>(
		`SELECT t.*, c.name AS collection_name
		 FROM tracks t
		 JOIN collections c ON c.id = t.collection_id
		 WHERE t.last_played_at IS NOT NULL
		 ORDER BY t.last_played_at DESC
		 LIMIT ?`,
		limit
	);
}

/**
 * Slots that cover a given wall-clock moment, best match first. Mirrors the
 * engine's resolution rules closely enough for a readout: date overrides beat
 * weekly, higher priority wins, and windows may wrap past midnight.
 */
export function getSlotsForNow(now = new Date()): ScheduleSlotView[] {
	const slots = all<ScheduleSlotView>(
		`SELECT s.*, p.name AS presenter_name, c.name AS collection_name
		 FROM schedule_slots s
		 JOIN presenters p ON p.id = s.presenter_id
		 JOIN collections c ON c.id = s.collection_id
		 WHERE s.enabled = 1`
	);

	const pad = (n: number) => String(n).padStart(2, '0');
	const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
	const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const dow = now.getDay();

	const covers = (slot: ScheduleSlotView) => {
		const { start_time: a, end_time: b } = slot;
		return a <= b ? hhmm >= a && hhmm < b : hhmm >= a || hhmm < b;
	};

	const applies = (slot: ScheduleSlotView) => {
		if (slot.recurrence_type === 'date_override') return slot.specific_date === today;
		// a window that wraps past midnight belongs to the previous day too
		if (slot.start_time > slot.end_time && hhmm < slot.end_time) {
			return slot.day_of_week === (dow + 6) % 7;
		}
		return slot.day_of_week === dow;
	};

	return slots
		.filter((s) => applies(s) && covers(s))
		.sort(
			(x, y) =>
				Number(y.recurrence_type === 'date_override') -
					Number(x.recurrence_type === 'date_override') || y.priority - x.priority
		);
}
