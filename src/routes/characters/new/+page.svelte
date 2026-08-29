<script lang="ts">
	let { data, form } = $props();
	let body = $state(1);
	let mind = $state(1);
	let spirit = $state(1);
	const spent = $derived(body + mind + spirit - 3);
	const remaining = $derived(3 - spent);
	function adjust(stat: 'body' | 'mind' | 'spirit', delta: number) {
		const value = { body, mind, spirit }[stat];
		if (value + delta < 1 || value + delta > 4 || (delta > 0 && remaining === 0)) return;
		if (stat === 'body') body += delta;
		if (stat === 'mind') mind += delta;
		if (stat === 'spirit') spirit += delta;
	}
</script>

<svelte:head><title>Create a hero | Dungeon Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">A new name in the chronicle</div>
		<h1>Shape a wayfarer.</h1>
		<p class="lede">
			Three points. Three natures. Decide what keeps them alive when the lantern gutters.
		</p>
	</div>
	<a class="btn btn-secondary" href="/characters">Back to company</a>
</header>
{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
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
					>{#each data.species as item}<option>{item}</option>{/each}</select
				></label
			>
			<label for="className"
				>Calling<select id="className" name="className" required
					>{#each data.classes as item}<option>{item}</option>{/each}</select
				></label
			>
			<label for="age"
				>Age<input
					id="age"
					name="age"
					type="number"
					min="18"
					max="999"
					value="28"
					required
				/></label
			>
			<label for="height"
				>Height<input id="height" name="height" placeholder="5 ft 10 in" required /></label
			>
			<label for="build"
				>Build<select id="build" name="build"
					><option>Lean</option><option>Sturdy</option><option>Broad</option><option>Lithe</option
					></select
				></label
			>
		</div>
	</section>
	<section class="card burgundy">
		<div class="card-head">
			<div>
				<div class="eyebrow">Nature</div>
				<h2>Spend three points</h2>
			</div>
			<span class="badge gold">{remaining} remaining</span>
		</div>
		<p class="text-dim">
			Every nature begins at one. Add exactly three points across Body, Mind, and Spirit.
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
