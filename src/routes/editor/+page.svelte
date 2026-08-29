<script lang="ts">
	import { SKILLS } from '$lib/types';
	import type { PageData } from './$types';

	type FormResult = { error?: string; success?: string };
	type SearchableRecord = { name: string; enabled: boolean };
	type MonsterRecord = SearchableRecord & {
		id: string;
		description: string;
		debauchedDescription: string;
		temperament: string;
		tier: number;
		hp: number;
		defense: number;
	};
	type TrapRecord = SearchableRecord & {
		id: string;
		description: string;
		consequence: string;
		tier: number;
		target: number;
		skill: (typeof SKILLS)[number];
	};
	type DefinitionRecord = SearchableRecord & { id: string; description: string };

	let { data, form } = $props<{ data: PageData; form: FormResult | null }>();

	const tabs = $derived([
		{ id: 'monsters', label: 'Monsters', count: data.counts.monsters },
		{ id: 'traps', label: 'Traps', count: data.counts.traps },
		{ id: 'species', label: 'Species', count: data.counts.species },
		{ id: 'callings', label: 'Callings', count: data.counts.callings }
	]);
	const activeTotal = $derived(data.counts[data.tab]);
	const monsterRecords = $derived(data.records as MonsterRecord[]);
	const trapRecords = $derived(data.records as TrapRecord[]);
	const definitionRecords = $derived(data.records as DefinitionRecord[]);
	const firstResult = $derived(data.filteredCount === 0 ? 0 : (data.page - 1) * data.pageSize + 1);
	const lastResult = $derived(
		Math.min(data.filteredCount, (data.page - 1) * data.pageSize + data.records.length)
	);

	function action(name: string): string {
		const params = new URLSearchParams({
			tab: data.tab,
			q: data.q,
			status: data.status,
			page: String(data.page)
		});
		return `?${params.toString()}&/${name}`;
	}

	function pageHref(page: number): string {
		const params = new URLSearchParams({
			tab: data.tab,
			q: data.q,
			status: data.status,
			page: String(page)
		});
		return `/editor?${params.toString()}`;
	}
</script>

<svelte:head><title>Bestiary | Dungeon of the Endless</title></svelte:head>

<header class="page-header bestiary-header">
	<div>
		<div class="eyebrow">Content atelier</div>
		<h1>Bestiary</h1>
		<p class="lede">Curate future encounters and hero choices. Saved snapshots never change.</p>
	</div>
</header>

<nav class="bestiary-tabs" aria-label="Bestiary categories">
	{#each tabs as tab (tab.id)}
		<a href={`/editor?tab=${tab.id}`} aria-current={data.tab === tab.id ? 'page' : undefined}>
			<span>{tab.label}</span><span class="tab-count">{tab.count}</span>
		</a>
	{/each}
</nav>

{#if form?.error}<div class="alert alert-error workspace-alert" role="alert">{form.error}</div>{/if}
{#if form?.success}<div class="alert alert-info workspace-alert" role="status">
		{form.success}
	</div>{/if}

<div class="bestiary-workspace">
	<aside
		class="create-panel panel"
		class:burgundy={data.tab === 'monsters'}
		class:forest={data.tab === 'traps'}
	>
		{#if data.tab === 'monsters'}
			<div class="eyebrow">New adversary</div>
			<h2>Add monster</h2>
			<form method="POST" action={action('monster')}>
				<label for="create-monster-name"
					>Name<input id="create-monster-name" name="name" maxlength="120" required /></label
				>
				<div class="form-grid compact-stats">
					<label for="create-monster-tier"
						>Tier<input
							id="create-monster-tier"
							name="tier"
							type="number"
							min="1"
							max="10"
							value="1"
							required
						/></label
					>
					<label for="create-monster-hp"
						>HP<input
							id="create-monster-hp"
							name="hp"
							type="number"
							min="1"
							max="1000"
							value="8"
							required
						/></label
					>
					<label for="create-monster-defense"
						>Defense<input
							id="create-monster-defense"
							name="defense"
							type="number"
							min="1"
							max="1000"
							value="8"
							required
						/></label
					>
				</div>
				<label for="create-monster-temperament"
					>Temperament<input
						id="create-monster-temperament"
						name="temperament"
						maxlength="2000"
					/></label
				>
				<label for="create-monster-description"
					>Description<textarea
						id="create-monster-description"
						name="description"
						maxlength="10000"
						required
					></textarea></label
				>
				<label for="create-monster-debauched"
					>Debauched description <span class="field-hint">Optional</span><textarea
						id="create-monster-debauched"
						name="debauchedDescription"
						maxlength="10000"
					></textarea></label
				>
				<label class="check-label"><input name="enabled" type="checkbox" checked /> Enabled</label>
				<button type="submit">Add to bestiary</button>
			</form>
		{:else if data.tab === 'traps'}
			<div class="eyebrow">New hazard</div>
			<h2>Set a trap</h2>
			<form method="POST" action={action('trap')}>
				<label for="create-trap-name"
					>Name<input id="create-trap-name" name="name" maxlength="120" required /></label
				>
				<div class="form-grid compact-stats">
					<label for="create-trap-tier"
						>Tier<input
							id="create-trap-tier"
							name="tier"
							type="number"
							min="1"
							max="10"
							value="1"
							required
						/></label
					>
					<label for="create-trap-target"
						>Target<input
							id="create-trap-target"
							name="target"
							type="number"
							min="1"
							max="1000"
							value="8"
							required
						/></label
					>
				</div>
				<label for="create-trap-skill"
					>Counter skill<select id="create-trap-skill" name="skill"
						>{#each SKILLS as skill}<option>{skill}</option>{/each}</select
					></label
				>
				<label for="create-trap-consequence"
					>Consequence<input
						id="create-trap-consequence"
						name="consequence"
						maxlength="2000"
					/></label
				>
				<label for="create-trap-description"
					>Description<textarea
						id="create-trap-description"
						name="description"
						maxlength="10000"
						required
					></textarea></label
				>
				<label class="check-label"><input name="enabled" type="checkbox" checked /> Enabled</label>
				<button type="submit">Add to hazards</button>
			</form>
		{:else}
			{@const kind = data.tab === 'species' ? 'species' : 'calling'}
			<div class="eyebrow">New hero choice</div>
			<h2>Add {kind}</h2>
			<form method="POST" action={action('definition')}>
				<input type="hidden" name="kind" value={kind} />
				<label for={`create-${kind}-name`}
					>Name<input id={`create-${kind}-name`} name="name" maxlength="80" required /></label
				>
				<label for={`create-${kind}-description`}
					>Description<textarea
						id={`create-${kind}-description`}
						name="description"
						maxlength="2000"
					></textarea></label
				>
				<label class="check-label"><input name="enabled" type="checkbox" checked /> Enabled</label>
				<button type="submit">Add {kind}</button>
			</form>
		{/if}
	</aside>

	<section class="record-panel card" aria-labelledby="records-title">
		<div class="records-heading">
			<div>
				<div class="eyebrow">Archive management</div>
				<h2 id="records-title">{tabs.find((tab) => tab.id === data.tab)?.label}</h2>
			</div>
			<span class="record-total">{activeTotal} total</span>
		</div>

		<form class="record-tools" method="GET" action="/editor">
			<input type="hidden" name="tab" value={data.tab} />
			<label class="search-field" for="record-search">
				<span>Search {data.tab}</span>
				<input
					id="record-search"
					name="q"
					type="search"
					maxlength="100"
					placeholder={`Search ${data.tab}...`}
					value={data.q}
				/>
			</label>
			<label class="status-field" for="record-status">
				<span>Status</span>
				<select id="record-status" name="status" value={data.status}>
					<option value="all">All</option>
					<option value="enabled">Enabled</option>
					<option value="disabled">Disabled</option>
				</select>
			</label>
			<div class="filter-actions">
				<button type="submit">Apply</button>
				<a class="btn btn-outline" href={`/editor?tab=${data.tab}`}>Clear</a>
			</div>
		</form>
		<p class="result-count">
			Showing {firstResult}-{lastResult} of {data.filteredCount}
		</p>

		{#if activeTotal === 0}
			<div class="muted-panel">
				<h3>No {data.tab} yet</h3>
				<p>Create the first record using the form.</p>
			</div>
		{:else if data.filteredCount === 0}
			<div class="muted-panel">
				<h3>No matches</h3>
				<p>Try a different search or status filter.</p>
			</div>
		{:else}
			<div class="record-list">
				{#if data.tab === 'monsters'}
					{#each monsterRecords as item (item.id)}
						<details class="record">
							<summary
								><span class="summary-copy"
									><strong>{item.name}</strong><span class="record-meta"
										>Tier {item.tier} · Defense {item.defense} · {item.hp} HP</span
									></span
								><span class:green={item.enabled} class:red={!item.enabled} class="badge"
									>{item.enabled ? 'Enabled' : 'Disabled'}</span
								></summary
							>
							<form method="POST" action={action('edit-monster')}>
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
								>
								<label for={`mdesc-${item.id}`}
									>Description<textarea
										id={`mdesc-${item.id}`}
										name="description"
										maxlength="10000"
										required>{item.description}</textarea
									></label
								>
								<label for={`mdeb-${item.id}`}
									>Debauched description<textarea
										id={`mdeb-${item.id}`}
										name="debauchedDescription"
										maxlength="10000">{item.debauchedDescription}</textarea
									></label
								>
								<label class="check-label"
									><input name="enabled" type="checkbox" checked={item.enabled} /> Enabled</label
								><button type="submit">Save monster</button>
							</form>
							<form class="toggle" method="POST" action={action('toggle-monster')}>
								<input type="hidden" name="id" value={item.id} /><input
									type="hidden"
									name="enabled"
									value={String(!item.enabled)}
								/><button class="btn-outline" type="submit"
									>{item.enabled ? 'Disable' : 'Enable'} monster</button
								>
							</form>
						</details>
					{/each}
				{:else if data.tab === 'traps'}
					{#each trapRecords as item (item.id)}
						<details class="record">
							<summary
								><span class="summary-copy"
									><strong>{item.name}</strong><span class="record-meta"
										>Tier {item.tier} · Target {item.target} · {item.skill}</span
									></span
								><span class:green={item.enabled} class:red={!item.enabled} class="badge"
									>{item.enabled ? 'Enabled' : 'Disabled'}</span
								></summary
							>
							<form method="POST" action={action('edit-trap')}>
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
											>{#each SKILLS as skill}<option selected={skill === item.skill}
													>{skill}</option
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
								>
								<label for={`td-${item.id}`}
									>Description<textarea
										id={`td-${item.id}`}
										name="description"
										maxlength="10000"
										required>{item.description}</textarea
									></label
								>
								<label class="check-label"
									><input name="enabled" type="checkbox" checked={item.enabled} /> Enabled</label
								><button type="submit">Save trap</button>
							</form>
							<form class="toggle" method="POST" action={action('toggle-trap')}>
								<input type="hidden" name="id" value={item.id} /><input
									type="hidden"
									name="enabled"
									value={String(!item.enabled)}
								/><button class="btn-outline" type="submit"
									>{item.enabled ? 'Disable' : 'Enable'} trap</button
								>
							</form>
						</details>
					{/each}
				{:else}
					{@const kind = data.tab === 'species' ? 'species' : 'calling'}
					{#each definitionRecords as item (item.id)}
						<details class="record definition-record">
							<summary
								><span class="summary-copy"
									><strong>{item.name}</strong><span class="record-meta"
										>{item.description || 'No description provided.'}</span
									></span
								><span class:green={item.enabled} class:red={!item.enabled} class="badge"
									>{item.enabled ? 'Enabled' : 'Disabled'}</span
								></summary
							>
							<form method="POST" action={action('edit-definition')}>
								<input type="hidden" name="id" value={item.id} /><input
									type="hidden"
									name="kind"
									value={kind}
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
								><button type="submit">Save {kind}</button>
							</form>
							<form class="toggle" method="POST" action={action('toggle-definition')}>
								<input type="hidden" name="id" value={item.id} /><input
									type="hidden"
									name="kind"
									value={kind}
								/><input type="hidden" name="enabled" value={String(!item.enabled)} /><button
									class="btn-outline"
									type="submit">{item.enabled ? 'Disable' : 'Enable'} {kind}</button
								>
							</form>
						</details>
					{/each}
				{/if}
			</div>
			<nav class="pagination" aria-label="Bestiary results pages">
				{#if data.page > 1}
					<a class="btn btn-outline" href={pageHref(data.page - 1)} rel="prev">Previous</a>
				{:else}
					<span class="btn btn-outline disabled" aria-disabled="true">Previous</span>
				{/if}
				<span>Page {data.page} of {data.totalPages}</span>
				{#if data.page < data.totalPages}
					<a class="btn btn-outline" href={pageHref(data.page + 1)} rel="next">Next</a>
				{:else}
					<span class="btn btn-outline disabled" aria-disabled="true">Next</span>
				{/if}
			</nav>
		{/if}
	</section>
</div>

<style>
	.bestiary-header {
		margin-bottom: 1rem;
	}
	.bestiary-header h1 {
		font-size: clamp(2.5rem, 5vw, 3.8rem);
	}
	.bestiary-header .lede {
		margin-bottom: 0;
		font-size: 1.05rem;
	}
	.bestiary-tabs {
		display: flex;
		gap: 0.45rem;
		margin-bottom: 1.25rem;
		padding: 0.35rem;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: rgba(8, 12, 18, 0.58);
		scrollbar-width: thin;
	}
	.bestiary-tabs a {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.55rem;
		min-height: 44px;
		padding: 0.55rem 0.85rem;
		border: 1px solid transparent;
		border-radius: 10px;
		color: #aaa79d;
		font-weight: 700;
	}
	.bestiary-tabs a:hover {
		color: var(--parchment);
		background: rgba(217, 169, 94, 0.06);
	}
	.bestiary-tabs a[aria-current='page'] {
		border-color: rgba(217, 169, 94, 0.25);
		background: linear-gradient(135deg, rgba(84, 37, 48, 0.8), rgba(50, 31, 35, 0.68));
		color: var(--parchment);
	}
	.tab-count {
		display: grid;
		place-items: center;
		min-width: 1.7rem;
		height: 1.7rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		background: rgba(5, 8, 12, 0.45);
		color: var(--amber);
		font-size: 0.7rem;
	}
	.workspace-alert {
		margin-bottom: 1rem;
	}
	.bestiary-workspace {
		display: grid;
		grid-template-columns: minmax(270px, 340px) minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}
	.create-panel {
		position: sticky;
		top: 1rem;
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
	}
	.create-panel h2 {
		margin-bottom: 1rem;
	}
	.create-panel textarea {
		min-height: 82px;
	}
	.compact-stats {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.record-panel {
		min-width: 0;
	}
	.records-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.record-total,
	.result-count {
		color: var(--muted);
		font-size: 0.78rem;
	}
	.record-tools {
		display: grid;
		grid-template-columns: minmax(220px, 1fr) minmax(130px, 0.35fr) auto;
		align-items: end;
		gap: 0.75rem;
		margin-top: 1.2rem;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: rgba(7, 11, 17, 0.4);
	}
	.search-field {
		display: grid;
		gap: 0.35rem;
	}
	.search-field > span,
	.status-field > span {
		font-size: 0.78rem;
		font-weight: 700;
	}
	.status-field {
		display: grid;
		gap: 0.35rem;
	}
	.filter-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.filter-actions button,
	.filter-actions a {
		min-height: 40px;
		width: auto;
	}
	.result-count {
		margin: 0.65rem 0 1rem;
	}
	.record-list {
		display: grid;
		gap: 0.65rem;
	}
	.record {
		border: 1px solid var(--border);
		border-radius: 12px;
		background: rgba(7, 11, 17, 0.32);
	}
	.record[open] {
		border-color: rgba(217, 169, 94, 0.3);
		background: rgba(12, 17, 24, 0.7);
	}
	.record summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: 64px;
		padding: 0.75rem 1rem;
		cursor: pointer;
	}
	.summary-copy {
		display: grid;
		min-width: 0;
		gap: 0.1rem;
	}
	.summary-copy strong {
		color: var(--parchment);
		font-size: 1rem;
		overflow-wrap: anywhere;
		word-break: break-word;
	}
	.record-meta {
		color: var(--muted);
		font-size: 0.72rem;
		line-height: 1.35;
		overflow-wrap: anywhere;
		word-break: break-word;
	}
	.record > form {
		margin: 0 1rem 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.record .toggle {
		display: block;
	}
	.toggle button {
		width: auto;
	}
	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.pagination > span:not(.btn-outline) {
		color: var(--muted);
		font-size: 0.78rem;
	}
	.pagination .btn-outline {
		min-width: 6.5rem;
		text-align: center;
	}
	.pagination .disabled {
		opacity: 0.45;
	}
	.muted-panel {
		margin-top: 1rem;
		padding: 2rem 1rem;
	}
	.muted-panel p {
		margin-bottom: 0;
	}

	@media (max-width: 980px) {
		.bestiary-workspace {
			grid-template-columns: 1fr;
		}
		.create-panel {
			position: static;
		}
	}
	@media (max-width: 620px) {
		.bestiary-tabs {
			margin-inline: -0.25rem;
		}
		.record-tools {
			grid-template-columns: 1fr;
		}
		.filter-actions {
			justify-content: flex-start;
		}
		.compact-stats {
			grid-template-columns: 1fr 1fr;
		}
		.record summary {
			align-items: flex-start;
		}
	}
</style>
