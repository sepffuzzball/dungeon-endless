<script lang="ts">
	import { SKILLS } from '$lib/types';
	import type { PageData } from './$types';
	type FormResult = { error?: string; success?: string };
	let { data, form } = $props<{ data: PageData; form: FormResult | null }>();
</script>

<svelte:head><title>Content atelier | Dungeon Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">Content atelier</div>
		<h1>Stock the darkness.</h1>
		<p class="lede">
			Manage the definitions used for future heroes and rooms. Saved snapshots never change.
		</p>
	</div>
</header>
{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
{#if form?.success}<div class="alert alert-info" role="status">{form.success}</div>{/if}

<div class="grid-2">
	<section class="card burgundy">
		<div class="eyebrow">New adversary</div>
		<h2>Add a monster</h2>
		<form method="POST" action="?/monster">
			<div class="form-grid">
				<label for="monster-name"
					>Name<input id="monster-name" name="name" maxlength="120" required /></label
				>
				<label for="monster-tier"
					>Tier<input
						id="monster-tier"
						name="tier"
						type="number"
						min="1"
						max="10"
						value="1"
						required
					/></label
				>
				<label for="monster-hp"
					>HP<input
						id="monster-hp"
						name="hp"
						type="number"
						min="1"
						max="1000"
						value="8"
						required
					/></label
				>
				<label for="monster-defense"
					>Defense<input
						id="monster-defense"
						name="defense"
						type="number"
						min="1"
						max="1000"
						value="8"
						required
					/></label
				>
			</div>
			<label for="monster-temperament"
				>Temperament<input id="monster-temperament" name="temperament" maxlength="2000" /></label
			>
			<label for="monster-description"
				>Description<textarea id="monster-description" name="description" maxlength="10000" required
				></textarea></label
			>
			<label for="debauched-description"
				>Debauched description <span class="field-hint">Optional</span><textarea
					id="debauched-description"
					name="debauchedDescription"
					maxlength="10000"
				></textarea></label
			>
			<label class="check-label"><input name="enabled" type="checkbox" checked /> Enabled</label
			><button type="submit">Add to bestiary</button>
		</form>
	</section>
	<section class="card forest">
		<div class="eyebrow">New hazard</div>
		<h2>Set a trap</h2>
		<form method="POST" action="?/trap">
			<div class="form-grid">
				<label for="trap-name"
					>Name<input id="trap-name" name="name" maxlength="120" required /></label
				>
				<label for="trap-tier"
					>Tier<input
						id="trap-tier"
						name="tier"
						type="number"
						min="1"
						max="10"
						value="1"
						required
					/></label
				>
				<label for="trap-target"
					>Target<input
						id="trap-target"
						name="target"
						type="number"
						min="1"
						max="1000"
						value="8"
						required
					/></label
				>
				<label for="skill"
					>Counter skill<select id="skill" name="skill"
						>{#each SKILLS as skill}<option>{skill}</option>{/each}</select
					></label
				>
			</div>
			<label for="trap-consequence"
				>Consequence<input id="trap-consequence" name="consequence" maxlength="2000" /></label
			>
			<label for="trap-description"
				>Description<textarea id="trap-description" name="description" maxlength="10000" required
				></textarea></label
			>
			<label class="check-label"><input name="enabled" type="checkbox" checked /> Enabled</label
			><button type="submit">Add to hazards</button>
		</form>
	</section>
</div>

<div class="grid-2 records">
	<section class="card">
		<div class="card-head">
			<h2>Monsters</h2>
			<span class="badge">{data.monsters.length}</span>
		</div>
		{#if !data.monsters.length}<p class="text-dim">No monsters have been defined.</p>{/if}
		<div class="stack">
			{#each data.monsters as item (item.id)}
				<details class="record">
					<summary
						><strong>{item.name}</strong><span
							class:green={item.enabled}
							class:red={!item.enabled}
							class="badge">{item.enabled ? 'Enabled' : 'Disabled'}</span
						></summary
					>
					<form method="POST" action="?/edit-monster">
						<input type="hidden" name="id" value={item.id} />
						<div class="form-grid">
							<label for={`mn-${item.id}`}
								>Name<input
									id={`mn-${item.id}`}
									name="name"
									value={item.name}
									maxlength="120"
									required
								/></label
							><label for={`mt-${item.id}`}
								>Tier<input
									id={`mt-${item.id}`}
									name="tier"
									type="number"
									min="1"
									max="10"
									value={item.tier}
									required
								/></label
							><label for={`mh-${item.id}`}
								>HP<input
									id={`mh-${item.id}`}
									name="hp"
									type="number"
									min="1"
									max="1000"
									value={item.hp}
									required
								/></label
							><label for={`md-${item.id}`}
								>Defense<input
									id={`md-${item.id}`}
									name="defense"
									type="number"
									min="1"
									max="1000"
									value={item.defense}
									required
								/></label
							>
						</div>
						<label for={`mtemp-${item.id}`}
							>Temperament<input
								id={`mtemp-${item.id}`}
								name="temperament"
								value={item.temperament}
								maxlength="2000"
							/></label
						><label for={`mdesc-${item.id}`}
							>Description<textarea
								id={`mdesc-${item.id}`}
								name="description"
								maxlength="10000"
								required>{item.description}</textarea
							></label
						><label for={`mdeb-${item.id}`}
							>Debauched description<textarea
								id={`mdeb-${item.id}`}
								name="debauchedDescription"
								maxlength="10000">{item.debauchedDescription}</textarea
							></label
						><label class="check-label"
							><input name="enabled" type="checkbox" checked={item.enabled} /> Enabled</label
						><button type="submit">Save monster</button>
					</form>
					<form class="toggle" method="POST" action="?/toggle-monster">
						<input type="hidden" name="id" value={item.id} /><input
							type="hidden"
							name="enabled"
							value={String(!item.enabled)}
						/><button class="btn-outline" type="submit"
							>{item.enabled ? 'Disable' : 'Enable'}</button
						>
					</form>
				</details>
			{/each}
		</div>
	</section>
	<section class="card">
		<div class="card-head">
			<h2>Traps</h2>
			<span class="badge">{data.traps.length}</span>
		</div>
		{#if !data.traps.length}<p class="text-dim">No traps have been defined.</p>{/if}
		<div class="stack">
			{#each data.traps as item (item.id)}
				<details class="record">
					<summary
						><strong>{item.name}</strong><span
							class:green={item.enabled}
							class:red={!item.enabled}
							class="badge">{item.enabled ? 'Enabled' : 'Disabled'}</span
						></summary
					>
					<form method="POST" action="?/edit-trap">
						<input type="hidden" name="id" value={item.id} />
						<div class="form-grid">
							<label for={`tn-${item.id}`}
								>Name<input
									id={`tn-${item.id}`}
									name="name"
									value={item.name}
									maxlength="120"
									required
								/></label
							><label for={`tt-${item.id}`}
								>Tier<input
									id={`tt-${item.id}`}
									name="tier"
									type="number"
									min="1"
									max="10"
									value={item.tier}
									required
								/></label
							><label for={`tta-${item.id}`}
								>Target<input
									id={`tta-${item.id}`}
									name="target"
									type="number"
									min="1"
									max="1000"
									value={item.target}
									required
								/></label
							><label for={`ts-${item.id}`}
								>Skill<select id={`ts-${item.id}`} name="skill"
									>{#each SKILLS as skill}<option selected={skill === item.skill}>{skill}</option
										>{/each}</select
								></label
							>
						</div>
						<label for={`tc-${item.id}`}
							>Consequence<input
								id={`tc-${item.id}`}
								name="consequence"
								value={item.consequence}
								maxlength="2000"
							/></label
						><label for={`td-${item.id}`}
							>Description<textarea
								id={`td-${item.id}`}
								name="description"
								maxlength="10000"
								required>{item.description}</textarea
							></label
						><label class="check-label"
							><input name="enabled" type="checkbox" checked={item.enabled} /> Enabled</label
						><button type="submit">Save trap</button>
					</form>
					<form class="toggle" method="POST" action="?/toggle-trap">
						<input type="hidden" name="id" value={item.id} /><input
							type="hidden"
							name="enabled"
							value={String(!item.enabled)}
						/><button class="btn-outline" type="submit"
							>{item.enabled ? 'Disable' : 'Enable'}</button
						>
					</form>
				</details>
			{/each}
		</div>
	</section>
</div>

<div class="grid-2 records">
	{#each [{ kind: 'species', title: 'Species', rows: data.species }, { kind: 'calling', title: 'Callings', rows: data.callings }] as group}
		<section class="card">
			<div class="card-head">
				<div>
					<div class="eyebrow">Hero choices</div>
					<h2>{group.title}</h2>
				</div>
				<span class="badge">{group.rows.length}</span>
			</div>
			<form method="POST" action="?/definition" class="new-definition">
				<input type="hidden" name="kind" value={group.kind} /><label for={`new-${group.kind}`}
					>Name<input id={`new-${group.kind}`} name="name" maxlength="80" required /></label
				><label for={`new-${group.kind}-desc`}
					>Description<textarea id={`new-${group.kind}-desc`} name="description" maxlength="2000"
					></textarea></label
				><label class="check-label"><input name="enabled" type="checkbox" checked /> Enabled</label
				><button type="submit">Add {group.kind}</button>
			</form>
			{#if !group.rows.length}<p class="alert alert-error">
					No {group.title.toLowerCase()} exist. Character creation will be unavailable until an enabled
					option is added.
				</p>{/if}
			<div class="stack">
				{#each group.rows as item (item.id)}<details class="record">
						<summary
							><strong>{item.name}</strong><span
								class:green={item.enabled}
								class:red={!item.enabled}
								class="badge">{item.enabled ? 'Enabled' : 'Disabled'}</span
							></summary
						>
						<form method="POST" action="?/edit-definition">
							<input type="hidden" name="id" value={item.id} /><input
								type="hidden"
								name="kind"
								value={group.kind}
							/><label for={`dn-${item.id}`}
								>Name<input
									id={`dn-${item.id}`}
									name="name"
									value={item.name}
									maxlength="80"
									required
								/></label
							><label for={`dd-${item.id}`}
								>Description<textarea id={`dd-${item.id}`} name="description" maxlength="2000"
									>{item.description}</textarea
								></label
							><label class="check-label"
								><input name="enabled" type="checkbox" checked={item.enabled} /> Enabled</label
							><button type="submit">Save {group.kind}</button>
						</form>
						<form class="toggle" method="POST" action="?/toggle-definition">
							<input type="hidden" name="id" value={item.id} /><input
								type="hidden"
								name="kind"
								value={group.kind}
							/><input type="hidden" name="enabled" value={String(!item.enabled)} /><button
								class="btn-outline"
								type="submit">{item.enabled ? 'Disable' : 'Enable'}</button
							>
						</form>
					</details>{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.records {
		margin-top: 1rem;
	}
	.record {
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 0.8rem;
	}
	.record summary {
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
	}
	.record form {
		margin-top: 1rem;
	}
	.toggle {
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
	.toggle button {
		width: auto;
	}
	.new-definition {
		border-bottom: 1px solid var(--border);
		padding-bottom: 1rem;
		margin-bottom: 1rem;
	}
</style>
