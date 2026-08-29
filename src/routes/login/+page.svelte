<script lang="ts">
	let { form } = $props();
</script>

<svelte:head><title>Sign in | Dungeon Endless</title></svelte:head>
<section style="max-width: 460px; margin: min(12vh, 7rem) auto">
	<div class="card burgundy">
		<div class="eyebrow">Return to the threshold</div>
		<h1 style="font-size: 3.2rem">Light the lantern.</h1>
		<p class="lede">Your chronicle is waiting where you left it.</p>
		{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
		<form method="POST">
			<label for="username"
				>Username<input id="username" name="username" autocomplete="username" required /></label
			>
			<label for="password"
				>Password<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
				/></label
			>
			<button type="submit">Enter the archive</button>
		</form>
	</div>
</section>
