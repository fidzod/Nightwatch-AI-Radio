import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The console has no separate "home" — tuning in is the home.
export const load: PageServerLoad = () => {
	redirect(307, '/live');
};
