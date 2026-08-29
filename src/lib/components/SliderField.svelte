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
</script>

<label class="slider-field">
	<span class="slider-heading"><span>{label}</span><output>{value}</output></span>
	<input type="range" {name} {min} {max} {step} bind:value aria-label={label} />
	{#if hint}<span class="field-hint">{hint}</span>{/if}
</label>
