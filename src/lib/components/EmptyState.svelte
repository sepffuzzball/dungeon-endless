<script lang="ts">
	let { title, message, icon = '!' }: { title: string; message: string; icon?: string } = $props();
</script>

<div class="muted-panel" role="status">
	<div class="empty-state-icon" aria-hidden="true">{icon}</div>
	<h3>{title}</h3>
	<p>{message}</p>
</div>
