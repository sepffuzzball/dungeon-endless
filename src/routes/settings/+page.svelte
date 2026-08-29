<script lang="ts">
	import SliderField from '$lib/components/SliderField.svelte';
	import { untrack } from 'svelte';
	let { data, form } = $props();
	let brutality = $state(untrack(() => data.brutality));
	let debauchery = $state(untrack(() => data.debauchery));
</script>

<svelte:head><title>Settings | Dungeon of the Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">Company ledger</div>
		<h1>Settings.</h1>
	</div>
</header>
{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
{#if form?.success}<div class="alert alert-info" role="status">{form.success}</div>{/if}
<section class="card settings-card">
	<h2>Company profile</h2>
	<form method="POST">
		<label for="company-name"
			>Company name<input
				id="company-name"
				name="companyName"
				value={data.companyName}
				minlength="1"
				maxlength="80"
				required
			/><span class="field-hint">1 to 80 characters.</span></label
		>
		<SliderField
			label="Brutality"
			name="brutality"
			bind:value={brutality}
			hint="Sets the narrative severity for future expeditions, from restrained to merciless."
		/>
		<SliderField
			label="Debauchery"
			name="debauchery"
			bind:value={debauchery}
			hint="Sets the maturity of generated themes for future expeditions."
		/>
		<button type="submit">Save settings</button>
	</form>
</section>

<style>
	.settings-card {
		max-width: 42rem;
	}
</style>
