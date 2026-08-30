<script lang="ts">
	import Portrait from '$lib/components/Portrait.svelte';
	import { GENDER_PRESENTATION_SUGGESTIONS, PRONOUN_SUGGESTIONS } from '$lib/types';
	let { data, form } = $props();
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
		<dl class="identity-summary">
			<div>
				<dt>Gender / presentation</dt>
				<dd>{data.character.genderIdentity}</dd>
			</div>
			<div>
				<dt>Pronouns</dt>
				<dd>{data.character.pronouns}</dd>
			</div>
		</dl>
		<a class="btn btn-secondary" href="/characters">Return to active characters</a>
	</section>
{:else}
	<form method="POST" action="?/save" class="card edit-form">
		<section class="form-section identity-fields">
			<Portrait src={data.character.imageUrl} name={data.character.name} size="profile" />
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
			<label for="pronouns"
				>Pronouns<input
					id="pronouns"
					name="pronouns"
					list="pronoun-suggestions"
					value={data.character.pronouns}
					required
					maxlength="80"
				/></label
			>
			<label for="genderIdentity"
				>Gender / presentation <span class="field-hint">Custom values are welcome.</span><input
					id="genderIdentity"
					name="genderIdentity"
					list="gender-presentation-suggestions"
					value={data.character.genderIdentity}
					required
					maxlength="80"
				/></label
			>
			<datalist id="pronoun-suggestions">
				{#each PRONOUN_SUGGESTIONS as option}<option value={option}></option>{/each}
			</datalist>
			<datalist id="gender-presentation-suggestions">
				{#each GENDER_PRESENTATION_SUGGESTIONS as option}<option value={option}></option>{/each}
			</datalist>
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
		<section class="form-section profile-fields">
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
	.edit-form {
		max-width: 70rem;
		margin-inline: auto;
		grid-template-columns: minmax(0, 1.2fr) minmax(18rem, 0.8fr);
		align-items: start;
		gap: 1.5rem;
	}
	.profile-fields {
		padding-left: 1.5rem;
		border-left: 1px solid var(--border);
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
	.identity-summary {
		display: grid;
		gap: 0.65rem;
		margin: 0;
	}
	.identity-summary dt {
		color: var(--muted);
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.identity-summary dd {
		margin: 0.15rem 0 0;
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
		.edit-form {
			grid-template-columns: 1fr;
		}
		.profile-fields {
			padding: 1.5rem 0 0;
			border-left: 0;
			border-top: 1px solid var(--border);
		}
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
