<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Settings | Dungeon Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">Company ledger</div>
		<h1>Settings.</h1>
		<p class="lede">Choose the name carried by your company through the chronicle.</p>
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
		<button type="submit">Save settings</button>
	</form>
</section>

<style>
	.settings-card {
		max-width: 42rem;
	}
</style>
