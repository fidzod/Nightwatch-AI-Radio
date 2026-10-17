<script lang="ts">
	import { page } from '$app/state';
	import ScanlineOverlay from '#lib/components/ScanlineOverlay.svelte';
	import '#lib/styles/app.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const NAV = [
		{ href: '/live', label: 'LIVE', key: 'A' },
		{ href: '/collections', label: 'COLLECTIONS', key: 'B' },
		{ href: '/presenters', label: 'PRESENTERS', key: 'C' },
		{ href: '/schedule', label: 'SCHEDULE', key: 'D' },
		{ href: '/settings', label: 'SETTINGS', key: 'E' }
	];

	let clock = $state('--:--:--');
	let utc = $state('----------');

	$effect(() => {
		const tick = () => {
			const d = new Date();
			const p = (n: number) => String(n).padStart(2, '0');
			clock = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
			utc = d.toISOString().slice(0, 10);
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	});

	const isActive = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<svelte:head>
	<title>Nightwatch Radio — station console</title>
	<meta name="description" content="Nightwatch Radio station console" />
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</svelte:head>

<ScanlineOverlay />

<div class="chassis">
	<header class="masthead">
		<div class="masthead__strip">
			<span class="ident">NIGHTWATCH RADIO</span>
			<span class="sep">•</span>
			<span>STATION CONSOLE v0.4</span>
			<span class="sep">•</span>
			<span>NODE / LOCAL</span>
			<span class="sep">•</span>
			<span>MNT /nightwatch.mp3</span>
			<span class="spacer"></span>
			<span class="clockdate">{utc}</span>
			<span class="clock">{clock}</span>
		</div>
		<div class="tick-rail tick-rail--dense"></div>
		<nav class="nav">
			{#each NAV as item}
				<a class="nav__item" class:nav__item--on={isActive(item.href)} href={item.href}>
					<span class="nav__key">{item.key}</span>
					<span class="nav__label">{item.label}</span>
				</a>
			{/each}
		</nav>
	</header>

	<main class="page">
		{@render children()}
	</main>

	<footer class="footer">
		<span>NIGHTWATCH RADIO</span>
		<span class="sep">•</span>
		<span>LOCAL TRANSMISSION ONLY</span>
		<span class="spacer"></span>
		<span class="footer__motto">FOR WHOEVER IS STILL AWAKE</span>
	</footer>
</div>

<style>
	.chassis {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.masthead {
		position: sticky;
		top: 0;
		z-index: 50;
		background: linear-gradient(180deg, rgba(4, 6, 10, 0.98), rgba(4, 6, 10, 0.9));
		backdrop-filter: blur(2px);
		border-bottom: 1px solid var(--line);
	}

	.masthead__strip {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 7px var(--gutter) 6px;
		font-size: 9.5px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-3);
		max-width: 1280px;
		margin: 0 auto;
		width: 100%;
	}

	.ident {
		color: var(--ink);
	}

	.sep {
		color: var(--line-bright);
	}

	.spacer {
		flex: 1;
	}

	.clockdate {
		color: var(--ink-3);
	}

	.clock {
		font-family: var(--crt);
		font-size: 15px;
		letter-spacing: 0.1em;
		color: var(--ink);
		min-width: 74px;
		text-align: right;
	}

	.nav {
		display: flex;
		gap: 0;
		max-width: 1280px;
		margin: 0 auto;
		width: 100%;
		padding: 0 var(--gutter);
	}

	.nav__item {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 9px 16px 8px;
		border: 1px solid transparent;
		border-bottom: 0;
		font-size: 10px;
		letter-spacing: 0.22em;
		color: var(--ink-3);
		position: relative;
		top: 1px;
	}

	.nav__item:hover {
		color: var(--ink);
		background: rgba(255, 255, 255, 0.04);
	}

	.nav__item--on {
		color: var(--ink);
		border-color: var(--line-2);
		background: var(--void);
		box-shadow: inset 0 1px 0 var(--ink-3);
	}

	.nav__item--on::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 1px;
		background: var(--void);
	}

	.nav__key {
		font-size: 8.5px;
		color: var(--ink-3);
		border: 1px solid currentColor;
		padding: 0 3px;
		line-height: 1.3;
	}

	.nav__item--on .nav__key {
		color: var(--ink);
	}

	.page {
		flex: 1;
	}

	.footer {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 8px var(--gutter);
		border-top: 1px solid var(--line);
		font-size: 9px;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		color: var(--ink-3);
		max-width: 1280px;
		margin: 0 auto;
		width: 100%;
	}

	.footer__motto {
		color: var(--magenta-dim);
	}

	@media (max-width: 720px) {
		.masthead__strip > span:nth-child(n + 4):nth-child(-n + 7) {
			display: none;
		}

		.nav__item {
			padding: 8px 10px;
			letter-spacing: 0.12em;
		}
	}
</style>
