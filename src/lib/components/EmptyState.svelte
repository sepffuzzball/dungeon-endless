<script lang="ts">
	let {
		title,
		message,
		icon = '!',
		href,
		actionLabel
	}: {
		title: string;
		message: string;
		icon?: string;
		href?: string;
		actionLabel?: string;
	} = $props();
</script>

<div class="muted-panel" role="status">
	<div class="empty-state-icon" aria-hidden="true">{icon}</div>
	<h3>{title}</h3>
	<p>{message}</p>
	{#if href && actionLabel}<a class="btn" {href}>{actionLabel}</a>{/if}
</div>
