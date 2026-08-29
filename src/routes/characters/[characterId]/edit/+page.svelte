<script lang="ts">
	let { data, form } = $props();
	let imageFailed = $state(false);
	let retirementName = $state('');
	let retirementAcknowledged = $state(false);
</script>

<svelte:head><title>Edit {data.character.name} | Dungeon of the Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">Character profile</div>
		<h1>Edit {data.character.name}</h1>
		<p class="lede">Identity can change. Progression, equipment, and records cannot.</p>
	</div>
	<a class="btn btn-secondary" href="/characters">Back to Characters</a>
</header>
{#if form?.error}<div class="alert alert-error page-alert" role="alert">{form.error}</div>{/if}
{#if data.character.retiredAt}
	<section class="card retired-state" aria-labelledby="retired-heading">
		<div>
			<div class="eyebrow">Retired hero</div>
			<h2 id="retired-heading">This profile is read-only</h2>
			<p>
				{data.character.name} no longer appears in your active rosters and cannot be restored, edited,
				upgraded, or sent on a new expedition. Historical runs and company records remain preserved.
			</p>
		</div>
		<a class="btn btn-secondary" href="/characters">Return to active characters</a>
	</section>
{:else}
	<form method="POST" action="?/default" class="grid-2">
		<section class="card">
			<div class="portrait">
				{#if data.character.imageUrl && !imageFailed}<img
						src={data.character.imageUrl}
						alt={`Portrait of ${data.character.name}`}
						loading="lazy"
						referrerpolicy="no-referrer"
						width="640"
						height="480"
						onerror={() => (imageFailed = true)}
					/>{:else}<span aria-hidden="true">{data.character.name.slice(0, 1).toUpperCase()}</span
					>{/if}
			</div>
			<label for="name"
				>Name<input
					id="name"
					name="name"
					value={data.character.name}
					required
					maxlength="40"
				/></label
			>
			<label for="title"
				>Title<input id="title" name="title" value={data.character.title} maxlength="60" /></label
			>
			<label for="description"
				>Description<textarea id="description" name="description" maxlength="2000"
					>{data.character.description}</textarea
				></label
			>
			<label for="imageUrl"
				>Portrait URL <span class="field-hint"
					>Optional http or https image; never fetched by the server or sent to narration.</span
				><input
					id="imageUrl"
					name="imageUrl"
					type="url"
					maxlength="2048"
					value={data.character.imageUrl ?? ''}
				/></label
			>
		</section>
		<section class="card burgundy">
			<div class="form-grid">
				<label for="age"
					>Age<input
						id="age"
						name="age"
						type="number"
						min="1"
						max="999"
						value={data.character.age}
						required
					/></label
				>
				<label for="height"
					>Height<select id="height" name="height"
						>{#each data.heightOptions as option}<option selected={option === data.character.height}
								>{option}</option
							>{/each}</select
					></label
				>
				<label for="build"
					>Build<select id="build" name="build"
						>{#each data.buildOptions as option}<option selected={option === data.character.build}
								>{option}</option
							>{/each}</select
					></label
				>
				<label for="species"
					>Species<select id="species" name="species"
						>{#each data.species as option}{#if option.enabled || option.name === data.character.species}<option
									value={option.name}
									selected={option.name === data.character.species}
									>{option.name}{option.enabled ? '' : ' (unavailable)'}</option
								>{/if}{/each}</select
					></label
				>
				<label for="className"
					>Calling<select id="className" name="className"
						>{#each data.callings as option}{#if option.enabled || option.name === data.character.className}<option
									value={option.name}
									selected={option.name === data.character.className}
									>{option.name}{option.enabled ? '' : ' (unavailable)'}</option
								>{/if}{/each}</select
					></label
				>
			</div>
			<button type="submit">Save character</button>
		</section>
	</form>

	<section class="danger-zone" aria-labelledby="danger-heading">
		<div>
			<div class="eyebrow">Irreversible action</div>
			<h2 id="danger-heading">Danger Zone</h2>
			<p>
				Retiring {data.character.name} permanently removes this hero from your normal rosters. Their past
				expeditions and records will remain. A hero on an active expedition cannot be retired.
			</p>
		</div>
		<form method="POST" action="?/retire" class="retirement-form">
			<label for="confirmationName">
				Type <strong>{data.character.name}</strong> to confirm
				<input
					id="confirmationName"
					name="confirmationName"
					autocomplete="off"
					required
					bind:value={retirementName}
				/>
			</label>
			<label class="check-label" for="confirmRetirement">
				<input
					id="confirmRetirement"
					name="confirmRetirement"
					type="checkbox"
					value="yes"
					required
					bind:checked={retirementAcknowledged}
				/>
				I understand that retirement cannot be undone.
			</label>
			<button
				type="submit"
				class="btn-danger"
				disabled={!retirementAcknowledged || retirementName !== data.character.name}
				>Retire {data.character.name}</button
			>
		</form>
	</section>
{/if}

<style>
	.portrait {
		aspect-ratio: 4/3;
		background: linear-gradient(145deg, #4a2930, #171a20);
		display: grid;
		place-items: center;
		font-size: 4rem;
		color: var(--gold);
		margin-bottom: 1rem;
		overflow: hidden;
	}
	.portrait img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.page-alert {
		margin-bottom: 1rem;
	}
	.retired-state,
	.danger-zone {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 2rem;
	}
	.retired-state p,
	.danger-zone p {
		max-width: 68ch;
		color: var(--muted);
	}
	.danger-zone {
		margin-top: 1.5rem;
		padding: clamp(1rem, 2.4vw, 1.6rem);
		border: 1px solid #8d424a;
		border-radius: var(--radius);
		background: linear-gradient(145deg, rgba(91, 34, 44, 0.34), rgba(17, 23, 32, 0.96));
	}
	.danger-zone .eyebrow {
		color: #ef9a9f;
	}
	.retirement-form {
		width: min(100%, 28rem);
		flex: 0 0 min(100%, 28rem);
	}
	.retirement-form strong {
		color: var(--parchment);
	}
	@media (max-width: 900px) {
		.retired-state,
		.danger-zone {
			align-items: stretch;
			flex-direction: column;
		}
		.retirement-form {
			width: 100%;
			flex-basis: auto;
		}
	}
</style>
