<script lang="ts">
	import KV from '#lib/components/KV.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import Wireframe from '#lib/components/Wireframe.svelte';
	import { clockOf, dayName, formatDuration, formatElapsed } from '#lib/format.ts';
	import type { LivePayload } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const STREAM_URL = 'http://localhost:8000/nightwatch.mp3';
	const POLL_MS = 4000;

	// `data` is the SSR snapshot; polling replaces it with fresher payloads.
	let polled: LivePayload | null = $state(null);
	const payload = $derived(polled ?? data);

	const snap = $derived(payload.snapshot);
	const stationState = $derived(snap.state);

	// --- running counters (purely client-side; the ritual of the ticking clock)
	let sessionSeconds = $state(0);
	let nowMs = $state(Date.now());
	let pollError = $state(false);

	$effect(() => {
		const id = setInterval(() => {
			sessionSeconds += 1;
			nowMs = Date.now();
		}, 1000);
		return () => clearInterval(id);
	});

	$effect(() => {
		let cancelled = false;
		const poll = async () => {
			try {
				const res = await fetch('/api/live', { headers: { accept: 'application/json' } });
				if (!res.ok) throw new Error(String(res.status));
				const next = await res.json();
				if (!cancelled) {
					polled = next;
					pollError = false;
				}
			} catch {
				if (!cancelled) pollError = true;
			}
		};
		const id = setInterval(poll, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	});

	// --- current item progress -------------------------------------------------
	const startedMs = $derived.by(() => {
		const raw = stationState?.current_item_started_at;
		if (!raw) return null;
		const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)
			? raw.replace(' ', 'T')
			: raw.replace(' ', 'T') + 'Z';
		const ms = Date.parse(normalized);
		return Number.isFinite(ms) ? ms : null;
	});

	const itemElapsed = $derived(
		startedMs === null ? null : Math.max(0, Math.floor((nowMs - startedMs) / 1000))
	);

	const itemProgress = $derived.by(() => {
		const total = stationState?.current_item_duration ?? null;
		if (!total || itemElapsed === null) return null;
		return Math.min(1, itemElapsed / total);
	});

	const alerts = $derived.by(() => {
		const list: string[] = [];
		if (!snap.onAir) list.push('NO ENGINE HEARTBEAT');
		if (pollError) list.push('CONSOLE POLL FAILED');
		if (snap.collectionCount === 0) list.push('NO COLLECTIONS REGISTERED');
		if (snap.slotCount === 0) list.push('SCHEDULE EMPTY');
		return list;
	});

	// --- receiver --------------------------------------------------------------
	let audioEl: HTMLAudioElement | null = $state(null);
	let receiver: 'idle' | 'tuning' | 'locked' | 'lost' = $state('idle');
	let volume = $state(0.8);

	$effect(() => {
		if (audioEl) audioEl.volume = volume;
	});

	async function tuneIn() {
		if (!audioEl) return;
		if (receiver === 'locked' || receiver === 'tuning') {
			audioEl.pause();
			// force a fresh connection next time; a paused icecast stream goes stale
			audioEl.removeAttribute('src');
			audioEl.load();
			receiver = 'idle';
			return;
		}
		receiver = 'tuning';
		audioEl.src = `${STREAM_URL}?t=${Date.now()}`;
		try {
			await audioEl.play();
		} catch {
			receiver = 'lost';
		}
	}

	const receiverLabel = $derived(
		{
			idle: 'STANDBY',
			tuning: 'ACQUIRING',
			locked: 'CARRIER LOCKED',
			lost: 'NO CARRIER'
		}[receiver]
	);
</script>

<div class="page-head">
	<div>
		<span class="label label--cyan">SPCNET / NIGHTWATCH — DEEP MAP</span>
		<h1 class="page-title">On Air Now</h1>
	</div>
	<div class="strip">
		<span class:ok={snap.onAir} class:hot={!snap.onAir}>
			{snap.onAir ? '● ON AIR' : '○ OFF AIR'}
		</span>
		<span class="strip__sep"></span>
		<span>T+ {formatElapsed(sessionSeconds)}</span>
		<span class="strip__sep"></span>
		<span class:hot={alerts.length > 0}>ALERTS : {alerts.length}</span>
		<span class="strip__sep"></span>
		<span>POLL {POLL_MS / 1000}s</span>
	</div>
</div>

<div class="rulebar" aria-hidden="true">
	<div class="rulebar__labels">
		{#each ['-100', '-075', '-050', '-025', '000', '+025', '+050', '+075', '+100'] as mark}
			<span>{mark}</span>
		{/each}
	</div>
	<div class="tick-rail"></div>
</div>

<div class="hud">
	<div class="hud__main stack">
		<Panel
			title="NOW PLAYING"
			meta={stationState?.current_item_type?.toUpperCase() ?? 'IDLE'}
			tone={snap.onAir ? 'lit' : 'alert'}
		>
			<div class="now">
				<div class="now__wire">
					<Wireframe variant="orbit" size={168} opacity={0.32} spin />
				</div>
				<div class="now__body">
					<span class="label">{snap.onAir ? 'CURRENT ITEM' : 'LAST KNOWN ITEM'}</span>
					<div class="readout readout--lg" class:readout--magenta={!snap.onAir}>
						{stationState?.current_item_ref ?? 'SILENT'}
					</div>
					<div class="now__meta">
						<KV k="TYPE" v={stationState?.current_item_type?.toUpperCase() ?? null} />
						<KV k="ARTIST" v={stationState?.current_item_artist ?? null} />
						<KV k="STARTED" v={clockOf(stationState?.current_item_started_at)} />
						<KV k="LENGTH" v={formatDuration(stationState?.current_item_duration)} />
						<KV
							k="ELAPSED"
							v={itemElapsed === null ? null : formatElapsed(itemElapsed)}
						/>
					</div>

					<div class="bar" aria-hidden="true">
						<div
							class="bar__fill"
							style="width:{itemProgress === null ? 0 : Math.round(itemProgress * 100)}%"
						></div>
						<div class="bar__ticks"></div>
					</div>
				</div>
			</div>
		</Panel>

		<div class="grid-2">
			<Panel title="UP NEXT">
				<KV k="TYPE" v={stationState?.up_next_item_type?.toUpperCase() ?? null} />
				<KV k="REF" v={stationState?.up_next_item_ref ?? null} />
				<KV k="ARTIST" v={stationState?.up_next_item_artist ?? null} />
				<p class="mono-sm dim note">
					{stationState?.up_next_item_ref
						? 'Queued by the station engine.'
						: 'Nothing queued — the engine fills this as it pre-renders.'}
				</p>
			</Panel>

			<Panel title="SCHEDULE RESOLUTION" meta={`${payload.nowSlots.length} MATCH`}>
				{#if payload.nowSlots.length === 0}
					<p class="mono-sm dim note">
						No slot covers this moment. The station would run silent / fallback.
					</p>
				{:else}
					{#each payload.nowSlots.slice(0, 3) as slot, i}
						<KV
							k={i === 0 ? 'ACTIVE' : 'SHADOWED'}
							v={`${slot.presenter_name} / ${slot.collection_name}`}
							tone={i === 0 ? 'cyan' : 'dim'}
						/>
						<KV
							k="WINDOW"
							v={`${slot.recurrence_type === 'weekly' ? dayName(slot.day_of_week) : slot.specific_date} ${slot.start_time}–${slot.end_time}`}
							tone="dim"
						/>
					{/each}
				{/if}
			</Panel>
		</div>

		<Panel title="SIGNAL LOG" meta="LAST PLAYED">
			{#if payload.recent.length === 0}
				<div class="empty">no playback recorded yet</div>
			{:else}
				<ol class="log">
					{#each payload.recent as track, i}
						<li class="log__row">
							<span class="log__idx">{String(i + 1).padStart(2, '0')}</span>
							<span class="log__title">{track.title ?? track.file_path.split('/').pop()}</span>
							<span class="log__lead"></span>
							<span class="log__coll">{track.collection_name}</span>
							<span class="log__time">{clockOf(track.last_played_at)}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</Panel>
	</div>

	<aside class="hud__side stack">
		<Panel title="RECEIVER" meta="ICECAST" tone={receiver === 'locked' ? 'lit' : 'default'}>
			<div class="rx">
				<button class="rx__btn" class:rx__btn--on={receiver === 'locked'} onclick={tuneIn}>
					{receiver === 'locked' || receiver === 'tuning' ? '■ STOP' : '▶ TUNE IN'}
				</button>
				<div class="rx__status">
					<span
						class="rx__lamp"
						class:rx__lamp--on={receiver === 'locked'}
						class:rx__lamp--warn={receiver === 'tuning'}
						class:rx__lamp--bad={receiver === 'lost'}
					></span>
					<span class="label">{receiverLabel}</span>
				</div>
			</div>

			<label class="vol">
				<span class="label">GAIN</span>
				<input type="range" min="0" max="1" step="0.01" bind:value={volume} />
			</label>

			<KV k="MOUNT" v="/nightwatch.mp3" tone="cyan" />
			<KV k="HOST" v="localhost:8000" />
			{#if receiver === 'lost'}
				<p class="mono-sm hot note">
					No stream on the mount. Start LiquidSoap + Icecast, then tune in again.
				</p>
			{/if}

			<!-- the actual stream element; chrome above drives it -->
			<audio
				bind:this={audioEl}
				preload="none"
				onplaying={() => (receiver = 'locked')}
				onwaiting={() => receiver === 'locked' && (receiver = 'tuning')}
				onerror={() => (receiver = 'lost')}
				onended={() => (receiver = 'idle')}
			></audio>
		</Panel>

		<Panel title="LINK STATUS" tone={snap.onAir ? 'default' : 'alert'}>
			<KV
				k="ENGINE"
				v={snap.onAir ? 'ONLINE' : 'ABSENT'}
				tone={snap.onAir ? 'green' : 'magenta'}
			/>
			<KV
				k="HEARTBEAT"
				v={snap.heartbeatAgeSeconds === null ? null : `${snap.heartbeatAgeSeconds}s AGO`}
			/>
			<KV k="PRESENTER" v={snap.presenter?.name ?? null} tone="cyan" />
			<KV k="ROLE" v={snap.presenter?.station_role ?? null} tone="dim" />
			<KV k="COLLECTION" v={snap.collection?.name ?? null} tone="cyan" />
			<KV k="MOOD" v={snap.collection?.mood_tag ?? null} tone="dim" />
			<KV k="SLOT ID" v={stationState?.current_schedule_slot_id ?? null} />
			<KV k="STATE ROW" v={stationState ? 'PRESENT' : 'MISSING'} tone={stationState ? 'dim' : 'magenta'} />
		</Panel>

		{#if alerts.length > 0}
			<Panel title="ALERTS" tone="alert">
				<ul class="alerts">
					{#each alerts as alert}
						<li class="alerts__row"><span class="alerts__mark">⚠</span>{alert}</li>
					{/each}
				</ul>
				<p class="mono-sm dim note">
					Not an error on its own — the engine (Phase 2/3) writes station_state; until it
					runs, the console just has nothing to track.
				</p>
			</Panel>
		{/if}

		<Panel title="LEGEND" flat corners={false}>
			<div class="legend">
				<span class="legend__k ok">●</span><span>carrier / engine online</span>
				<span class="legend__k hot">○</span><span>off air, no heartbeat</span>
				<span class="legend__k">▮</span><span>item progress</span>
				<span class="legend__k warn">⚠</span><span>alert condition</span>
			</div>
			<div class="tick-rail" style="margin-top:12px"></div>
			<div class="counts">
				<span>COL {snap.collectionCount}</span>
				<span>TRK {snap.trackCount}</span>
				<span>PRS {snap.presenterCount}</span>
				<span>SLT {snap.slotCount}</span>
			</div>
		</Panel>
	</aside>
</div>

<div class="rulebar rulebar--foot" aria-hidden="true">
	<div class="tick-rail"></div>
	<div class="rulebar__meta">
		<span>SOLVER: SCHEDULE + HEARTBEAT</span>
		<span>RES {POLL_MS / 1000}.0s</span>
		<span>N={snap.slotCount}</span>
		<span>SRC {snap.collectionCount}</span>
		<span class="spacer"></span>
		<span>NIGHTWATCH · FOR A QUIETER TOMORROW</span>
	</div>
</div>

<style>
	/* the axis ruler that frames the SPCNET deep map */
	.rulebar {
		margin-bottom: 10px;
	}

	.rulebar--foot {
		margin: 16px 0 0;
	}

	.rulebar__labels,
	.rulebar__meta {
		display: flex;
		justify-content: space-between;
		font-size: 8.5px;
		letter-spacing: 0.18em;
		color: var(--ink-3);
		padding-bottom: 3px;
	}

	.rulebar__meta {
		gap: 14px;
		justify-content: flex-start;
		padding: 4px 0 0;
	}

	.rulebar__meta .spacer {
		flex: 1;
	}

	.hud {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 16px;
		align-items: start;
	}

	.hud__main,
	.hud__side {
		min-width: 0;
	}

	.now {
		display: flex;
		gap: 18px;
		align-items: center;
		position: relative;
		min-height: 150px;
	}

	.now__wire {
		flex: 0 0 auto;
		opacity: 0.9;
	}

	.now__body {
		flex: 1;
		min-width: 0;
	}

	.now__body .readout {
		margin: 6px 0 14px;
		word-break: break-word;
	}

	.now__meta {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 26px;
	}

	.bar {
		position: relative;
		height: 10px;
		margin-top: 14px;
		border: 1px solid var(--line-2);
		background: rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}

	.bar__fill {
		position: absolute;
		inset: 0 auto 0 0;
		background: linear-gradient(90deg, var(--cyan-deep), var(--cyan));
		box-shadow: 0 0 12px rgba(73, 229, 224, 0.5);
		transition: width 900ms linear;
	}

	.bar__ticks {
		position: absolute;
		inset: 0;
		background-image: repeating-linear-gradient(
			90deg,
			rgba(4, 6, 10, 0.9) 0,
			rgba(4, 6, 10, 0.9) 1px,
			transparent 1px,
			transparent 9px
		);
	}

	.note {
		margin-top: 10px;
		line-height: 1.6;
	}

	/* --- signal log ---------------------------------------------------------- */
	.log__row {
		display: flex;
		align-items: baseline;
		gap: 9px;
		font-size: 11.5px;
		padding: 3px 0;
		border-bottom: 1px dotted rgba(33, 76, 89, 0.5);
	}

	.log__idx {
		color: var(--magenta-dim);
		font-size: 10px;
	}

	.log__title {
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 46%;
	}

	.log__lead {
		flex: 1;
	}

	.log__coll {
		font-size: 10px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.log__time {
		color: var(--cyan);
		font-size: 11px;
	}

	/* --- receiver ------------------------------------------------------------ */
	.rx {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 14px;
	}

	.rx__btn {
		font-family: var(--mono);
		font-size: 11px;
		letter-spacing: 0.2em;
		color: var(--cyan);
		background: rgba(13, 74, 82, 0.25);
		border: 1px solid var(--cyan-dim);
		padding: 10px 16px;
		cursor: pointer;
	}

	.rx__btn:hover {
		background: rgba(73, 229, 224, 0.16);
		box-shadow: 0 0 16px rgba(73, 229, 224, 0.2);
	}

	.rx__btn--on {
		color: var(--magenta);
		border-color: var(--magenta-dim);
		background: rgba(153, 50, 95, 0.2);
	}

	.rx__status {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.rx__lamp {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		border: 1px solid var(--line-bright);
		background: #061016;
	}

	.rx__lamp--on {
		background: var(--green);
		border-color: var(--green);
		box-shadow: var(--glow-green);
		animation: pulse 2.4s ease-in-out infinite;
	}

	.rx__lamp--warn {
		background: var(--amber);
		border-color: var(--amber);
		animation: pulse 700ms linear infinite;
	}

	.rx__lamp--bad {
		background: var(--red);
		border-color: var(--red);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}

	.vol {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}

	.vol input[type='range'] {
		appearance: none;
		flex: 1;
		height: 2px;
		background: var(--line-2);
		padding: 0;
		border: 0;
	}

	.vol input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 9px;
		height: 16px;
		background: var(--cyan);
		box-shadow: var(--glow-cyan);
		cursor: pointer;
	}

	.vol input[type='range']::-moz-range-thumb {
		width: 9px;
		height: 16px;
		border: 0;
		border-radius: 0;
		background: var(--cyan);
		cursor: pointer;
	}

	/* --- alerts / legend ----------------------------------------------------- */
	.alerts__row {
		display: flex;
		gap: 9px;
		font-size: 11px;
		letter-spacing: 0.1em;
		color: #ffd3e8;
		padding: 2px 0;
	}

	.alerts__mark {
		color: var(--magenta);
	}

	.legend {
		display: grid;
		grid-template-columns: 18px 1fr;
		gap: 4px 8px;
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
		align-items: center;
	}

	.legend__k {
		text-align: center;
		color: var(--ink-2);
	}

	.counts {
		display: flex;
		gap: 12px;
		margin-top: 10px;
		font-size: 10px;
		letter-spacing: 0.16em;
		color: var(--ink-3);
	}

	@media (max-width: 980px) {
		.hud {
			grid-template-columns: minmax(0, 1fr);
		}

		.now__wire {
			display: none;
		}
	}
</style>
