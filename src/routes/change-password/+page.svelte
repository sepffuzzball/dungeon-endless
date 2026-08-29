<script lang="ts">
	let { form } = $props();
</script>

<svelte:head><title>Change password | Dungeon of the Endless</title></svelte:head>

<section class="auth-layout auth-layout-wide">
	<div class="card burgundy auth-card">
		<div class="eyebrow">Secure the archive</div>
		<h1>Choose a new password.</h1>
		<p class="lede">Before you continue, replace the temporary password for this account.</p>

		{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
		{#if form?.success}<div class="alert alert-info" role="status">{form.success}</div>{/if}

		<form method="POST">
			<label for="current-password">
				Current password
				<input
					id="current-password"
					name="currentPassword"
					type="password"
					autocomplete="current-password"
					required
				/>
			</label>
			<label for="new-password">
				New password
				<input
					id="new-password"
					name="newPassword"
					type="password"
					autocomplete="new-password"
					minlength="12"
					required
				/>
				<span class="field-hint">Use 12 to 72 UTF-8 bytes.</span>
			</label>
			<label for="confirm-password">
				Confirm new password
				<input
					id="confirm-password"
					name="confirmPassword"
					type="password"
					autocomplete="new-password"
					minlength="12"
					required
				/>
			</label>
			<button class="btn-block" type="submit">Seal the new password</button>
		</form>
	</div>
</section>
