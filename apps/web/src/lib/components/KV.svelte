<script lang="ts">
	// A single telemetry row: LABEL ....................... VALUE
	let {
		k,
		v = null,
		tone = 'default',
		fallback = '—'
	}: {
		k: string;
		v?: string | number | null;
		tone?: 'default' | 'cyan' | 'magenta' | 'green' | 'dim';
		fallback?: string;
	} = $props();

	const shown = $derived(v === null || v === undefined || v === '' ? fallback : String(v));
	const missing = $derived(shown === fallback);
</script>

<div class="kv">
	<span class="kv__k">{k}</span>
	<span class="kv__lead"></span>
	<span
		class="kv__v"
		class:t-cyan={tone === 'cyan' && !missing}
		class:t-magenta={tone === 'magenta' && !missing}
		class:t-green={tone === 'green' && !missing}
		class:t-dim={tone === 'dim' || missing}
		title={shown}>{shown}</span
	>
</div>

<style>
	.t-cyan {
		color: var(--cyan);
	}
	.t-magenta {
		color: var(--magenta);
	}
	.t-green {
		color: var(--green);
	}
	.t-dim {
		color: var(--ink-3);
	}
</style>
