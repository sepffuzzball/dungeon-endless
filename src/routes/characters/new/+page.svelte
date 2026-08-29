<script lang="ts">
	let { data, form } = $props();
	let body = $state(0);
	let mind = $state(0);
	let spirit = $state(0);
	const remaining = $derived(1 - body - mind - spirit);
	function adjust(stat: 'body' | 'mind' | 'spirit', delta: number) {
		const value = { body, mind, spirit }[stat];
		if (value + delta < 0 || value + delta > 1 || (delta > 0 && remaining === 0)) return;
		if (stat === 'body') body += delta;
		if (stat === 'mind') mind += delta;
		if (stat === 'spirit') spirit += delta;
	}
</script>

<svelte:head><title>Create a character | Dungeon of the Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">A new name in the chronicle</div>
		<h1>Shape a wayfarer.</h1>
		<p class="lede">
			Choose an identity and one defining strength. Progression belongs to this character.
		</p>
	</div>
	<a class="btn btn-secondary" href="/characters">Back to Characters</a>
</header>
{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
{#if !data.species.length || !data.callings.length}
	<div class="alert alert-error" role="alert">
		Character creation is unavailable because no enabled {data.species.length
			? 'callings'
			: data.callings.length
				? 'species'
				: 'species or callings'} are configured. Ask an editor to add or enable an option.
	</div>
{:else}
	<form method="POST" class="grid-2">
		<section class="card">
			<div class="eyebrow">Identity</div>
			<h2>Name the legend</h2>
			<div class="form-grid">
				<label for="name"
					>Name<input id="name" name="name" required maxlength="40" placeholder="Mara Vey" /></label
				>
				<label for="title"
					>Title<input id="title" name="title" maxlength="60" placeholder="The Ashbound" /></label
				>
				<label for="species"
					>Species<select id="species" name="species" required
						>{#each data.species as item}<option value={item.name}>{item.name}</option
							>{/each}</select
					></label
				>
				<label for="className"
					>Calling<select id="className" name="className" required
						>{#each data.callings as item}<option value={item.name}>{item.name}</option
							>{/each}</select
					></label
				>
				<label for="age"
					>Age<input
						id="age"
						name="age"
						type="number"
						min="1"
						max="999"
						value="28"
						required
					/></label
				>
				<label for="height"
					>Height<select id="height" name="height" required
						>{#each data.heightOptions as item}<option>{item}</option>{/each}</select
					></label
				>
				<label for="build"
					>Build<select id="build" name="build" required
						>{#each data.buildOptions as item}<option>{item}</option>{/each}</select
					></label
				>
			</div>
			<label for="description"
				>Description <span class="field-hint">Appearance, history, manner, or ambitions.</span
				><textarea id="description" name="description" maxlength="2000"></textarea></label
			>
			<label for="image-url"
				>Portrait URL <span class="field-hint"
					>Optional http or https image, rendered only in your browser.</span
				><input
					id="image-url"
					name="imageUrl"
					type="url"
					maxlength="2048"
					placeholder="https://example.com/portrait.jpg"
				/></label
			>
		</section>
		<section class="card burgundy">
			<div class="card-head">
				<div>
					<div class="eyebrow">Nature</div>
					<h2>Choose one strength</h2>
				</div>
				<span class="badge gold">{remaining} remaining</span>
			</div>
			<p class="text-dim">
				A level-1 hero has exactly one point across Body, Mind, and Spirit. Each expedition's future
				levels add one permanent point to this profile.
			</p>
			{#each [{ key: 'body', label: 'Body', note: 'Force, endurance, and steel.' }, { key: 'mind', label: 'Mind', note: 'Lore, cunning, and precision.' }, { key: 'spirit', label: 'Spirit', note: 'Resolve, instinct, and sorcery.' }] as stat}
				<div class="card" style="margin-bottom:.75rem">
					<div class="card-head">
						<div>
							<h3>{stat.label}</h3>
							<span class="text-muted">{stat.note}</span>
						</div>
						<div class="actions">
							<button
								type="button"
								class="btn-sm btn-secondary"
								onclick={() => adjust(stat.key as 'body' | 'mind' | 'spirit', -1)}
								aria-label={`Decrease ${stat.label}`}>-</button
							><strong style="font-size:1.5rem"
								>{{ body, mind, spirit }[stat.key as 'body' | 'mind' | 'spirit']}</strong
							><button
								type="button"
								class="btn-sm btn-secondary"
								onclick={() => adjust(stat.key as 'body' | 'mind' | 'spirit', 1)}
								aria-label={`Increase ${stat.label}`}>+</button
							>
						</div>
					</div>
				</div>
			{/each}
			<input type="hidden" name="body" value={body} /><input
				type="hidden"
				name="mind"
				value={mind}
			/><input type="hidden" name="spirit" value={spirit} />
			<button type="submit" disabled={remaining !== 0}>Bind hero to the chronicle</button>
		</section>
	</form>
{/if}
