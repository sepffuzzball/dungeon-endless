<script lang="ts">
	let {
		label,
		name,
		min = 1,
		max = 5,
		step = 1,
		hint = '',
		value = $bindable()
	}: {
		label: string;
		name?: string;
		min?: number;
		max?: number;
		step?: number;
		hint?: string;
		value: number;
	} = $props();
	const inputId = $derived(`slider-${name ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
	const hintId = $derived(`${inputId}-hint`);
	const outputId = $derived(`${inputId}-output`);
</script>

<div class="slider-field">
	<label class="slider-heading" for={inputId}
		><span>{label}</span><output id={outputId} for={inputId}>{value}</output></label
	>
	<input
		id={inputId}
		type="range"
		{name}
		{min}
		{max}
		{step}
		bind:value
		aria-describedby={hint ? hintId : undefined}
	/>
	{#if hint}<span class="field-hint" id={hintId}>{hint}</span>{/if}
</div>
