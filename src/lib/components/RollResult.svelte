<script lang="ts">
	import type { RollRecord } from '$lib/types';

	let { roll }: { roll: RollRecord } = $props();

	const outcome = $derived(roll.success ? 'Success' : 'Failure');
	const diceText = $derived(roll.dice.join(', '));
</script>

<article class="roll {roll.success ? 'success' : 'failure'}" aria-label="Dice roll result">
	<header class="roll-head">
		<strong>{roll.label}</strong>
		<span class="badge {roll.success ? 'green' : 'red'}">{outcome}</span>
	</header>
	<div class="dice-row" aria-label="Dice rolled: {diceText}">
		{#each roll.dice as die, index}
			<span class:selected={die === roll.selected && index === roll.dice.indexOf(roll.selected)}
				>{die}</span
			>
		{/each}
	</div>
	<div class="roll-equation">
		<span><small>Kept</small>{roll.selected}</span><b>+</b><span
			><small>Modifier</small>{roll.modifier}</span
		><b>=</b><span class="total"><small>Total</small>{roll.total}</span><b>/</b><span
			><small>Target</small>{roll.target}</span
		>
	</div>
	{#if roll.advantage !== 0}
		<div class="text-muted">
			Net advantage: {roll.advantage > 0 ? '+' : ''}{roll.advantage}
			({Math.abs(roll.advantage) + 1} die used, {roll.advantage > 0 ? 'best' : 'worst'} kept)
		</div>
	{/if}
</article>
