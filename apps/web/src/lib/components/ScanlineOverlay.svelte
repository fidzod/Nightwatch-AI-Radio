<script lang="ts">
	// CRT treatment for the whole app: phosphor scanlines, a slow rolling
	// refresh bar, film grain and a vignette. Pointer-events are off, so it
	// never interferes with the UI underneath.
	let { grain = true, vignette = true, roll = true } = $props();
</script>

<div class="crt" aria-hidden="true">
	<div class="crt__scan"></div>
	{#if roll}<div class="crt__roll"></div>{/if}
	{#if grain}<div class="crt__grain"></div>{/if}
	{#if vignette}<div class="crt__vignette"></div>{/if}
</div>

<style>
	.crt {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 9000;
	}

	.crt__scan {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			180deg,
			rgba(0, 0, 0, 0) 0px,
			rgba(0, 0, 0, 0) 2px,
			rgba(0, 0, 0, 0.32) 3px,
			rgba(0, 0, 0, 0.32) 4px
		);
		mix-blend-mode: multiply;
		opacity: 0.55;
	}

	.crt__roll {
		position: absolute;
		left: 0;
		right: 0;
		height: 38vh;
		background: linear-gradient(
			180deg,
			rgba(120, 255, 245, 0) 0%,
			rgba(120, 255, 245, 0.028) 48%,
			rgba(120, 255, 245, 0) 100%
		);
		animation: roll 9s linear infinite;
	}

	.crt__grain {
		position: absolute;
		inset: -50%;
		opacity: 0.1;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='160' height='160' filter='url(%23n)' opacity='0.55'/></svg>");
		animation: shift 900ms steps(3) infinite;
	}

	.crt__vignette {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(135% 115% at 50% 48%, transparent 58%, rgba(0, 0, 0, 0.55) 100%);
	}

	@keyframes roll {
		from {
			transform: translateY(-40vh);
		}
		to {
			transform: translateY(120vh);
		}
	}

	@keyframes shift {
		0% {
			transform: translate(0, 0);
		}
		33% {
			transform: translate(-2%, 1%);
		}
		66% {
			transform: translate(1%, -2%);
		}
		100% {
			transform: translate(0, 0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.crt__roll,
		.crt__grain {
			animation: none;
		}
	}
</style>
