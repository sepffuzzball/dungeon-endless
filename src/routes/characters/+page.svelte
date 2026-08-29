<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Portrait from '$lib/components/Portrait.svelte';
	import Wallet from '$lib/components/Wallet.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Characters | Dungeon of the Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">{data.companyName}</div>
		<h1>Characters</h1>
		<p class="lede">
			Shape lasting heroes, improve their company equipment, and prepare the next descent.
		</p>
	</div>
	<div class="actions">
		<Wallet gold={data.companyGold} />
		<a class="btn" href="/characters/new">Create a character</a>
	</div>
</header>
{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
{#if form?.success}<div class="alert alert-info" role="status">{form.success}</div>{/if}

{#if data.characters.length === 0}
	<EmptyState
		title="No characters yet"
		message="Create your first wayfarer to enter the dungeon."
		href="/characters/new"
		actionLabel="Create a character"
	/>
{:else}
	<div class="character-grid">
		{#each data.characters as character (character.id)}
			<article class="card character-card">
				<div class="character-profile">
					<Portrait src={character.imageUrl} name={character.name} size="card" />
					<div>
						<h2>{character.name}</h2>
						<p class="text-muted">
							{character.title || 'Untitled'} / {character.species}
							{character.className}
						</p>
					</div>
					{#if character.activeRunId}<span class="badge green">In progress</span>{/if}
				</div>
				<div class="mini-stats">
					<span><small>Level</small>{character.level}</span><span
						><small>Gear</small>+{character.gearBonus}</span
					><span><small>Start room</small>{character.maxStartRoom}</span>
				</div>
				<div class="mini-stats">
					<span><small>Body</small>{character.body}</span><span
						><small>Mind</small>{character.mind}</span
					><span><small>Spirit</small>{character.spirit}</span>
				</div>
				<div class="actions character-links">
					<a class="btn btn-secondary" href={`/characters/${character.id}/edit`}>Edit</a>
					<a
						class="btn"
						href={character.activeRunId
							? `/play/${character.activeRunId}`
							: `/dungeon?character=${character.id}`}
						>{character.activeRunId ? 'Continue Expedition' : 'Enter the Dungeon'}</a
					>
				</div>
				<details class="upgrades" aria-label={`Upgrades for ${character.name}`}>
					<summary>Progression and upgrades</summary>
					<div class="subsection">
						{#if character.activeRunId}<p class="field-hint">
								Upgrades are locked during an active expedition.
							</p>{/if}
						<form method="POST" action="?/levelUp" class="upgrade-row">
							<input type="hidden" name="characterId" value={character.id} />
							<label for={`stat-${character.id}`}>Next stat</label><select
								id={`stat-${character.id}`}
								name="stat"
								disabled={!!character.activeRunId || character.level >= 10}
								><option value="body" disabled={character.body >= (character.level === 9 ? 4 : 3)}
									>Body</option
								><option value="mind" disabled={character.mind >= (character.level === 9 ? 4 : 3)}
									>Mind</option
								><option
									value="spirit"
									disabled={character.spirit >= (character.level === 9 ? 4 : 3)}>Spirit</option
								></select
							>
							<button
								type="submit"
								class="btn-sm"
								disabled={!!character.activeRunId || character.level >= 10}
								>Level up / {character.level < 10 ? (character.level + 1) * 10 : 'max'} gold</button
							>
						</form>
						<div class="upgrade-pair">
							<form method="POST" action="?/gearUp">
								<input type="hidden" name="characterId" value={character.id} /><button
									type="submit"
									class="btn-sm btn-secondary"
									disabled={!!character.activeRunId || character.gearBonus >= 3}
									>Gear +1 / {[25, 75, 225][character.gearBonus] ?? 'max'} gold</button
								>
							</form>
							<form method="POST" action="?/roomUp">
								<input type="hidden" name="characterId" value={character.id} /><button
									type="submit"
									class="btn-sm btn-secondary"
									disabled={!!character.activeRunId || character.maxStartRoom >= 1000}
									>Start room +1 / 5 gold</button
								>
							</form>
						</div>
					</div>
				</details>
			</article>
		{/each}
	</div>
{/if}

<style>
	.character-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
		gap: 1rem;
	}
	.character-card {
		overflow: hidden;
	}
	.character-profile {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 1rem;
	}
	.character-links {
		margin: 1rem 0;
	}
	.upgrades {
		border-top: 1px solid var(--border);
		padding-top: 1rem;
	}
	.upgrades summary {
		cursor: pointer;
		color: var(--amber);
		font-weight: 700;
	}
	.upgrades .subsection {
		margin-top: 0.75rem;
	}
	.upgrade-row {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.5rem;
		align-items: center;
	}
	.upgrade-row button {
		grid-column: 1/-1;
	}
	.upgrade-pair {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.upgrade-pair form {
		margin: 0;
	}
	@media (max-width: 520px) {
		.character-profile {
			grid-template-columns: auto 1fr;
		}
		.character-profile .badge {
			grid-column: 2;
		}
		.character-links {
			display: grid;
		}
	}
</style>
