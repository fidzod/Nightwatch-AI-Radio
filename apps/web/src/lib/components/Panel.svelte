<script lang="ts">
	import type { Snippet } from 'svelte';

	// The boxed readout from the SPCNET deep-map reference: a hairline rectangle
	// with its label notched into the top border and tick corners.
	let {
		title = '',
		meta = '',
		tone = 'default',
		corners = true,
		flat = false,
		children,
		footer
	}: {
		title?: string;
		meta?: string;
		tone?: 'default' | 'lit' | 'alert';
		corners?: boolean;
		flat?: boolean;
		children: Snippet;
		footer?: Snippet;
	} = $props();
</script>

<section
	class="panel"
	class:panel--lit={tone === 'lit'}
	class:panel--alert={tone === 'alert'}
	class:panel--flat={flat}
>
	{#if title}
		<span class="panel__title" class:panel__title--alert={tone === 'alert'}>{title}</span>
	{/if}
	{#if meta}<span class="panel__meta">{meta}</span>{/if}
	{#if corners}
		<span class="panel__corner panel__corner--tl"></span>
		<span class="panel__corner panel__corner--tr"></span>
		<span class="panel__corner panel__corner--bl"></span>
		<span class="panel__corner panel__corner--br"></span>
	{/if}
	{@render children()}
	{#if footer}
		<div class="panel__footer">{@render footer()}</div>
	{/if}
</section>

<style>
	.panel__footer {
		margin-top: 14px;
		padding-top: 10px;
		border-top: 1px dashed var(--line);
	}

	.panel--alert .panel__corner {
		border-color: var(--magenta-dim);
	}
</style>
