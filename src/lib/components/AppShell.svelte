<script lang="ts">
	import type { SafeUser } from '$lib/types';
	import { page } from '$app/state';

	let {
		user = $bindable(null),
		children
	}: {
		user?: SafeUser | null;
		children: import('svelte').Snippet;
	} = $props();

	const isEditor = $derived(user?.role === 'editor' || user?.role === 'admin');
	const isAdmin = $derived(user?.role === 'admin');
	const active = $derived(page.url.pathname);
</script>

{#if active === '/login'}
	<main class="main" id="main-content">
		{@render children()}
	</main>
{:else}
	<div class="shell">
		<aside class="sidebar" aria-label="Primary navigation">
			<a class="brand" href="/" aria-label="Dungeon Endless home">
				<span class="brand-mark" aria-hidden="true">DE</span>
				<span>Dungeon Endless<small>A Chronicle Below</small></span>
			</a>

			{#if user}
				<nav class="nav" aria-label="Account">
					<span class="nav-label">Wayfinding</span>
					<a href="/" class:active={active === '/'}><span aria-hidden="true">01</span> Chronicle</a>
					<a href="/characters" class:active={active.startsWith('/characters')}
						><span aria-hidden="true">02</span> Company</a
					>
					{#if isEditor}
						<a href="/editor" class:active={active.startsWith('/editor')}
							><span aria-hidden="true">03</span> Bestiary</a
						>
					{/if}
					{#if isAdmin}
						<a href="/admin" class:active={active.startsWith('/admin')}
							><span aria-hidden="true">04</span> Stewardship</a
						>
					{/if}
				</nav>

				<div class="sidebar-footer">
					<div class="eyebrow">Signed in as</div>
					<div class="user-name">{user.username}</div>
					<div>
						<span class="badge {isAdmin ? 'purple' : isEditor ? 'green' : 'gold'}">{user.role}</span
						>
					</div>
					<form method="post" action="/logout" class="logout-form">
						<button class="btn-sm btn-outline" type="submit">Sign out</button>
					</form>
				</div>
			{/if}
		</aside>

		<main class="main" id="main-content">
			{@render children()}
		</main>
	</div>
{/if}
