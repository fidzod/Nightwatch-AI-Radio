<script lang="ts">
	import { enhance } from '$app/forms';
	import Wireframe from '#lib/components/Wireframe.svelte';
	import { formatDuration, nullDash } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let creating = $state(false);

	const previewsFor = (id: number) => data.previews.filter((p) => p.collection_id === id).slice(0, 5);

	const fileName = (path: string) => path.split('/').pop() ?? path;
</script>

<div class="page-head">
	<div>
		<span class="label label--cyan">LIBRARY / TAPE SHELF</span>
		<h1 class="page-title">Collections</h1>
	</div>
	<div class="strip">
		<span>{data.collections.length} SLEEVES</span>
		<span class="strip__sep"></span>
		<span>{data.previews.length} TRACKS</span>
		<span class="strip__sep"></span>
		<button class="btn btn--sm" onclick={() => (creating = !creating)}>
			{creating ? '− CLOSE' : '+ NEW COLLECTION'}
		</button>
	</div>
</div>

{#if form?.error}
	<p class="flash flash--error" style="margin-bottom:16px">ERR // {form.error}</p>
{/if}

{#if creating}
	<div class="terminal" data-title="NEW COLLECTION" style="margin-bottom:22px">
		<form method="POST" action="?/create" use:enhance class="newform">
			<label class="field">
				<span class="field__label">Name</span>
				<input name="name" type="text" placeholder="rain on the window" required />
				<span class="field__hint">
					Files land in audio/library/&lt;slug&gt;/ — keep it short and filesystem-friendly.
				</span>
			</label>
			<label class="field">
				<span class="field__label">Mood tag</span>
				<input name="mood_tag" type="text" placeholder="melancholic / sparse / warm" />
			</label>
			<label class="field" style="grid-column:1 / -1">
				<span class="field__label">Description</span>
				<textarea
					name="description"
					rows="3"
					placeholder="what this tape is for, and when it should play"
				></textarea>
			</label>
			<div class="row" style="grid-column:1 / -1">
				<button class="btn btn--green" type="submit">▌ COMMIT</button>
				<button class="btn btn--ghost" type="button" onclick={() => (creating = false)}>
					CANCEL
				</button>
			</div>
		</form>
	</div>
{/if}

{#if data.collections.length === 0}
	<div class="empty">shelf empty — no collections registered</div>
{:else}
	<div class="shelf">
		{#each data.collections as collection, index}
			<article class="jcard">
				<div class="jcard__spine">
					<span class="jcard__spine-text">{collection.name}</span>
					<span class="jcard__spine-mood">{nullDash(collection.mood_tag, 'UNTAGGED')}</span>
				</div>

				<div class="jcard__face">
					<header class="jcard__head">
						<span class="label">COLLECTION № {String(index + 1).padStart(2, '0')}</span>
						<a class="jcard__name" href="/collections/{collection.id}">{collection.name}</a>
						<div class="row" style="gap:6px">
							{#if collection.mood_tag}
								<span class="tag">{collection.mood_tag}</span>
							{:else}
								<span class="tag tag--off">no mood tag</span>
							{/if}
							<span class="tag">{collection.track_count} TRK</span>
							<span class="tag">{formatDuration(collection.total_seconds)}</span>
						</div>
					</header>

					<p class="jcard__desc">
						{nullDash(collection.description, 'No sleeve notes.')}
					</p>

					<div class="jcard__list">
						<span class="label">SIDE A</span>
						{#each previewsFor(collection.id) as track, i}
							<div class="trk">
								<span class="trk__n">A{i + 1}</span>
								<span class="trk__t">{track.title ?? fileName(track.file_path)}</span>
								<span class="trk__lead"></span>
								<span class="trk__d">{formatDuration(track.duration_seconds)}</span>
							</div>
						{:else}
							<div class="trk trk--empty">— blank tape —</div>
						{/each}
						{#if collection.track_count > 5}
							<div class="trk trk--more">+ {collection.track_count - 5} more on the insert</div>
						{/if}
					</div>

					<footer class="jcard__foot">
						<div class="reels" aria-hidden="true">
							<span class="reel"></span>
							<span class="reel-line"></span>
							<span class="reel"></span>
						</div>
						<a class="btn btn--sm" href="/collections/{collection.id}">OPEN SLEEVE ▸</a>
					</footer>
				</div>
			</article>
		{/each}
	</div>
{/if}

<div class="shelf-foot">
	<Wireframe variant="torus" size={120} opacity={0.3} />
	<p class="mono-sm dim">
		Each sleeve writes to audio/library/&lt;slug&gt;/. Durations are probed with ffprobe at
		upload time; the engine reads these rows to resolve /next-music.
	</p>
</div>

<style>
	.newform {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 0 18px;
	}

	.shelf {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
		gap: 18px;
	}

	/* --- the J-card itself ---------------------------------------------------- */
	.jcard {
		display: flex;
		border: 1px solid var(--line-2);
		background:
			radial-gradient(120% 90% at 85% 0%, rgba(34, 163, 168, 0.12), transparent 60%),
			linear-gradient(170deg, rgba(10, 17, 25, 0.95), rgba(4, 6, 10, 0.98));
		position: relative;
		min-height: 260px;
	}

	.jcard::after {
		/* fold line between spine and face, like a real insert crease */
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 46px;
		border-left: 1px dashed rgba(33, 76, 89, 0.7);
		pointer-events: none;
	}

	.jcard__spine {
		flex: 0 0 46px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 14px 0;
		writing-mode: vertical-rl;
		text-orientation: mixed;
		background: linear-gradient(90deg, rgba(153, 35, 63, 0.12), transparent);
	}

	.jcard__spine-text {
		font-family: var(--crt);
		font-size: 20px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-height: 190px;
	}

	.jcard__spine-mood {
		font-size: 8.5px;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: var(--ink-3);
		white-space: nowrap;
	}

	.jcard__face {
		flex: 1;
		min-width: 0;
		padding: 15px 16px 13px;
		display: flex;
		flex-direction: column;
		gap: 11px;
	}

	.jcard__head {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.jcard__name {
		font-family: var(--crt);
		font-size: 27px;
		line-height: 1;
		letter-spacing: 0.03em;
		color: var(--bone);
	}

	.jcard__desc {
		font-size: 11px;
		line-height: 1.7;
		color: var(--ink-2);
		border-left: 1px solid var(--line);
		padding-left: 10px;
	}

	.jcard__list {
		flex: 1;
		border-top: 1px dotted var(--line-2);
		padding-top: 9px;
	}

	.trk {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 11px;
		line-height: 1.85;
	}

	.trk__n {
		color: var(--ink-3);
		font-size: 9.5px;
		letter-spacing: 0.1em;
		min-width: 18px;
	}

	.trk__t {
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 62%;
	}

	.trk__lead {
		flex: 1;
		border-bottom: 1px dotted rgba(33, 76, 89, 0.55);
		transform: translateY(-3px);
	}

	.trk__d {
		color: var(--ink-2);
		font-size: 10.5px;
	}

	.trk--empty,
	.trk--more {
		color: var(--ink-3);
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.jcard__foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border-top: 1px solid var(--line);
		padding-top: 10px;
	}

	.reels {
		display: flex;
		align-items: center;
		gap: 0;
	}

	.reel {
		width: 17px;
		height: 17px;
		border: 1px solid var(--line-bright);
		border-radius: 50%;
		position: relative;
	}

	.reel::after {
		content: '';
		position: absolute;
		inset: 5px;
		border: 1px solid var(--cyan-deep);
		border-radius: 50%;
	}

	.reel-line {
		width: 34px;
		height: 1px;
		background: var(--line-2);
	}

	.shelf-foot {
		display: flex;
		align-items: center;
		gap: 20px;
		margin-top: 34px;
		padding-top: 16px;
		border-top: 1px solid var(--line);
	}

	.shelf-foot p {
		max-width: 60ch;
	}

	@media (max-width: 560px) {
		.jcard__spine {
			display: none;
		}

		.jcard::after {
			display: none;
		}
	}
</style>
