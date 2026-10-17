<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const currentName = $derived(
		data.countries.find((c) => c.code === data.settings.country)?.name ?? data.settings.country
	);
</script>

<div class="page-head">
	<div>
		<span class="label label--cyan">STATION CONFIGURATION / FOLDER 001</span>
		<h1 class="page-title">Settings</h1>
	</div>
	<div class="strip">
		<span>COUNTRY: {currentName.toUpperCase()}</span>
	</div>
</div>

{#if form?.error}
	<p class="flash flash--error" style="margin-bottom:16px">ERR // {form.error}</p>
{:else if form?.ok}
	<p class="flash flash--ok" style="margin-bottom:16px">OK // {form.ok}</p>
{/if}

<div class="terminal" data-title="STATION COUNTRY" style="margin-bottom:22px">
	<form method="POST" action="?/update" use:enhance>
		<label class="field" style="max-width:360px">
			<span class="field__label">Country</span>
			<select name="country" value={data.settings.country}>
				{#each data.countries as country}
					<option value={country.code}>{country.name}</option>
				{/each}
			</select>
			<span class="field__hint">
				Picks the language for news and the cities read out for weather. The engine re-reads
				this on its next generation. No restart needed.
			</span>
		</label>
		<div class="row">
			<button class="btn btn--solid" type="submit">▌ SAVE SETTING</button>
		</div>
	</form>
</div>

<p class="mono-sm dim" style="max-width:60ch">
	News comes from Google News' RSS feed for this country; weather comes from Open-Meteo readings
	for the country's capital (plus a few spread-out cities where available), summarized by the
	presenter rather than reported city-by-city.
</p>

<style>
	.row {
		margin-top: 16px;
	}
</style>
