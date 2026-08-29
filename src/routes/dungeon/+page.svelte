<script lang="ts">
	import { untrack } from 'svelte';
	let { data, form } = $props();
	let selected = $state(untrack(() => data.selectedCharacterId));
	let startRoom = $state(1);
	let character = $derived(data.characters.find((item) => item.id === selected));
</script>

<svelte:head><title>Dungeon | Dungeon of the Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">The threshold</div>
		<h1>Enter the Dungeon</h1>
		<p class="lede">
			Choose a company character and the deepest unlocked room. There is no entry fee.
		</p>
	</div>
	<div class="wallet"><small>Company wallet</small><strong>{data.companyGold} gold</strong></div>
</header>
{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
<div class="grid-2">
	<section class="card">
		<div class="eyebrow">Characters</div>
		<h2>Who carries the lantern?</h2>
		{#if !data.characters.length}<p>
				No characters are ready. <a href="/characters/new">Create one first.</a>
			</p>{:else}<div class="roster">
				{#each data.characters as item}<button
						type="button"
						class:chosen={selected === item.id}
						onclick={() => {
							selected = item.id;
							startRoom = 1;
						}}
						aria-pressed={selected === item.id}
						><strong>{item.name}</strong><span>Level {item.level} / Gear +{item.gearBonus}</span
						>{#if item.activeRun}<span class="badge green">Depth {item.activeRun.roomNumber}</span
							>{/if}</button
					>{/each}
			</div>{/if}
	</section>
	<section class="card forest">
		<div class="eyebrow">Expedition</div>
		<h2>{character?.name ?? 'Select a character'}</h2>
		{#if character?.activeRun}<p>This character already has an expedition in progress.</p>
			<a class="btn" href={`/play/${character.activeRun.id}`}>Resume Expedition</a
			>{:else if character}<div class="mini-stats">
				<span><small>Body</small>{character.body}</span><span
					><small>Mind</small>{character.mind}</span
				><span><small>Spirit</small>{character.spirit}</span>
			</div>
			<p class="text-muted">
				Company settings: Brutality {data.settings.brutality} / Debauchery {data.settings
					.debauchery}
			</p>
			<form method="POST" action="?/start">
				<input type="hidden" name="characterId" value={character.id} /><label for="startRoom"
					>Starting room <span class="field-hint"
						>Unlocked rooms 1 through {character.maxStartRoom}.</span
					><input
						id="startRoom"
						name="startRoom"
						type="number"
						min="1"
						max={character.maxStartRoom}
						bind:value={startRoom}
						required
					/></label
				><button type="submit">Begin Expedition</button>
			</form>{/if}
	</section>
</div>

<style>
	.wallet {
		padding: 0.65rem 1rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		display: flex;
		flex-direction: column;
	}
	.roster {
		display: grid;
		gap: 0.6rem;
	}
	.roster button {
		text-align: left;
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.25rem;
	}
	.roster button span:not(.badge) {
		color: var(--muted);
		grid-column: 1;
	}
	.roster button.chosen {
		outline: 2px solid var(--gold);
	}
</style>
