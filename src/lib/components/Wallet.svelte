<script lang="ts">
	let { gold }: { gold: number } = $props();
</script>

<div class="wallet" aria-label={`Company wallet: ${gold} gold`}>
	<span>Company wallet</span><strong>{gold} gold</strong>
</div>
