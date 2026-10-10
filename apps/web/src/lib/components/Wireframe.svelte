<script lang="ts">
	// Decorative wireframe motifs (the orbit sphere / geometry grid / phosphor
	// globe references). Used sparingly — a divider or a corner, never wallpaper.
	let {
		variant = 'orbit',
		size = 180,
		opacity = 0.5,
		color = 'var(--cyan-dim)',
		spin = false
	}: {
		variant?: 'orbit' | 'globe' | 'torus' | 'funnel';
		size?: number;
		opacity?: number;
		color?: string;
		spin?: boolean;
	} = $props();

	const R = 48;
	// meridian ellipses: same ry, rx sweeping from full width down to a line
	const meridians = [0.12, 0.38, 0.66, 0.9, 1].map((f) => R * f);
	// latitude rings: horizontal ellipses stacked up the sphere
	const latitudes = [-0.78, -0.45, 0, 0.45, 0.78].map((f) => ({
		cy: R * f,
		rx: R * Math.sqrt(Math.max(0, 1 - f * f)),
		ry: R * 0.17 * Math.sqrt(Math.max(0, 1 - f * f))
	}));
	// equatorial spiral — the concentric ellipse stack in the orbit reference
	const spirals = [0.1, 0.22, 0.34, 0.47, 0.6, 0.74, 0.88].map((f) => ({
		rx: R * f,
		ry: R * f * 0.3
	}));
	const funnelRings = [0.16, 0.3, 0.46, 0.64, 0.84, 1].map((f) => ({
		rx: R * f,
		cy: -R * 0.7 + R * 1.5 * Math.pow(f, 0.6)
	}));
</script>

<svg
	class="wf"
	class:wf--spin={spin}
	width={size}
	height={size}
	viewBox="-60 -60 120 120"
	style="opacity:{opacity};color:{color}"
	aria-hidden="true"
>
	{#if variant === 'orbit'}
		<circle r={R} />
		{#each meridians as rx}
			<ellipse {rx} ry={R} />
		{/each}
		{#each latitudes as l}
			<ellipse cy={l.cy} rx={l.rx} ry={l.ry} />
		{/each}
		{#each spirals as s}
			<ellipse rx={s.rx} ry={s.ry} />
		{/each}
	{:else if variant === 'globe'}
		<circle r={R} />
		{#each [0.2, 0.45, 0.7, 0.9] as f}
			<ellipse rx={R * f} ry={R} />
		{/each}
		{#each [-0.85, -0.6, -0.3, 0, 0.3, 0.6, 0.85] as f}
			<line x1={-R * Math.sqrt(1 - f * f)} x2={R * Math.sqrt(1 - f * f)} y1={R * f} y2={R * f} />
		{/each}
	{:else if variant === 'torus'}
		{#each [0.42, 0.58, 0.74, 0.9, 1] as f}
			<ellipse rx={R * f} ry={R * f * 0.42} />
		{/each}
		{#each Array(14) as _, i}
			{@const a = (i / 14) * Math.PI * 2}
			<ellipse
				cx={Math.cos(a) * R * 0.71}
				cy={Math.sin(a) * R * 0.3}
				rx={R * 0.29 * Math.abs(Math.cos(a) * 0.55 + 0.45)}
				ry={R * 0.29}
			/>
		{/each}
	{:else}
		{#each funnelRings as ring}
			<ellipse cx="0" cy={ring.cy} rx={ring.rx} ry={ring.rx * 0.32} />
		{/each}
		{#each Array(12) as _, i}
			{@const a = (i / 12) * Math.PI * 2}
			<line
				x1={Math.cos(a) * R * 0.16}
				y1={-R * 0.7 + Math.sin(a) * R * 0.05}
				x2={Math.cos(a) * R}
				y2={R * 0.8 + Math.sin(a) * R * 0.32}
			/>
		{/each}
	{/if}
</svg>

<style>
	.wf {
		display: block;
		fill: none;
		stroke: currentColor;
		stroke-width: 0.45;
		filter: drop-shadow(0 0 3px currentColor);
	}

	.wf--spin {
		animation: wf-spin 48s linear infinite;
	}

	@keyframes wf-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.wf--spin {
			animation: none;
		}
	}
</style>
