<script lang="ts">
	import { enhance } from '$app/forms';
	import KV from '#lib/components/KV.svelte';
	import Panel from '#lib/components/Panel.svelte';
	import Wireframe from '#lib/components/Wireframe.svelte';
	import { dayName, formatDuration, nullDash } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let uploading = $state(false);

	const totalSeconds = $derived(
		data.tracks.reduce((sum, t) => sum + (t.duration_seconds ?? 0), 0)
	);

	// mixtape sides: first half on A, remainder on B
	const sideA = $derived(data.tracks.slice(0, Math.ceil(data.tracks.length / 2)));
	const sideB = $derived(data.tracks.slice(Math.ceil(data.tracks.length / 2)));

	const fileName = (path: string) => path.split('/').pop() ?? path;
</script>

<div class="page-head">
	<div>
		<span class="label label--cyan">
			<a href="/collections">◂ TAPE SHELF</a> / SLEEVE № {String(data.collection.id).padStart(2, '0')}
		</span>
		<h1 class="page-title">{data.collection.name}</h1>
	</div>
	<div class="strip">
		<span>{data.tracks.length} TRACKS</span>
		<span class="strip__sep"></span>
		<span>{formatDuration(totalSeconds)} TOTAL</span>
		<span class="strip__sep"></span>
		<button class="btn btn--sm btn--green" onclick={() => (uploading = !uploading)}>
			{uploading ? '− CLOSE INGEST' : '▲ INGEST AUDIO'}
		</button>
	</div>
</div>

{#if form?.error}
	<p class="flash flash--error" style="margin-bottom:16px">ERR // {form.error}</p>
{:else if form?.ok}
	<p class="flash flash--ok" style="margin-bottom:16px">OK // {form.ok}</p>
{/if}

{#if uploading}
	<div class="terminal" data-title="INGEST — audio/library/{data.collection.name}" style="margin-bottom:22px">
		<form method="POST" action="?/upload" enctype="multipart/form-data" use:enhance>
			<label class="field">
				<span class="field__label">Source files</span>
				<input name="files" type="file" accept="audio/*,.mp3,.flac,.ogg,.m4a,.wav" multiple required />
				<span class="field__hint">
					Written to {data.libraryDir}/ · duration + ID3 title/artist probed with ffprobe ·
					sha256 dedupe against this collection.
				</span>
			</label>
			<div class="row">
				<button class="btn btn--green" type="submit">▌ TRANSFER</button>
				<button class="btn btn--ghost" type="button" onclick={() => (uploading = false)}>
					CANCEL
				</button>
			</div>
		</form>
	</div>
{/if}

<div class="sleeve">
	<!-- ============================ the insert ============================ -->
	<article class="insert">
		<div class="insert__spine">
			<span class="insert__spine-text">{data.collection.name}</span>
			<span class="insert__spine-mood">NIGHTWATCH RADIO · {nullDash(data.collection.mood_tag, 'UNTAGGED')}</span>
		</div>

		<div class="insert__face">
			<header class="insert__head">
				<div>
					<span class="label">TRACKLIST</span>
					<div class="readout readout--bone">{data.collection.name}</div>
				</div>
				<Wireframe variant="globe" size={78} opacity={0.35} color="var(--magenta-dim)" />
			</header>

			<p class="insert__notes">{nullDash(data.collection.description, 'No sleeve notes.')}</p>

			{#if data.tracks.length === 0}
				<div class="empty">blank tape — ingest audio to fill this sleeve</div>
			{:else}
				<div class="sides">
					{#each [{ label: 'SIDE A', rows: sideA, prefix: 'A' }, { label: 'SIDE B', rows: sideB, prefix: 'B' }] as side}
						<section class="side">
							<h2 class="side__label">{side.label}</h2>
							{#if side.rows.length === 0}
								<p class="mono-sm dim">—</p>
							{/if}
							{#each side.rows as track, i}
								<details class="trk">
									<summary class="trk__row">
										<span class="trk__n">{side.prefix}{i + 1}</span>
										<span class="trk__t">{nullDash(track.title, fileName(track.file_path))}</span>
										<span class="trk__lead"></span>
										<span class="trk__a">{nullDash(track.artist, '')}</span>
										<span class="trk__d">{formatDuration(track.duration_seconds)}</span>
									</summary>

									<div class="trk__edit">
										<form method="POST" action="?/updateTrack" use:enhance class="trk__form">
											<input type="hidden" name="track_id" value={track.id} />
											<label class="field">
												<span class="field__label">Title</span>
												<input name="title" type="text" value={track.title ?? ''} />
											</label>
											<label class="field">
												<span class="field__label">Artist</span>
												<input name="artist" type="text" value={track.artist ?? ''} />
											</label>
											<div class="row">
												<button class="btn btn--sm btn--green" type="submit">SAVE</button>
											</div>
										</form>

										<div class="trk__meta">
											<KV k="FILE" v={fileName(track.file_path)} />
											<KV k="PATH" v={track.file_path} tone="dim" />
											<KV k="PLAYS" v={track.play_count} />
											<KV k="LAST" v={track.last_played_at ?? null} tone="dim" />
											<KV k="SUM" v={track.checksum?.slice(0, 12) ?? null} tone="dim" />
											<form
												method="POST"
												action="?/deleteTrack"
												use:enhance
												onsubmit={(event) => {
													if (!confirm(`Remove "${track.title ?? fileName(track.file_path)}" from this collection?`))
														event.preventDefault();
												}}
											>
												<input type="hidden" name="track_id" value={track.id} />
												<label class="check-row" style="margin:9px 0">
													<input type="checkbox" name="delete_file" />
													ALSO DELETE FILE FROM DISK
												</label>
												<button class="btn btn--sm btn--danger" type="submit">✕ REMOVE TRACK</button>
											</form>
										</div>
									</div>
								</details>
							{/each}
						</section>
					{/each}
				</div>
			{/if}

			<footer class="insert__foot">
				<span>NIGHTWATCH RADIO</span>
				<span class="dim">·</span>
				<span>{data.tracks.length} TRK</span>
				<span class="dim">·</span>
				<span>{formatDuration(totalSeconds)}</span>
				<span class="spacer"></span>
				<span class="dim">DOLBY B NR · TYPE I</span>
			</footer>
		</div>
	</article>

	<!-- ============================ side rail ============================= -->
	<aside class="stack">
		<div class="terminal" data-title="EDIT COLLECTION">
			<form method="POST" action="?/update" use:enhance>
				<label class="field">
					<span class="field__label">Name</span>
					<input name="name" type="text" value={data.collection.name} required />
					<span class="field__hint">
						Renaming changes where new uploads land; files already on disk stay put.
					</span>
				</label>
				<label class="field">
					<span class="field__label">Mood tag</span>
					<input name="mood_tag" type="text" value={data.collection.mood_tag ?? ''} />
				</label>
				<label class="field">
					<span class="field__label">Sleeve notes</span>
					<textarea name="description" rows="4">{data.collection.description ?? ''}</textarea>
				</label>
				<button class="btn btn--green" type="submit">▌ SAVE</button>
			</form>
		</div>

		<Panel title="LIBRARY PATH">
			<KV k="DIR" v={data.libraryDir} tone="dim" />
			<KV k="CREATED" v={data.collection.created_at} tone="dim" />
			<KV k="UPDATED" v={data.collection.updated_at} tone="dim" />
		</Panel>

		<Panel title="SCHEDULED IN" meta={`${data.slots.length} SLOT`}>
			{#if data.slots.length === 0}
				<p class="mono-sm dim">
					Not on the schedule. Add a slot on the <a href="/schedule">schedule</a> page.
				</p>
			{:else}
				{#each data.slots.slice(0, 8) as slot}
					<KV
						k={dayName(slot.day_of_week)}
						v={`${slot.start_time}–${slot.end_time} · ${slot.presenter_name}`}
						tone="cyan"
					/>
				{/each}
				{#if data.slots.length > 8}
					<p class="mono-sm dim" style="margin-top:8px">
						+ {data.slots.length - 8} more — see the <a href="/schedule">schedule</a>.
					</p>
				{/if}
			{/if}
		</Panel>

		<Panel title="DANGER" tone="alert">
			<form
				method="POST"
				action="?/delete"
				use:enhance
				onsubmit={(event) => {
					if (!confirm(`Delete "${data.collection.name}" and all ${data.tracks.length} track rows? Files on disk are kept.`))
						event.preventDefault();
				}}
			>
				<p class="mono-sm dim" style="margin-bottom:10px">
					Removes the collection and its track rows. Audio files are left on disk.
				</p>
				<button class="btn btn--danger" type="submit">✕ DELETE COLLECTION</button>
			</form>
		</Panel>
	</aside>
</div>

<style>
	.sleeve {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: 18px;
		align-items: start;
	}

	/* --- insert --------------------------------------------------------------- */
	.insert {
		display: flex;
		border: 1px solid var(--line-2);
		background:
			radial-gradient(130% 80% at 80% 0%, rgba(29, 138, 141, 0.1), transparent 62%),
			linear-gradient(175deg, rgba(10, 17, 25, 0.96), rgba(4, 6, 10, 0.99));
		position: relative;
		min-width: 0;
	}

	.insert::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 54px;
		border-left: 1px dashed rgba(33, 76, 89, 0.7);
	}

	.insert__spine {
		flex: 0 0 54px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 18px 0;
		writing-mode: vertical-rl;
		background: linear-gradient(90deg, rgba(153, 50, 95, 0.14), transparent);
	}

	.insert__spine-text {
		font-family: var(--crt);
		font-size: 24px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--cyan);
		text-shadow: var(--glow-cyan);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.insert__spine-mood {
		font-size: 8.5px;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--magenta-dim);
		white-space: nowrap;
	}

	.insert__face {
		flex: 1;
		min-width: 0;
		padding: 18px 20px 14px;
	}

	.insert__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		border-bottom: 1px solid var(--line);
		padding-bottom: 12px;
	}

	.insert__notes {
		font-size: 11.5px;
		line-height: 1.75;
		color: var(--ink-2);
		margin: 12px 0 16px;
		border-left: 1px solid var(--line);
		padding-left: 11px;
		max-width: 72ch;
	}

	.sides {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 10px 26px;
	}

	.side__label {
		font-size: 9.5px;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: var(--magenta);
		border-bottom: 1px solid var(--magenta-dim);
		padding-bottom: 4px;
		margin-bottom: 7px;
		font-weight: 400;
	}

	/* these summaries are tracklist rows, not the global disclosure label */
	.trk__row {
		display: flex;
		align-items: baseline;
		gap: 9px;
		font-size: 11.5px;
		line-height: 2;
		cursor: pointer;
		list-style: none;
		text-transform: none;
		letter-spacing: 0.01em;
		color: var(--ink);
	}

	.trk__row::before {
		content: '▸';
		font-size: 8px;
		color: var(--cyan-deep);
		margin-right: -3px;
	}

	.trk[open] .trk__row::before {
		content: '▾';
		color: var(--cyan);
	}

	.trk__row::-webkit-details-marker {
		display: none;
	}

	.trk__row:hover .trk__t {
		color: var(--cyan);
	}

	.trk__n {
		color: var(--magenta-dim);
		font-size: 9.5px;
		letter-spacing: 0.1em;
		min-width: 20px;
	}

	.trk__t {
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 50%;
	}

	.trk__lead {
		flex: 1;
		border-bottom: 1px dotted rgba(33, 76, 89, 0.55);
		transform: translateY(-3px);
		min-width: 10px;
	}

	.trk__a {
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
		white-space: nowrap;
		max-width: 30%;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.trk__d {
		color: var(--cyan-dim);
		font-size: 10.5px;
		min-width: 40px;
		text-align: right;
	}

	.trk__edit {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 16px;
		border: 1px solid var(--green-deep);
		background: rgba(4, 12, 8, 0.6);
		padding: 13px;
		margin: 4px 0 12px;
	}

	.trk__meta {
		border-left: 1px dashed var(--line);
		padding-left: 12px;
	}

	.insert__foot {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 18px;
		padding-top: 9px;
		border-top: 1px solid var(--line);
		font-size: 9px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.spacer {
		flex: 1;
	}

	@media (max-width: 1040px) {
		.sleeve {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 560px) {
		.insert__spine {
			display: none;
		}
		.insert::after {
			display: none;
		}
	}
</style>
