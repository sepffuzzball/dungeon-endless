<script lang="ts">
	import '../app.css';
	import AppShell from '$lib/components/AppShell.svelte';
	let { children, data } = $props();
</script>

<svelte:head>
	<title>Dungeon of the Endless</title>
</svelte:head>

<AppShell user={data.user}>
	{@render children()}
</AppShell>
