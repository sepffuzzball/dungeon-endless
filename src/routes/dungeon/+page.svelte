<script lang="ts">
	import { untrack } from 'svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Wallet from '$lib/components/Wallet.svelte';
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
	<Wallet gold={data.companyGold} />
</header>
{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
<div class="grid-2">
	<section class="card">
		<div class="eyebrow">Characters</div>
		<h2>Who carries the lantern?</h2>
		{#if !data.characters.length}<EmptyState
				title="No characters are ready"
				message="Create a wayfarer before crossing the threshold."
				href="/characters/new"
				actionLabel="Create a character"
			/>{:else}<div class="roster">
				{#each data.characters as item}<button
						type="button"
						class:chosen={selected === item.id}
						onclick={() => {
							selected = item.id;
							startRoom = 1;
						}}
						aria-pressed={selected === item.id}
						><strong>{item.name}</strong><span
							>Level {item.level} / {item.gearBonus} starting loot {item.gearBonus === 1
								? 'item'
								: 'items'}</span
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
			<p>
				Starts each expedition with {character.gearBonus} random sellable loot {character.gearBonus ===
				1
					? 'item'
					: 'items'}.
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
	.roster {
		display: grid;
		gap: 0.6rem;
	}
	.roster button {
		text-align: left;
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.25rem;
		min-height: 64px;
		background: rgba(7, 11, 17, 0.38);
		border-color: var(--border);
		color: var(--parchment);
		box-shadow: none;
		font-family: inherit;
		font-size: 0.9rem;
		letter-spacing: 0;
	}
	.roster button span:not(.badge) {
		color: var(--muted);
		grid-column: 1;
	}
	.roster button.chosen {
		border-color: var(--gold);
		background: rgba(84, 37, 48, 0.55);
		box-shadow: inset 3px 0 var(--gold);
	}
</style>
