<script lang="ts">
	import StatCard from '$lib/components/StatCard.svelte';
	let { data } = $props();
	let failedImages = $state<Record<string, boolean>>({});
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
	<div class="actions">
		<a class="btn btn-secondary" href="/characters">View characters</a><a
			class="btn"
			href="/characters/new">Create a hero</a
		>
	</div>
	<a class="btn" href="/dungeon">Enter the Dungeon</a>
</header>

<section class="stat-grid" aria-label="Career records">
	<StatCard label="Deepest descent" value={`Depth ${data.records.furthestFloor}`} />
	<StatCard label="Vaulted gold" value={data.records.gold} />
	<StatCard label="Expeditions" value={data.records.runs} />
	<StatCard label="Lost below" value={data.records.defeats} />
</section>

{#if data.activeRuns.length}
	<section class="card forest" style="margin-top: 1rem">
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

<div class="grid-2" style="margin-top: 1rem">
	<section class="card">
		<div class="card-head">
			<div>
				<div class="eyebrow">Characters</div>
				<h2>Bound to the lantern</h2>
			</div>
			<a href="/characters">All characters</a>
		</div>
		<div class="grid-2">
			{#each data.characters as character (character.id)}
				<article class="character-card">
					{#if character.imageUrl && !failedImages[character.id]}
						<div class="portrait-thumb">
							<img
								src={character.imageUrl}
								alt={`Portrait of ${character.name}`}
								loading="lazy"
								referrerpolicy="no-referrer"
								width="56"
								height="56"
								onerror={() => (failedImages = { ...failedImages, [character.id]: true })}
							/>
						</div>
					{:else}
						<div class="character-monogram" aria-hidden="true">{character.name.slice(0, 1)}</div>
					{/if}
					<div>
						<h3>{character.name}</h3>
						<div class="text-muted">{character.title}</div>
						<small>{character.species} {character.className} / Level {character.level}</small>
					</div>
					<div class="mini-stats">
						<span><small>Body</small>{character.body}</span><span
							><small>Mind</small>{character.mind}</span
						><span><small>Spirit</small>{character.spirit}</span>
					</div>
				</article>
			{/each}
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
			<p class="text-muted">No marks have been earned yet. The stone waits.</p>
		{/if}
	</section>
</div>
