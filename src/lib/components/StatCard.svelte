<script lang="ts">
	let { label, value, hint }: { label: string; value: string | number; hint?: string } = $props();
</script>

<article class="stat-card">
	<div class="stat-label">{label}</div>
	<div class="stat-value">{value}</div>
	{#if hint}<div class="stat-hint">{hint}</div>{/if}
</article>
