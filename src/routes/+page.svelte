<script lang="ts">
	import StatCard from '$lib/components/StatCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Portrait from '$lib/components/Portrait.svelte';
	let { data } = $props();
	const unlockedAchievements = $derived(
		data.achievements.filter((achievement) => achievement.unlocked)
	);
</script>

<svelte:head
	><title>Chronicle | Dungeon of the Endless</title><meta
		name="description"
		content="Your characters and records in Dungeon of the Endless."
	/></svelte:head
>

<header class="page-header">
	<div>
		<div class="eyebrow">The living chronicle</div>
		<h1>{data.companyName} returns.</h1>
		<p class="lede">
			Your characters wait at the threshold, where every descent writes a different ending.
		</p>
	</div>
	<div class="actions header-actions">
		<a class="btn" href="/dungeon">Enter the Dungeon</a>
		<a class="btn btn-secondary" href="/characters">View characters</a><a
			class="btn btn-secondary"
			href="/characters/new">Create a hero</a
		>
	</div>
</header>

<section class="stat-grid" aria-label="Career records">
	<StatCard label="Deepest descent" value={`Depth ${data.records.furthestFloor}`} />
	<StatCard label="Vaulted gold" value={data.records.gold} />
	<StatCard label="Expeditions" value={data.records.runs} />
	<StatCard label="Lost below" value={data.records.defeats} />
</section>

{#if data.activeRuns.length}
	<section class="card forest section-gap">
		<div class="card-head">
			<div>
				<div class="eyebrow">Expedition in progress</div>
				<h2>The Ember Vault</h2>
			</div>
			<span class="badge green">Depth {data.activeRuns[0].depth}</span>
		</div>
		<p>
			{data.activeRuns[0].characterName} waits beside a sealed bronze door. Their torch will not burn
			forever.
		</p>
		<a class="btn" href={`/play/${data.activeRuns[0].id}`}>Resume descent</a>
	</section>
{/if}

<div class="grid-2 section-gap chronicle-grid">
	<section class="card">
		<div class="card-head">
			<div>
				<div class="eyebrow">Characters</div>
				<h2>Bound to the lantern</h2>
			</div>
			<a href="/characters">All characters</a>
		</div>
		<div class="character-overview">
			{#each data.characters as character (character.id)}
				<article class="list-row character-row">
					<Portrait src={character.imageUrl} name={character.name} size="chronicle" />
					<div>
						<h3>{character.name}</h3>
						<div class="text-muted">{character.title}</div>
						<small class="text-muted"
							>{character.genderIdentity} &middot; {character.pronouns}</small
						>
						<small>{character.species} {character.className} / Level {character.level}</small>
					</div>
					<div class="mini-stats">
						<span><small>Body</small>{character.effectiveBody}</span><span
							><small>Mind</small>{character.effectiveMind}</span
						><span><small>Spirit</small>{character.effectiveSpirit}</span>
					</div>
				</article>
			{/each}
			{#if data.characters.length === 0}
				<EmptyState
					title="No characters yet"
					message="Create a wayfarer to begin the chronicle."
					href="/characters/new"
					actionLabel="Create a hero"
				/>
			{/if}
		</div>
	</section>
	<section class="card burgundy">
		<div class="eyebrow">Milestones</div>
		<h2>Marks in the stone</h2>
		{#if unlockedAchievements.length}
			<ul class="list-plain">
				{#each unlockedAchievements as achievement (achievement.key)}
					<li>
						<div class="card-head">
							<strong>{achievement.name}</strong><span class="badge gold">Earned</span>
						</div>
						<span class="text-dim">{achievement.description}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<EmptyState title="No marks yet" message="The stone waits for your first earned milestone." />
		{/if}
	</section>
</div>
