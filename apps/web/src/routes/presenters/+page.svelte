<script lang="ts">
	import { enhance } from '$app/forms';
	import Wireframe from '#lib/components/Wireframe.svelte';
	import { nullDash } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let adding = $state(false);

	const usageFor = (id: number) =>
		data.usage.find((u) => u.presenter_id === id) ?? { slot_count: 0, clip_count: 0 };
</script>

<div class="page-head">
	<div>
		<span class="label label--green">OPERATOR ROSTER / VOICE DOSSIERS</span>
		<h1 class="page-title">Presenters</h1>
	</div>
	<div class="strip">
		<span>{data.presenters.length} ON ROSTER</span>
		<span class="strip__sep"></span>
		<span>{data.presenters.filter((p) => p.active).length} ACTIVE</span>
		<span class="strip__sep"></span>
		<button class="btn btn--sm btn--green" onclick={() => (adding = !adding)}>
			{adding ? '− CLOSE' : '+ NEW PRESENTER'}
		</button>
	</div>
</div>

{#if form?.error}
	<p class="flash flash--error" style="margin-bottom:16px">ERR // {form.error}</p>
{:else if form?.ok}
	<p class="flash flash--ok" style="margin-bottom:16px">OK // {form.ok}</p>
{/if}

{#if adding}
	<div class="terminal" data-title="NEW PRESENTER — DOSSIER ENTRY" style="margin-bottom:24px">
		<form method="POST" action="?/create" use:enhance>
			<div class="cols">
				<label class="field">
					<span class="field__label">Name</span>
					<input name="name" type="text" required placeholder="e.g. Vesper" />
				</label>
				<label class="field">
					<span class="field__label">Station role</span>
					<input name="station_role" type="text" placeholder="Weekend relief — 19:00-21:00" />
				</label>
				<label class="field">
					<span class="field__label">Tone description</span>
					<input name="tone_description" type="text" />
				</label>
				<label class="field">
					<span class="field__label">ElevenLabs voice id</span>
					<input name="elevenlabs_voice_id" type="text" placeholder="(optional — pick later)" />
				</label>
			</div>
			<label class="field">
				<span class="field__label">Voice archetype notes</span>
				<input name="voice_archetype_notes" type="text" placeholder="register / texture / pace / affect" />
			</label>
			<label class="field">
				<span class="field__label">System prompt</span>
				<textarea name="system_prompt" rows="10" required></textarea>
			</label>
			<label class="check-row" style="margin-bottom:14px">
				<input type="checkbox" name="active" checked />
				ACTIVE
			</label>
			<div class="row">
				<button class="btn btn--green" type="submit">▌ COMMIT TO ROSTER</button>
				<button class="btn btn--ghost" type="button" onclick={() => (adding = false)}>CANCEL</button>
			</div>
		</form>
	</div>
{/if}

{#if data.presenters.length === 0}
	<div class="empty">roster empty — no presenters registered</div>
{:else}
	<div class="roster">
		{#each data.presenters as presenter (presenter.id)}
			{@const usage = usageFor(presenter.id)}
			<article class="dossier" class:dossier--off={!presenter.active}>
				<header class="dossier__head">
					<div class="dossier__id">
						<span class="label label--green">OPERATOR {String(presenter.id).padStart(3, '0')}</span>
						<h2 class="dossier__name">{presenter.name}</h2>
						<p class="dossier__role">{nullDash(presenter.station_role, 'unassigned')}</p>
					</div>
					<div class="dossier__lamps">
						<span class="tag" class:tag--green={!!presenter.active} class:tag--off={!presenter.active}>
							{presenter.active ? 'ACTIVE' : 'STOOD DOWN'}
						</span>
						<span class="tag" class:tag--cyan={!!presenter.elevenlabs_voice_id} class:tag--off={!presenter.elevenlabs_voice_id}>
							{presenter.elevenlabs_voice_id ? 'VOICE BOUND' : 'NO VOICE ID'}
						</span>
					</div>
				</header>

				<dl class="dossier__specs">
					<div><dt>TONE</dt><dd>{nullDash(presenter.tone_description)}</dd></div>
					<div><dt>VOICE</dt><dd>{nullDash(presenter.voice_archetype_notes)}</dd></div>
					<div>
						<dt>USAGE</dt>
						<dd>{usage.slot_count} slot(s) · {usage.clip_count} clip(s) generated</dd>
					</div>
				</dl>

				<pre class="dossier__prompt">{presenter.system_prompt}</pre>

				<details class="dossier__edit">
					<summary>EDIT DOSSIER {presenter.name.toUpperCase()}</summary>
					<div class="terminal" data-title="DOSSIER {presenter.name.toUpperCase()}">
						<form method="POST" action="?/update" use:enhance>
							<input type="hidden" name="id" value={presenter.id} />
							<div class="cols">
								<label class="field">
									<span class="field__label">Name</span>
									<input name="name" type="text" value={presenter.name} required />
								</label>
								<label class="field">
									<span class="field__label">Station role</span>
									<input name="station_role" type="text" value={presenter.station_role} />
								</label>
								<label class="field">
									<span class="field__label">Tone description</span>
									<input name="tone_description" type="text" value={presenter.tone_description} />
								</label>
								<label class="field">
									<span class="field__label">ElevenLabs voice id</span>
									<input
										name="elevenlabs_voice_id"
										type="text"
										value={presenter.elevenlabs_voice_id ?? ''}
										placeholder="(unset — browse the ElevenLabs library)"
									/>
									<span class="field__hint">
										Optional. Match the voice archetype notes below when you pick one.
									</span>
								</label>
							</div>
							<label class="field">
								<span class="field__label">Voice archetype notes</span>
								<input
									name="voice_archetype_notes"
									type="text"
									value={presenter.voice_archetype_notes}
								/>
							</label>
							<label class="field">
								<span class="field__label">System prompt</span>
								<textarea name="system_prompt" rows="18" required>{presenter.system_prompt}</textarea>
								<span class="field__hint">
									Read fresh from this table on every generation — edits apply to the next clip.
								</span>
							</label>
							<label class="check-row" style="margin-bottom:14px">
								<input type="checkbox" name="active" checked={!!presenter.active} />
								ACTIVE
							</label>
							<div class="row">
								<button class="btn btn--green" type="submit">▌ SAVE DOSSIER</button>
							</div>
						</form>

						<form
							method="POST"
							action="?/delete"
							use:enhance
							class="dossier__danger"
							onsubmit={(event) => {
								if (!confirm(`Remove ${presenter.name} from the roster?`)) event.preventDefault();
							}}
						>
							<input type="hidden" name="id" value={presenter.id} />
							<button class="btn btn--sm btn--danger" type="submit">✕ REMOVE FROM ROSTER</button>
							<span class="mono-sm dim">
								Blocked while slots or generated clips still reference them.
							</span>
						</form>
					</div>
				</details>
			</article>
		{/each}
	</div>
{/if}

<div class="roster-foot">
	<Wireframe variant="funnel" size={110} opacity={0.28} color="var(--green-dim)" />
	<p class="mono-sm dim">
		Voice IDs are deliberately unset: pick them by auditioning the ElevenLabs library against
		each archetype note, then paste the id here.
	</p>
</div>

<style>
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
		gap: 0 18px;
	}

	.roster {
		display: grid;
		gap: 18px;
	}

	.dossier {
		border: 1px solid var(--green-deep);
		background:
			linear-gradient(180deg, rgba(8, 20, 13, 0.6), rgba(4, 8, 6, 0.9));
		padding: 16px 18px;
		position: relative;
	}

	.dossier::before {
		/* punched-card stripe down the left edge */
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 3px;
		background: repeating-linear-gradient(
			180deg,
			var(--green-dim) 0,
			var(--green-dim) 6px,
			transparent 6px,
			transparent 12px
		);
		opacity: 0.6;
	}

	.dossier--off {
		opacity: 0.62;
	}

	.dossier__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		border-bottom: 1px dashed var(--green-deep);
		padding-bottom: 11px;
	}

	.dossier__name {
		font-family: var(--crt);
		font-size: 34px;
		line-height: 1;
		letter-spacing: 0.05em;
		color: var(--green);
		text-shadow: var(--glow-green);
		margin: 3px 0 4px;
		font-weight: 400;
	}

	.dossier__role {
		font-size: 10.5px;
		letter-spacing: 0.1em;
		color: var(--ink-2);
	}

	.dossier__lamps {
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: flex-end;
	}

	.dossier__specs {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 10px 22px;
		margin: 13px 0;
	}

	.dossier__specs dt {
		font-size: 9px;
		letter-spacing: 0.28em;
		color: var(--green-dim);
		margin-bottom: 3px;
	}

	.dossier__specs dd {
		margin: 0;
		font-size: 11px;
		line-height: 1.65;
		color: var(--ink-2);
	}

	.dossier__prompt {
		font-family: var(--mono);
		font-size: 10.5px;
		line-height: 1.6;
		color: #9ad9b2;
		background: #030806;
		border: 1px solid var(--green-deep);
		padding: 12px 13px;
		margin: 0 0 13px;
		max-height: 190px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.dossier__edit summary {
		color: var(--green-dim);
	}

	.dossier__edit summary::before {
		color: var(--green);
	}

	.dossier__edit summary:hover {
		color: var(--green);
	}

	.dossier__edit > .terminal {
		margin-top: 12px;
	}

	.dossier__danger {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 18px;
		padding-top: 12px;
		border-top: 1px dashed var(--magenta-dim);
	}

	.roster-foot {
		display: flex;
		align-items: center;
		gap: 20px;
		margin-top: 34px;
		padding-top: 16px;
		border-top: 1px solid var(--line);
	}

	.roster-foot p {
		max-width: 60ch;
	}
</style>
