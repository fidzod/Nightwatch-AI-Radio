import { getLivePayload } from '#lib/server/live.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => getLivePayload();
