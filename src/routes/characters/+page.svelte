<script lang="ts">
	import SliderField from '$lib/components/SliderField.svelte';
	import { untrack } from 'svelte';
	let { data, form } = $props();
	let selected = $state(
		untrack(
			() =>
				data.characters.find((character) => !character.activeRunId)?.id ?? data.characters[0]?.id
		)
	);
	let brutality = $state(3);
	let debauchery = $state(2);
	let startRoom = $state(1);
	let level = $state(1);
	let gear = $state(0);
	let body = $state(1);
	let mind = $state(0);
	let spirit = $state(0);
	const allocated = $derived(body + mind + spirit);
	const allocationRemaining = $derived(level - allocated);
	const allocationValid = $derived(
		allocationRemaining === 0 &&
			(level < 10
				? Math.max(body, mind, spirit) <= 3
				: Math.max(body, mind, spirit) <= 4 &&
					[body, mind, spirit].filter((value) => value === 4).length <= 1)
	);
	function setLevel(next: number) {
		level = next;
		body = Math.min(next, next === 10 ? 4 : 3);
		mind = Math.min(next - body, 3);
		spirit = next - body - mind;
	}
	const hero = $derived(data.characters.find((character) => character.id === selected));
</script>

<svelte:head><title>Company | Dungeon Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">The lantern company</div>
		<h1>{data.companyName}: choose who descends.</h1>
		<p class="lede">Heroes keep what they earn, but the dungeon keeps its own account.</p>
	</div>
	<a class="btn" href="/characters/new">Create a hero</a>
</header>
{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
<div class="grid-2">
	<section class="stack" aria-label="Characters">
		{#each data.characters as character (character.id)}
			<button
				type="button"
				class="card character-card"
				style="text-align:left; color:inherit; background:{selected === character.id
					? 'linear-gradient(145deg,#4a2930,#1d2028)'
					: ''}"
				onclick={() => (selected = character.id)}
				aria-pressed={selected === character.id}
			>
				<div class="card-head">
					<div class="character-monogram">{character.name[0]}</div>
					{#if character.activeRunId}<span class="badge green">In progress</span>{/if}
				</div>
				<div>
					<h2>{character.name}</h2>
					<div class="text-muted">
						{character.title} / {character.species}
						{character.className}
					</div>
				</div>
				<div class="mini-stats">
					<span><small>Level</small>{character.level}</span><span
						><small>Gold</small>{character.gold}</span
					><span><small>Deepest</small>{character.furthestDepth}</span>
				</div>
			</button>
		{/each}
	</section>
	<section class="card forest">
		<div class="eyebrow">Expedition charter</div>
		<h2>{hero?.activeRunId ? 'A descent is underway' : `Prepare ${hero?.name ?? 'a hero'}`}</h2>
		{#if hero?.activeRunId}
			<p class="lede">
				This hero already carries the lantern below. Continue their story before beginning another.
			</p>
			<a class="btn" href={`/play/${hero.activeRunId}`}>Continue descent</a>
		{:else}
			<form method="POST" action="?/start">
				<input type="hidden" name="characterId" value={selected} />
				<SliderField
					label="Brutality"
					name="brutality"
					bind:value={brutality}
					hint="From tense peril to merciless encounters."
				/>
				<SliderField
					label="Debauchery"
					name="debauchery"
					bind:value={debauchery}
					hint="Controls the maturity of generated themes."
				/>
				<div class="form-grid">
					<label for="level"
						>Run level<select
							id="level"
							name="level"
							value={level}
							onchange={(event) => setLevel(Number(event.currentTarget.value))}
							><option value={1}>Level 1 / free</option><option value={2}>Level 2 / 20 gold</option
							><option value={3}>Level 3 / 30 gold</option><option value={4}
								>Level 4 / 40 gold</option
							><option value={5}>Level 5 / 50 gold</option><option value={6}
								>Level 6 / 60 gold</option
							><option value={7}>Level 7 / 70 gold</option><option value={8}
								>Level 8 / 80 gold</option
							><option value={9}>Level 9 / 90 gold</option><option value={10}
								>Level 10 / 100 gold</option
							></select
						></label
					>
					<label for="start-room"
						>Starting room<select id="start-room" name="startRoom" bind:value={startRoom}
							><option value={1}>Threshold / free</option><option value={5}
								>Depth 5 / 20 gold</option
							><option value={10}>Depth 10 / 45 gold</option></select
						></label
					>
					<label for="gear"
						>Provisioned gear<select id="gear" name="gear" bind:value={gear}
							><option value={0}>Traveler's kit / free</option><option value={1}
								>Tempered kit +1 / 25 gold</option
							><option value={2}>Relic kit +2 / 75 gold</option><option value={3}
								>Mythic kit +3 / 225 gold</option
							></select
						></label
					>
				</div>
				<fieldset class="allocation">
					<legend>Expedition stats</legend>
					<p class="text-dim">
						Allocate exactly {level}
						{level === 1 ? 'point' : 'points'} for this expedition. Each stat is capped at 3 through level
						9; level 10 permits one stat at 4.
					</p>
					<div class="form-grid">
						{#each [{ key: 'body', label: 'Body' }, { key: 'mind', label: 'Mind' }, { key: 'spirit', label: 'Spirit' }] as stat}
							<label for={`run-${stat.key}`}
								>{stat.label}
								<select
									id={`run-${stat.key}`}
									name={stat.key}
									value={{ body, mind, spirit }[stat.key as 'body' | 'mind' | 'spirit']}
									onchange={(event) => {
										const value = Number(event.currentTarget.value);
										if (stat.key === 'body') body = value;
										else if (stat.key === 'mind') mind = value;
										else spirit = value;
									}}
								>
									{#each [0, 1, 2, 3, 4].slice(0, level === 10 ? 5 : 4) as value}<option
											{value}
											disabled={value === 4 &&
												((stat.key !== 'body' && body === 4) ||
													(stat.key !== 'mind' && mind === 4) ||
													(stat.key !== 'spirit' && spirit === 4))}>{value}</option
										>{/each}
								</select>
							</label>
						{/each}
					</div>
					<div
						class:green={allocationValid}
						class:red={!allocationValid}
						class="badge"
						aria-live="polite"
					>
						{allocationRemaining >= 0
							? `${allocationRemaining} remaining`
							: `${Math.abs(allocationRemaining)} over budget`}
					</div>
				</fieldset>
				<button type="submit" disabled={!allocationValid}>Sign the charter</button>
			</form>
		{/if}
	</section>
</div>

<style>
	.allocation {
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		margin: 1rem 0;
		padding: 1rem;
	}
	.allocation legend {
		font-weight: 700;
		padding: 0 0.35rem;
	}
</style>
