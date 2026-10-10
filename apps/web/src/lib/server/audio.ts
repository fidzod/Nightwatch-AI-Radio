// ffprobe-backed metadata extraction for uploaded audio. ffmpeg/ffprobe come
// from the nix devShell, so they're on PATH whenever the app is run correctly.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export type Probe = {
	duration_seconds: number | null;
	title: string | null;
	artist: string | null;
};

type FfprobeJson = {
	format?: {
		duration?: string;
		tags?: Record<string, string>;
	};
};

function pickTag(tags: Record<string, string> | undefined, key: string): string | null {
	if (!tags) return null;
	// ID3 tag keys come back with inconsistent casing depending on the container
	const found = Object.entries(tags).find(([k]) => k.toLowerCase() === key);
	const value = found?.[1]?.trim();
	return value ? value : null;
}

export function probeAudio(filePath: string): Probe {
	const result = spawnSync(
		'ffprobe',
		[
			'-v',
			'error',
			'-show_entries',
			'format=duration:format_tags=title,artist',
			'-of',
			'json',
			filePath
		],
		{ encoding: 'utf8', timeout: 20_000 }
	);

	if (result.error || result.status !== 0) {
		return { duration_seconds: null, title: null, artist: null };
	}

	try {
		const parsed = JSON.parse(result.stdout) as FfprobeJson;
		const raw = parsed.format?.duration;
		const duration = raw === undefined ? NaN : Number.parseFloat(raw);
		return {
			duration_seconds: Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : null,
			title: pickTag(parsed.format?.tags, 'title'),
			artist: pickTag(parsed.format?.tags, 'artist')
		};
	} catch {
		return { duration_seconds: null, title: null, artist: null };
	}
}

export function sha256(buffer: Uint8Array): string {
	return createHash('sha256').update(buffer).digest('hex');
}

/** Strip path separators / weirdness from a user-supplied filename. */
export function safeFileName(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? 'upload.mp3';
	const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').trim();
	return cleaned || 'upload.mp3';
}
