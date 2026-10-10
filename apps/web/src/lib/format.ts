// Shared (client + server) formatting helpers. Everything here renders into
// fixed-width monospace readouts, so values pad rather than collapse.

/** 03:41 — the mixtape-sleeve / telemetry runtime format. */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return '--:--';
	const total = Math.max(0, Math.round(Number(seconds)));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const mm = String(m).padStart(2, '0');
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 00:00:00 elapsed counter for the HUD's T+ field. */
export function formatElapsed(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

export function dayName(index: number | null | undefined): string {
	if (index === null || index === undefined) return '---';
	return DAY_NAMES[index] ?? '---';
}

/** `2026-10-10 21:04:11` -> `21:04:11`, tolerating nulls and ISO 'T'. */
export function clockOf(value: string | null | undefined): string {
	if (!value) return '--:--:--';
	const match = value.replace('T', ' ').match(/(\d{2}:\d{2}:\d{2})/);
	return match ? match[1] : '--:--:--';
}

/** Pads a label out with dot leaders, SPCNET-style. */
export function pad(value: string | number | null | undefined, width: number): string {
	return String(value ?? '--').padEnd(width, ' ');
}

export function nullDash(value: string | null | undefined, fallback = '—'): string {
	if (value === null || value === undefined) return fallback;
	const trimmed = String(value).trim();
	return trimmed === '' ? fallback : trimmed;
}
