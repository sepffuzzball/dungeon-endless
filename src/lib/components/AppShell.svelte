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

	let menuExpanded = $state(false);
	const isEditor = $derived(user?.role === 'editor' || user?.role === 'admin');
	const isAdmin = $derived(user?.role === 'admin');
	const active = $derived(page.url.pathname);
	const charactersActive = $derived(active.startsWith('/characters'));
	const dungeonActive = $derived(active.startsWith('/dungeon') || active.startsWith('/play/'));
</script>

{#if active === '/login'}
	<main class="main" id="main-content">
		{@render children()}
	</main>
{:else}
	<div class="shell">
		<aside class:expanded={menuExpanded} class="sidebar" aria-label="Primary navigation">
			<div class="sidebar-head">
				<a class="brand" href="/" aria-label="Dungeon of the Endless home">
					<span class="brand-mark" aria-hidden="true">
						<svg viewBox="0 0 32 32">
							<path d="M6 27V13C6 7 10 3 16 3s10 4 10 10v14" />
							<path d="M9 27c3-9 11-9 14 0M10 19c4-5 8 5 12 0" />
						</svg>
					</span>
					<span class="brand-copy">
						<strong>{user?.companyName || 'Dungeon of the Endless'}</strong>
						<small>Dungeon of the Endless</small>
					</span>
				</a>
				<button
					class="menu-toggle btn-outline"
					type="button"
					aria-label={menuExpanded ? 'Collapse navigation menu' : 'Expand navigation menu'}
					aria-expanded={menuExpanded}
					aria-controls="primary-menu"
					onclick={() => (menuExpanded = !menuExpanded)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M5 7h14M5 12h14M5 17h14" />
					</svg>
				</button>
			</div>

			{#if user}
				<nav class="nav" id="primary-menu" aria-label="Account">
					<span class="nav-label">Menu</span>
					<a href="/" aria-current={active === '/' ? 'page' : undefined}>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Zm2 0v16M10 8h6M10 12h6" /></svg
						>
						<span class="nav-text">Chronicle</span>
					</a>
					<a href="/characters" aria-current={charactersActive ? 'page' : undefined}>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><circle cx="9" cy="8" r="3" /><path
								d="M3.5 19c.5-4 2.5-6 5.5-6s5 2 5.5 6M15 5.5a3 3 0 0 1 0 5.7M16 13c2.5.5 4 2.4 4.5 5"
							/></svg
						>
						<span class="nav-text">Characters</span>
					</a>
					<a href="/dungeon" aria-current={dungeonActive ? 'page' : undefined}>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M4 21V10a8 8 0 0 1 16 0v11M8 21V10a4 4 0 0 1 8 0v11M12 15v.01" /></svg
						>
						<span class="nav-text">Dungeon</span>
					</a>
					<a href="/settings" aria-current={active.startsWith('/settings') ? 'page' : undefined}>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6" /></svg
						>
						<span class="nav-text">Settings</span>
					</a>
					{#if isEditor}
						<a href="/editor" aria-current={active.startsWith('/editor') ? 'page' : undefined}>
							<svg viewBox="0 0 24 24" aria-hidden="true"
								><path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h7" /><path d="m16 13 3 3-3 3" /></svg
							>
							<span class="nav-text">Bestiary</span>
						</a>
					{/if}
					{#if isAdmin}
						<a href="/admin" aria-current={active.startsWith('/admin') ? 'page' : undefined}>
							<svg viewBox="0 0 24 24" aria-hidden="true"
								><path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z" /><path
									d="m9 12 2 2 4-5"
								/></svg
							>
							<span class="nav-text">Stewardship</span>
						</a>
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
