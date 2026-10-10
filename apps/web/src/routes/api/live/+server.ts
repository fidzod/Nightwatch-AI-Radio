import { json } from '@sveltejs/kit';
import { getLivePayload } from '#lib/server/live.ts';
import type { RequestHandler } from './$types';

// Polled by /live every few seconds. Cheap: a handful of indexed single-row
// reads against a local sqlite file.
export const GET: RequestHandler = () => {
	return json(getLivePayload(), {
		headers: { 'cache-control': 'no-store' }
	});
};
