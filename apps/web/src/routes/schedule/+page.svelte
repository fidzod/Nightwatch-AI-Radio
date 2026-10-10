<script lang="ts">
	import { enhance } from '$app/forms';
	import Panel from '#lib/components/Panel.svelte';
	import { DAY_NAMES } from '#lib/format.ts';
	import type { ScheduleSlotView } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const TABS = [...DAY_NAMES.map((d, i) => ({ key: String(i), label: d })), { key: 'ovr', label: 'OVERRIDES' }];

	let tab = $state(String(new Date().getDay()));
	let adding = $state(false);
	let newRecurrence = $state<'weekly' | 'date_override'>('weekly');

	const isOverrides = $derived(tab === 'ovr');

	const visible = $derived.by(() =>
		data.slots.filter((s) =>
			isOverrides
				? s.recurrence_type === 'date_override'
				: s.recurrence_type === 'weekly' && s.day_of_week === Number(tab)
		)
	);

	const countFor = (key: string) =>
		data.slots.filter((s) =>
			key === 'ovr'
				? s.recurrence_type === 'date_override'
				: s.recurrence_type === 'weekly' && s.day_of_week === Number(key)
		).length;

	const toMinutes = (hhmm: string) => {
		const [h, m] = hhmm.split(':').map(Number);
		return (h ?? 0) * 60 + (m ?? 0);
	};

	/** A slot can wrap past midnight; render it as one or two bars. */
	function barsFor(slot: ScheduleSlotView) {
		const start = toMinutes(slot.start_time);
		const end = toMinutes(slot.end_time);
		if (end > start) return [{ left: (start / 1440) * 100, width: ((end - start) / 1440) * 100 }];
		return [
			{ left: (start / 1440) * 100, width: ((1440 - start) / 1440) * 100 },
			{ left: 0, width: (end / 1440) * 100 }
		];
	}

	const canSchedule = $derived(data.presenters.length > 0 && data.collections.length > 0);
</script>

<div class="page-head">
	<div>
		<span class="label label--cyan">PROGRAMME INDEX / FOLDER 494</span>
		<h1 class="page-title">Schedule</h1>
	</div>
	<div class="strip">
		<span>{data.slots.length} SLOTS FILED</span>
		<span class="strip__sep"></span>
		<span>{data.slots.filter((s) => s.enabled).length} ENABLED</span>
		<span class="strip__sep"></span>
		<button class="btn btn--sm" disabled={!canSchedule} onclick={() => (adding = !adding)}>
			{adding ? '− CLOSE' : '+ FILE NEW SLOT'}
		</button>
	</div>
</div>

{#if form?.error}
	<p class="flash flash--error" style="margin-bottom:16px">ERR // {form.error}</p>
{:else if form?.ok}
	<p class="flash flash--ok" style="margin-bottom:16px">OK // {form.ok}</p>
{/if}

{#if !canSchedule}
	<p class="flash" style="margin-bottom:16px">
		A slot needs at least one presenter and one collection. Add a
		<a href="/collections">collection</a> first.
	</p>
{/if}

{#if adding && canSchedule}
	<div class="terminal" data-title="FILE NEW SLOT" style="margin-bottom:22px">
		<form method="POST" action="?/create" use:enhance>
			<div class="cols">
				<label class="field">
					<span class="field__label">Recurrence</span>
					<select name="recurrence_type" bind:value={newRecurrence}>
						<option value="weekly">weekly</option>
						<option value="date_override">date_override</option>
					</select>
				</label>
				{#if newRecurrence === 'weekly'}
					<label class="field">
						<span class="field__label">Day of week</span>
						<select name="day_of_week" value={isOverrides ? 0 : Number(tab)}>
							{#each DAY_NAMES as day, i}
								<option value={i}>{i} — {day}</option>
							{/each}
						</select>
					</label>
				{:else}
					<label class="field">
						<span class="field__label">Date</span>
						<input name="specific_date" type="date" required />
						<span class="field__hint">Overrides beat weekly slots for that date.</span>
					</label>
				{/if}
				<label class="field">
					<span class="field__label">Start (24h)</span>
					<input name="start_time" type="time" value="21:00" required />
				</label>
				<label class="field">
					<span class="field__label">End (24h)</span>
					<input name="end_time" type="time" value="01:00" required />
					<span class="field__hint">An end before the start wraps past midnight.</span>
				</label>
				<label class="field">
					<span class="field__label">Presenter</span>
					<select name="presenter_id" required>
						{#each data.presenters as presenter}
							<option value={presenter.id}>
								{presenter.name}{presenter.active ? '' : ' (inactive)'}
							</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span class="field__label">Collection</span>
					<select name="collection_id" required>
						{#each data.collections as collection}
							<option value={collection.id}>{collection.name}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span class="field__label">Priority</span>
					<input name="priority" type="number" value="0" step="1" />
				</label>
			</div>
			<label class="check-row" style="margin-bottom:14px">
				<input type="checkbox" name="enabled" checked />
				ENABLED
			</label>
			<div class="row">
				<button class="btn btn--green" type="submit">▌ FILE SLOT</button>
				<button class="btn btn--ghost" type="button" onclick={() => (adding = false)}>CANCEL</button>
			</div>
		</form>
	</div>
{/if}

<!-- ===================== tabbed folder ===================== -->
<div class="folder">
	<div class="tabs" role="tablist">
		{#each TABS as item}
			<button
				role="tab"
				aria-selected={tab === item.key}
				class="tab"
				class:tab--on={tab === item.key}
				onclick={() => (tab = item.key)}
			>
				<span class="tab__inner">
					{item.label}
					<span class="tab__count">{countFor(item.key)}</span>
				</span>
			</button>
		{/each}
	</div>

	<div class="card">
		<header class="card__head">
			<div>
				<span class="label">{isOverrides ? 'FILED UNDER' : 'WEEKLY PROGRAMME'}</span>
				<h2 class="card__title">
					{isOverrides ? 'DATE OVERRIDES' : DAY_NAMES[Number(tab)]}
				</h2>
			</div>
			<div class="card__stamp">
				<span>{visible.length} SLOT{visible.length === 1 ? '' : 'S'}</span>
			</div>
		</header>

		{#if !isOverrides}
			<div class="coverage">
				<div class="coverage__rail">
					{#each visible as slot}
						{#each barsFor(slot) as bar}
							<span
								class="coverage__bar"
								class:coverage__bar--off={!slot.enabled}
								style="left:{bar.left}%;width:{bar.width}%"
								title="{slot.presenter_name} · {slot.start_time}–{slot.end_time}"
							></span>
						{/each}
					{/each}
				</div>
				<div class="coverage__ticks">
					{#each [0, 3, 6, 9, 12, 15, 18, 21] as hour}
						<span style="left:{(hour / 24) * 100}%">{String(hour).padStart(2, '0')}</span>
					{/each}
				</div>
			</div>
		{/if}

		{#if visible.length === 0}
			<div class="empty">
				{isOverrides ? 'no date overrides filed' : 'nothing scheduled — station runs silent'}
			</div>
		{:else}
			<div class="slots">
				{#each visible as slot (slot.id)}
					<article class="slot" class:slot--off={!slot.enabled}>
						<div class="slot__window">
							<span class="slot__time">{slot.start_time}</span>
							<span class="slot__dash">—</span>
							<span class="slot__time">{slot.end_time}</span>
						</div>

						<div class="slot__body">
							<div class="row row--between">
								<span class="slot__presenter">{slot.presenter_name}</span>
								<div class="row" style="gap:5px">
									{#if slot.recurrence_type === 'date_override'}
										<span class="tag tag--magenta">{slot.specific_date}</span>
									{/if}
									<span class="tag">PRI {slot.priority}</span>
									<span class="tag" class:tag--green={!!slot.enabled} class:tag--off={!slot.enabled}>
										{slot.enabled ? 'ENABLED' : 'OFF'}
									</span>
								</div>
							</div>
							<div class="slot__coll">
								<span class="label">COLLECTION</span>
								<span>{slot.collection_name}</span>
							</div>

							<details class="slot__edit">
								<summary>EDIT SLOT {String(slot.id).padStart(3, '0')}</summary>
								<div class="terminal" data-title="SLOT {String(slot.id).padStart(3, '0')}">
									<form method="POST" action="?/update" use:enhance>
										<input type="hidden" name="id" value={slot.id} />
										<div class="cols">
											<label class="field">
												<span class="field__label">Recurrence</span>
												<select name="recurrence_type" value={slot.recurrence_type}>
													<option value="weekly">weekly</option>
													<option value="date_override">date_override</option>
												</select>
											</label>
											<label class="field">
												<span class="field__label">Day of week</span>
												<!-- numeric, not string: svelte matches option values by identity -->
												<select name="day_of_week" value={slot.day_of_week ?? 0}>
													{#each DAY_NAMES as day, i}
														<option value={i}>{i} — {day}</option>
													{/each}
												</select>
											</label>
											<label class="field">
												<span class="field__label">Override date</span>
												<input name="specific_date" type="date" value={slot.specific_date ?? ''} />
											</label>
											<label class="field">
												<span class="field__label">Start</span>
												<input name="start_time" type="time" value={slot.start_time} required />
											</label>
											<label class="field">
												<span class="field__label">End</span>
												<input name="end_time" type="time" value={slot.end_time} required />
											</label>
											<label class="field">
												<span class="field__label">Presenter</span>
												<select name="presenter_id" value={slot.presenter_id}>
													{#each data.presenters as presenter}
														<option value={presenter.id}>{presenter.name}</option>
													{/each}
												</select>
											</label>
											<label class="field">
												<span class="field__label">Collection</span>
												<select name="collection_id" value={slot.collection_id}>
													{#each data.collections as collection}
														<option value={collection.id}>{collection.name}</option>
													{/each}
												</select>
											</label>
											<label class="field">
												<span class="field__label">Priority</span>
												<input name="priority" type="number" value={slot.priority} step="1" />
											</label>
										</div>
										<label class="check-row" style="margin-bottom:14px">
											<input type="checkbox" name="enabled" checked={!!slot.enabled} />
											ENABLED
										</label>
										<div class="row">
											<button class="btn btn--green" type="submit">▌ SAVE SLOT</button>
										</div>
									</form>

									<div class="slot__actions">
										<form method="POST" action="?/toggle" use:enhance>
											<input type="hidden" name="id" value={slot.id} />
											<button class="btn btn--sm btn--ghost" type="submit">
												{slot.enabled ? '○ DISABLE' : '● ENABLE'}
											</button>
										</form>
										<form
											method="POST"
											action="?/delete"
											use:enhance
											onsubmit={(event) => {
												if (!confirm(`Delete slot ${slot.id}?`)) event.preventDefault();
											}}
										>
											<input type="hidden" name="id" value={slot.id} />
											<button class="btn btn--sm btn--danger" type="submit">✕ DELETE SLOT</button>
										</form>
									</div>
								</div>
							</details>
						</div>
					</article>
				{/each}
			</div>
		{/if}

		{#if !isOverrides}
			<footer class="card__foot">
				<form method="POST" action="?/copyDay" use:enhance class="row">
					<input type="hidden" name="from_day" value={tab} />
					<span class="label">COPY {DAY_NAMES[Number(tab)]} ONTO</span>
					<select name="to_day" style="width:auto">
						{#each DAY_NAMES as day, i}
							{#if String(i) !== tab}<option value={i}>{day}</option>{/if}
						{/each}
					</select>
					<button class="btn btn--sm" type="submit">DUPLICATE</button>
				</form>
			</footer>
		{/if}
	</div>
</div>

<div class="legend-strip">
	<Panel title="FILING NOTES" flat corners={false}>
		<p class="mono-sm dim">
			Weekly slots repeat every week on their day; a date override claims a specific calendar
			date and outranks the weekly grid. Where two slots overlap, the higher priority wins —
			the <a href="/live">live view</a> shows which one the engine would resolve right now.
		</p>
	</Panel>
</div>

<style>
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0 18px;
	}

	/* --- folder tabs (index-card flyer reference) ----------------------------- */
	.folder {
		position: relative;
	}

	.tabs {
		display: flex;
		gap: 4px;
		padding-left: 10px;
		position: relative;
		z-index: 2;
	}

	.tab {
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		font-family: var(--mono);
	}

	.tab__inner {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 7px 17px 8px;
		font-size: 10px;
		letter-spacing: 0.2em;
		color: var(--ink-3);
		background: var(--line);
		clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 100%, 0 100%);
		position: relative;
	}

	.tab__inner::before {
		/* inner fill leaves a 1px hairline of the parent showing through = border */
		content: '';
		position: absolute;
		inset: 1px 1px 0;
		background: var(--void-2);
		clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 100%, 0 100%);
		z-index: -1;
	}

	.tab:hover .tab__inner {
		color: var(--cyan);
		background: var(--line-bright);
	}

	.tab--on .tab__inner {
		color: var(--cyan);
		background: var(--cyan-dim);
	}

	.tab--on .tab__inner::before {
		background: var(--panel-lit);
	}

	.tab__count {
		font-size: 8.5px;
		color: var(--magenta-dim);
		border: 1px solid currentColor;
		padding: 0 3px;
		line-height: 1.3;
	}

	.tab--on .tab__count {
		color: var(--magenta);
	}

	/* --- the index card ------------------------------------------------------- */
	.card {
		border: 1px solid var(--line-2);
		background:
			linear-gradient(180deg, rgba(14, 23, 32, 0.92), rgba(6, 10, 15, 0.95));
		padding: 18px 20px 16px;
		position: relative;
		margin-top: -1px;
	}

	.card::after {
		/* stacked cards peeking out underneath */
		content: '';
		position: absolute;
		left: 10px;
		right: 10px;
		bottom: -5px;
		height: 5px;
		border: 1px solid var(--line);
		border-top: 0;
		background: var(--void-2);
		z-index: -1;
	}

	.card__head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		border-bottom: 1px solid var(--line);
		padding-bottom: 12px;
		margin-bottom: 14px;
	}

	.card__title {
		font-family: var(--crt);
		font-size: 32px;
		line-height: 1;
		letter-spacing: 0.1em;
		color: var(--bone);
		font-weight: 400;
		margin-top: 4px;
	}

	.card__stamp {
		border: 1px solid var(--line-2);
		padding: 4px 10px;
		font-size: 9px;
		letter-spacing: 0.24em;
		color: var(--ink-3);
	}

	/* --- 24h coverage rail ---------------------------------------------------- */
	.coverage {
		margin-bottom: 18px;
	}

	.coverage__rail {
		position: relative;
		height: 13px;
		border: 1px solid var(--line-2);
		background:
			repeating-linear-gradient(
				90deg,
				rgba(33, 76, 89, 0.5) 0,
				rgba(33, 76, 89, 0.5) 1px,
				transparent 1px,
				transparent calc(100% / 24)
			);
	}

	.coverage__bar {
		position: absolute;
		top: 2px;
		bottom: 2px;
		background: rgba(73, 229, 224, 0.3);
		border-left: 1px solid var(--cyan);
		border-right: 1px solid var(--cyan);
		box-shadow: 0 0 10px rgba(73, 229, 224, 0.25);
	}

	.coverage__bar--off {
		background: rgba(127, 163, 166, 0.12);
		border-color: var(--ink-3);
		box-shadow: none;
	}

	.coverage__ticks {
		position: relative;
		height: 13px;
		font-size: 8.5px;
		letter-spacing: 0.1em;
		color: var(--ink-3);
	}

	.coverage__ticks span {
		position: absolute;
		top: 2px;
		transform: translateX(-50%);
	}

	/* --- slot entries --------------------------------------------------------- */
	.slots {
		display: grid;
		gap: 10px;
	}

	.slot {
		display: flex;
		gap: 16px;
		border: 1px solid var(--line);
		background: rgba(4, 7, 11, 0.6);
		padding: 11px 13px;
	}

	.slot--off {
		opacity: 0.55;
	}

	.slot__window {
		flex: 0 0 auto;
		align-self: flex-start;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0;
		background: var(--bone);
		color: #05070a;
		padding: 7px 12px;
		min-width: 92px;
	}

	.slot--off .slot__window {
		background: var(--ink-3);
	}

	.slot__time {
		font-family: var(--crt);
		font-size: 25px;
		line-height: 0.95;
		letter-spacing: 0.04em;
	}

	.slot__dash {
		font-size: 9px;
		opacity: 0.7;
		line-height: 1.4;
	}

	.slot__body {
		flex: 1;
		min-width: 0;
	}

	.slot__presenter {
		font-family: var(--crt);
		font-size: 23px;
		letter-spacing: 0.06em;
		color: var(--cyan);
		text-shadow: var(--glow-cyan);
	}

	.slot__coll {
		display: flex;
		align-items: baseline;
		gap: 9px;
		font-size: 11.5px;
		color: var(--ink-2);
		margin: 4px 0 8px;
	}

	.slot__coll .label {
		display: inline;
	}

	.slot__edit summary {
		font-size: 9px;
	}

	.slot__edit > .terminal {
		margin-top: 11px;
	}

	.slot__actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px dashed var(--line);
	}

	.card__foot {
		margin-top: 18px;
		padding-top: 12px;
		border-top: 1px dashed var(--line);
	}

	.legend-strip {
		margin-top: 28px;
	}

	.legend-strip p {
		max-width: 86ch;
		line-height: 1.7;
	}

	@media (max-width: 720px) {
		.tabs {
			flex-wrap: wrap;
			gap: 3px;
		}

		.tab__inner {
			padding: 6px 11px;
			letter-spacing: 0.1em;
		}
	}
</style>
