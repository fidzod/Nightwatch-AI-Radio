import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	server: {
		port: 5173,
		fs: {
			// the sqlite db + audio library live above apps/web in the monorepo
			allow: ['..', '../..']
		}
	},
	ssr: {
		// @airadio/db ships raw .ts (node 22 runs TS natively); let vite transform it
		noExternal: ['@airadio/db']
	}
});
