import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const config = defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		hookTimeout: 20000,
		testTimeout: 20000
	}
});

export default config;
