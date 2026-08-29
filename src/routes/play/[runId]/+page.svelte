<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { PendingNarration, TerminalEvent } from '$lib/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form } = $props();
	let submitting = $state(false);
	let hydrated = $state(false);
	let selectedAction = $state('');
	let streamError = $state('');
	let liveText = $state<Record<string, string>>({});
	let activeStreams = $state<Record<string, boolean>>({});
	let terminal: HTMLElement;
	let stickToBottom = true;

	let roomPending = $derived(
		data.room.entryStatus === 'pending' || data.room.entryStatus === 'streaming'
	);
	let actionsDisabled = $derived(
		submitting || (hydrated && (roomPending || Object.keys(activeStreams).length > 0))
	);
	let roomProse = $derived(
		data.room.entryId && liveText[data.room.entryId] !== undefined
			? liveText[data.room.entryId]
			: data.room.prose
	);

	function actionText(formData: FormData) {
		const value = formData.get('actionText');
		return typeof value === 'string' ? value.trim() : '';
	}

	const enhanceAction: SubmitFunction = async ({ formData, cancel }) => {
		if (actionsDisabled) {
			cancel();
			return;
		}
		submitting = true;
		selectedAction = actionText(formData);
		streamError = '';
		return async ({ result, update }) => {
			if (result.type !== 'success') {
				submitting = false;
				await update();
				return;
			}
			const payload = result.data as {
				success?: boolean;
				turnId?: string;
				roomEntryId?: string | null;
			};
			await invalidateAll();
			if (payload.success && payload.turnId) {
				await consume({ kind: 'turn', id: payload.turnId });
				if (payload.roomEntryId) await consume({ kind: 'room', id: payload.roomEntryId });
			}
			submitting = false;
			selectedAction = '';
			await invalidateAll();
		};
	};

	async function consume(target: PendingNarration) {
		if (activeStreams[target.id]) return;
		activeStreams = { ...activeStreams, [target.id]: true };
		try {
			const response = await fetch(
				`/play/${data.runId}/stream?kind=${target.kind}&id=${encodeURIComponent(target.id)}`,
				{ headers: { Accept: 'text/event-stream' } }
			);
			if (!response.ok || !response.body)
				throw new Error('The narration stream could not be opened.');
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
				let boundary = buffer.indexOf('\n\n');
				while (boundary >= 0) {
					const block = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const eventName = block
						.split('\n')
						.find((line) => line.startsWith('event:'))
						?.slice(6)
						.trim();
					const raw = block
						.split('\n')
						.filter((line) => line.startsWith('data:'))
						.map((line) => line.slice(5).trimStart())
						.join('\n');
					if (eventName && raw) {
						const payload = JSON.parse(raw) as { text?: string; message?: string };
						if (eventName === 'snapshot')
							liveText = { ...liveText, [target.id]: payload.text ?? '' };
						if (eventName === 'chunk')
							liveText = {
								...liveText,
								[target.id]: (liveText[target.id] ?? '') + (payload.text ?? '')
							};
						if (eventName === 'error')
							streamError = payload.message ?? 'The narration stream was interrupted.';
					}
					boundary = buffer.indexOf('\n\n');
				}
				if (done) break;
			}
		} catch (error) {
			streamError =
				error instanceof Error ? error.message : 'The narration stream was interrupted.';
		} finally {
			const rest = { ...activeStreams };
			delete rest[target.id];
			activeStreams = rest;
			await invalidateAll();
		}
	}

	function displayText(event: TerminalEvent) {
		return liveText[event.id] ?? (event.kind === 'room' ? event.prose : event.narration);
	}

	function onTerminalScroll() {
		stickToBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 56;
	}

	$effect(() => {
		const contentVersion = data.terminal.length + Object.values(liveText).join('').length;
		if (terminal && stickToBottom && contentVersion >= 0)
			requestAnimationFrame(() => terminal.scrollTo({ top: terminal.scrollHeight }));
	});

	onMount(() => {
		hydrated = true;
		void (async () => {
			for (const target of data.pendingNarrations) await consume(target);
		})();
	});
</script>

<svelte:head><title>Depth {data.room.number} | Dungeon Endless</title></svelte:head>
<header class="page-header play-header">
	<div>
		<div class="eyebrow">{data.characterName} / {data.status} expedition</div>
		<h1>Depth {data.room.number}</h1>
	</div>
	<div class="actions">
		<a class="btn btn-secondary" href="/characters">Leave table</a>
		{#if data.status === 'active'}
			<form method="POST" action="?/abandon" use:enhance>
				<button class="btn-danger" type="submit" disabled={actionsDisabled}>Abandon run</button>
			</form>
		{/if}
	</div>
</header>

{#if form?.error}<div class="alert alert-error play-alert" role="alert">{form.error}</div>{/if}
{#if streamError}<div class="alert alert-error play-alert" role="alert">{streamError}</div>{/if}
{#if submitting || Object.keys(activeStreams).length > 0}
	<div class="dm-pending" role="status" aria-live="polite">
		<span class="dm-orb" aria-hidden="true"></span>
		<div>
			<strong
				>{selectedAction ? `You chose: ${selectedAction}` : 'The chronicle is unfolding...'}</strong
			>
			<span>The Dungeon of the Endless DM is taking its turn.</span>
		</div>
	</div>
{/if}
{#if data.status !== 'active'}
	<div class="alert alert-info play-alert" role="status">
		This expedition is {data.status}. Its chronicle remains available, but no further actions can be
		taken.
	</div>
{/if}

<div class="play-layout">
	<aside class="card run-panel" aria-label="Run status and inventory">
		<div class="eyebrow">Wayfarer</div>
		<h2>{data.character.name}</h2>
		<p class="text-muted">
			{data.character.title} / Level {data.character.level}
			{data.character.className}
		</p>
		<div class="card-head vitality-head">
			<strong>Vitality</strong><span>{data.character.hp} / {data.character.maxHp}</span>
		</div>
		<div class="hp-bar" aria-label={`Health ${data.character.hp} of ${data.character.maxHp}`}>
			<div style={`width:${Math.max(0, (data.character.hp / data.character.maxHp) * 100)}%`}></div>
		</div>
		<div class="mini-stats play-stats">
			<span><small>Body</small>{data.character.body}</span><span
				><small>Mind</small>{data.character.mind}</span
			><span><small>Spirit</small>{data.character.spirit}</span>
		</div>
		<dl class="run-facts">
			<div>
				<dt>Defense</dt>
				<dd>{data.character.defense}</dd>
			</div>
			<div>
				<dt>Attack</dt>
				<dd>+{data.character.attackBonus}</dd>
			</div>
			<div>
				<dt>Banked gold</dt>
				<dd>{data.character.gold}</dd>
			</div>
		</dl>
		<div class="inventory-head">
			<div class="eyebrow">Inventory</div>
			<span>{data.inventory.length}</span>
		</div>
		{#if data.inventory.length === 0}
			<p class="inventory-empty">Nothing carried. Only nerve and torchlight remain.</p>
		{:else}
			<ul class="inventory-list">
				{#each data.inventory as item, index (`${item.name}-${index}`)}
					<li>
						<div><strong>{item.name}</strong><span class="badge gold">{item.kind}</span></div>
						<p>{item.description || 'No description recorded.'}</p>
						<div class="item-meta">
							{#if item.stat}<span>Effect: {item.stat}{item.skill ? ` / ${item.skill}` : ''}</span
								>{/if}
							{#if item.value !== undefined}<span>Value: {item.value}</span>{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</aside>

	<main class="stack play-main">
		<article class="card room-card">
			<div class="card-head">
				<span class="badge red">{data.room.kind}</span><span class="eyebrow"
					>Room {data.room.number}</span
				>
			</div>
			<h2>{data.room.title}</h2>
			<div
				class:typing={roomPending || (data.room.entryId && activeStreams[data.room.entryId])}
				class="prose-block"
			>
				{roomProse}
			</div>
		</article>
		{#if data.status === 'active'}
			<section class="card action-card" aria-labelledby="choose-action">
				<div class="eyebrow">Your turn</div>
				<h2 id="choose-action">What does {data.character.name} do?</h2>
				{#if roomPending}<p class="text-muted">
						Actions unlock when the room finishes revealing itself.
					</p>{/if}
				<div class="action-grid">
					{#each data.suggestions as suggestion, index (data.actionKeys[index])}
						<form method="POST" action="?/act" use:enhance={enhanceAction}>
							<input type="hidden" name="actionText" value={suggestion.typed} />
							<input type="hidden" name="expectedVersion" value={data.expectedVersion} />
							<input type="hidden" name="actionKey" value={data.actionKeys[index]} />
							<button type="submit" title={suggestion.detail} disabled={actionsDisabled}
								>{suggestion.label}</button
							>
						</form>
					{/each}
				</div>
				<form method="POST" action="?/act" class="composer" use:enhance={enhanceAction}>
					<label class="sr-only" for="action-text">Describe another action</label>
					<input type="hidden" name="expectedVersion" value={data.expectedVersion} />
					<input
						type="hidden"
						name="actionKey"
						value={data.actionKeys[data.suggestions.length] ?? data.actionKey}
					/>
					<input
						id="action-text"
						name="actionText"
						minlength="1"
						maxlength="500"
						placeholder="Or describe another action..."
						required
						disabled={actionsDisabled}
					/>
					<button type="submit" disabled={actionsDisabled}>Attempt</button>
				</form>
			</section>
		{/if}
	</main>
</div>

<section class="expedition-terminal" aria-labelledby="terminal-title">
	<header>
		<div>
			<div class="eyebrow">Expedition terminal</div>
			<h2 id="terminal-title">The living chronicle</h2>
		</div>
		<span class="terminal-status"><i></i> durable record</span>
	</header>
	<div
		class="terminal-scroll"
		bind:this={terminal}
		onscroll={onTerminalScroll}
		role="region"
		aria-label="Chronological expedition record"
	>
		{#if data.terminal.length === 0}<p class="terminal-empty">Awaiting the first record...</p>{/if}
		{#each data.terminal as event (event.id)}
			<article class="terminal-event {event.kind}">
				<div class="terminal-meta">
					<span
						>{new Date(event.timestamp).toLocaleTimeString([], {
							hour: '2-digit',
							minute: '2-digit'
						})}</span
					>
					{#if event.kind === 'room'}<strong>ROOM {event.roomNumber} / {event.roomKind}</strong
						>{:else}<strong>TURN {event.turn} / ACTION</strong>{/if}
					<span class="stream-state">{activeStreams[event.id] ? 'streaming' : event.status}</span>
				</div>
				{#if event.kind === 'room'}
					<h3>{event.title}</h3>
				{:else}
					<p class="terminal-action"><b>&gt; YOU</b> {event.action}</p>
					<p class="terminal-outcome">
						<b>OUTCOME</b>
						{event.outcome.message} / HP {event.outcome.hpBefore} -&gt; {event.outcome.hpAfter}
					</p>
					{#each event.rolls as roll}
						<div class="terminal-roll {roll.success ? 'success' : 'failure'}">
							<span>{roll.label}</span><code
								>[{roll.dice.join(', ')}] kept {roll.selected} + {roll.modifier} = {roll.total} vs {roll.target}</code
							><b>{roll.success ? 'PASS' : 'FAIL'}</b>
						</div>
					{/each}
				{/if}
				<p class:typing={activeStreams[event.id]} class="terminal-prose">{displayText(event)}</p>
			</article>
		{/each}
	</div>
</section>
