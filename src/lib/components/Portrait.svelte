<script lang="ts">
	let {
		src,
		name,
		size = 'card'
	}: { src?: string | null; name: string; size?: 'chronicle' | 'card' | 'profile' } = $props();
	let failed = $state(false);
	const initial = $derived(name.trim().slice(0, 1).toUpperCase() || '?');
</script>

<div class="portrait portrait-{size}">
	{#if src && !failed}
		<img
			{src}
			alt={`Portrait of ${name}`}
			loading="lazy"
			referrerpolicy="no-referrer"
			width={size === 'profile' ? 220 : size === 'card' ? 96 : 56}
			height={size === 'profile' ? 165 : size === 'card' ? 96 : 56}
			onerror={() => (failed = true)}
		/>
	{:else}
		<span role="img" aria-label={`Portrait placeholder for ${name}`}>{initial}</span>
	{/if}
</div>
