<script lang="ts">
	import type { PageData } from './$types';

	type FormResult = { error?: string; success?: string };
	let { data, form } = $props<{ data: PageData; form: FormResult | null }>();
</script>

<svelte:head><title>Bestiary | Dungeon Endless</title></svelte:head>

<header class="page-header">
	<div>
		<div class="eyebrow">Content atelier</div>
		<h1>Stock the darkness.</h1>
		<p class="lede">Define the creatures and mechanisms the storyteller can draw from.</p>
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
				<label for="monster-name">Name<input id="monster-name" name="name" required /></label>
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
			<label for="monster-description"
				>Description<textarea
					id="monster-description"
					name="description"
					required
					placeholder="Appearance, tactics, and voice..."
				></textarea></label
			>
			<label for="debauched-description"
				>Debauched description <span class="field-hint">Optional</span><textarea
					id="debauched-description"
					name="debauchedDescription"
					placeholder="Alternate mature-content description..."
				></textarea></label
			>
			<label class="check-label"><input name="enabled" type="checkbox" checked /> Enabled</label>
			<button type="submit">Add to bestiary</button>
		</form>
	</section>

	<section class="card forest">
		<div class="eyebrow">New hazard</div>
		<h2>Set a trap</h2>
		<form method="POST" action="?/trap">
			<div class="form-grid">
				<label for="trap-name">Name<input id="trap-name" name="name" required /></label>
				<label for="skill"
					>Counter skill<select id="skill" name="skill">
						<option>Athletics</option><option>Knowledge</option><option>Magic</option><option
							>Persuasion</option
						><option>Stealth</option><option>Willpower</option>
					</select></label
				>
			</div>
			<label for="trap-description"
				>Description<textarea id="trap-description" name="description" required></textarea></label
			>
			<label class="check-label"><input name="enabled" type="checkbox" checked /> Enabled</label>
			<button type="submit">Add to hazards</button>
		</form>
	</section>
</div>

<div class="grid-2 content-lists">
	<section class="card">
		<div class="card-head">
			<h2>Monsters</h2>
			<span class="badge">{data.monsters.length} entries</span>
		</div>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Name</th><th>Defense</th><th>Status</th><th>Action</th></tr></thead>
				<tbody>
					{#each data.monsters as item}
						<tr>
							<td>
								<strong>{item.name}</strong><br /><small class="text-muted"
									>{item.description}</small
								>
							</td>
							<td>{item.defense}</td>
							<td
								><span class:green={item.enabled} class:red={!item.enabled} class="badge"
									>{item.enabled ? 'Enabled' : 'Disabled'}</span
								></td
							>
							<td>
								<form class="row-action" method="POST" action="?/toggle-monster">
									<input type="hidden" name="id" value={item.id} />
									<button class="btn-outline" type="submit"
										>{item.enabled ? 'Disable' : 'Enable'}</button
									>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="card">
		<div class="card-head">
			<h2>Traps</h2>
			<span class="badge">{data.traps.length} entries</span>
		</div>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Name</th><th>Skill</th><th>Status</th><th>Action</th></tr></thead>
				<tbody>
					{#each data.traps as item}
						<tr>
							<td>
								<strong>{item.name}</strong><br /><small class="text-muted"
									>{item.description}</small
								>
							</td>
							<td>{item.skill}</td>
							<td
								><span class:green={item.enabled} class:red={!item.enabled} class="badge"
									>{item.enabled ? 'Enabled' : 'Disabled'}</span
								></td
							>
							<td>
								<form class="row-action" method="POST" action="?/toggle-trap">
									<input type="hidden" name="id" value={item.id} />
									<button class="btn-outline" type="submit"
										>{item.enabled ? 'Disable' : 'Enable'}</button
									>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>

<style>
	.content-lists {
		margin-top: 1rem;
	}
	.row-action {
		display: block;
	}
	.row-action button {
		min-height: 36px;
		padding: 0.45rem 0.7rem;
		white-space: nowrap;
	}
	td:first-child {
		min-width: 15rem;
	}
</style>
