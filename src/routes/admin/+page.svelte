<script lang="ts">
	import type { PageData } from './$types';

	type FormResult = { error?: string; success?: string };
	let { data, form } = $props<{ data: PageData; form: FormResult | null }>();
</script>

<svelte:head><title>Stewardship | Dungeon Endless</title></svelte:head>

<header class="page-header">
	<div>
		<div class="eyebrow">Restricted archive</div>
		<h1>Stewardship.</h1>
		<p class="lede">Manage who enters the archive and which voices speak for the dungeon.</p>
	</div>
	<span class="badge purple">Administrator</span>
</header>

{#if form?.error}<div class="alert alert-error" role="alert">{form.error}</div>{/if}
{#if form?.success}<div class="alert alert-info" role="status">{form.success}</div>{/if}

<div class="grid-2">
	<section class="card">
		<div class="eyebrow">Access</div>
		<h2>Create a user</h2>
		<form method="POST" action="?/user">
			<label for="new-username"
				>Username<input
					id="new-username"
					name="username"
					maxlength="64"
					required
					autocomplete="off"
				/></label
			>
			<div class="form-grid">
				<label for="new-role"
					>Role<select id="new-role" name="role">
						<option value="user">Player</option><option value="editor">Editor</option><option
							value="admin">Admin</option
						>
					</select></label
				>
				<label for="temp-password"
					>Temporary password<input
						id="temp-password"
						name="password"
						type="password"
						minlength="12"
						required
						autocomplete="new-password"
					/><span class="field-hint">12 to 72 UTF-8 bytes.</span></label
				>
			</div>
			<label class="check-label"
				><input name="mustChangePassword" type="checkbox" checked /> Require password change</label
			>
			<button type="submit">Create account</button>
		</form>
	</section>

	<section class="card burgundy">
		<div class="eyebrow">Narrative infrastructure</div>
		<h2>Add LLM endpoint</h2>
		<form method="POST" action="?/endpoint">
			<div class="form-grid">
				<label for="endpoint-name"
					>Display name<input id="endpoint-name" name="name" maxlength="120" required /></label
				>
				<label for="purpose"
					>Purpose<select id="purpose" name="purpose">
						<option value="prose">Prose</option><option value="interpretation"
							>Interpretation</option
						><option value="summary">Summary</option><option value="suggestions">Suggestions</option
						>
					</select></label
				>
			</div>
			<label for="base-url"
				>Base URL<input
					id="base-url"
					name="baseUrl"
					type="url"
					required
					placeholder="https://api.example.com/v1"
				/></label
			>
			<div class="form-grid">
				<label for="model">Model<input id="model" name="model" maxlength="200" required /></label>
				<label for="timeout"
					>Timeout (ms)<input
						id="timeout"
						name="timeoutMs"
						type="number"
						min="1000"
						max="120000"
						value={data.defaultTimeoutMs}
						required
					/></label
				>
			</div>
			<label for="api-key"
				>API key <span class="field-hint">Optional; encrypted at rest and never displayed.</span
				><input id="api-key" name="apiKey" type="password" autocomplete="new-password" /></label
			>
			<label class="check-label"
				><input name="enabled" type="checkbox" checked /> Enable endpoint</label
			>
			<button type="submit">Store endpoint</button>
		</form>
	</section>
</div>

<div class="grid-2 records">
	<section class="card">
		<div class="card-head">
			<h2>Users</h2>
			<span class="badge">{data.users.length} accounts</span>
		</div>
		<div class="table-wrap">
			<table>
				<thead
					><tr><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr
					></thead
				>
				<tbody>
					{#each data.users as user}
						<tr>
							<td>
								<strong>{user.username}</strong>{#if user.mustChangePassword}<br /><small
										class="text-muted">Password change required</small
									>{/if}
							</td>
							<td><span class="badge">{user.role}</span></td>
							<td
								><span
									class:green={user.status === 'active'}
									class:red={user.status === 'disabled'}
									class="badge">{user.status}</span
								></td
							>
							<td>{new Date(user.createdAt).toLocaleDateString()}</td>
							<td>
								<div class="actions">
									<form class="row-action" method="POST" action="?/toggle-user">
										<input type="hidden" name="id" value={user.id} />
										<button class="btn-outline" type="submit"
											>{user.status === 'active' ? 'Disable' : 'Enable'}</button
										>
									</form>
									<form class="reset-action" method="POST" action="?/reset-password">
										<input type="hidden" name="id" value={user.id} />
										<label class="sr-only" for={`password-${user.id}`}
											>New password for {user.username}</label
										>
										<input
											id={`password-${user.id}`}
											name="password"
											type="password"
											minlength="12"
											required
											autocomplete="new-password"
											placeholder="New password"
										/>
										<button class="btn-outline" type="submit">Reset</button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="card">
		<div class="card-head">
			<h2>LLM endpoints</h2>
			<span class="badge green">Keys concealed</span>
		</div>
		<div class="table-wrap">
			<table>
				<thead
					><tr><th>Name</th><th>Purpose</th><th>Model</th><th>Status</th><th>Action</th></tr></thead
				>
				<tbody>
					{#each data.endpoints as endpoint}
						<tr>
							<td>
								<strong>{endpoint.name}</strong><br /><small class="text-muted"
									>{endpoint.baseUrl} ({endpoint.timeoutMs} ms)</small
								>
							</td>
							<td>{endpoint.purpose}</td>
							<td>{endpoint.model}</td>
							<td
								><span class:green={endpoint.enabled} class:red={!endpoint.enabled} class="badge"
									>{endpoint.enabled ? 'Enabled' : 'Disabled'}</span
								></td
							>
							<td>
								<form class="row-action" method="POST" action="?/toggle-endpoint">
									<input type="hidden" name="id" value={endpoint.id} />
									<button class="btn-outline" type="submit"
										>{endpoint.enabled ? 'Disable' : 'Enable'}</button
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
	.records {
		margin-top: 1rem;
	}
	.actions {
		display: grid;
		gap: 0.5rem;
		min-width: 13rem;
	}
	.row-action {
		display: block;
	}
	.reset-action {
		display: grid;
		grid-template-columns: minmax(8rem, 1fr) auto;
		gap: 0.4rem;
	}
	.row-action button,
	.reset-action button,
	.reset-action input {
		min-height: 36px;
		padding: 0.4rem 0.65rem;
	}
</style>
