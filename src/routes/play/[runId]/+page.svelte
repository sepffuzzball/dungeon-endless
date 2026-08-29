<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import StatBreakdown from '$lib/components/StatBreakdown.svelte';
	import type { PendingNarration, SkillName, TerminalEvent } from '$lib/types';
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
	const attributeGroups: {
		stat: 'body' | 'mind' | 'spirit';
		skills: [SkillName, SkillName];
	}[] = [
		{ stat: 'body', skills: ['Athletics', 'Stealth'] },
		{ stat: 'mind', skills: ['Knowledge', 'Magic'] },
		{ stat: 'spirit', skills: ['Persuasion', 'Willpower'] }
	];

	let roomPending = $derived(
		data.room.entryStatus === 'pending' || data.room.entryStatus === 'streaming'
	);
	let actionsDisabled = $derived(
		submitting || (hydrated && (roomPending || Object.keys(activeStreams).length > 0))
	);
	let awaitingTurn = $derived(data.awaitingTurn);
	let turnPending = $derived(
		awaitingTurn && (awaitingTurn.status === 'pending' || awaitingTurn.status === 'streaming')
	);
	let proceedDisabled = $derived(
		submitting ||
			!awaitingTurn ||
			(hydrated && (turnPending || Object.keys(activeStreams).length > 0))
	);
	let dmActive = $derived(submitting || Object.keys(activeStreams).length > 0);
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
			}
			submitting = false;
			selectedAction = '';
			await invalidateAll();
		};
	};

	const enhanceProceed: SubmitFunction = async ({ cancel }) => {
		if (proceedDisabled) {
			cancel();
			return;
		}
		submitting = true;
		selectedAction = 'Proceed Deeper';
		streamError = '';
		return async ({ result, update }) => {
			if (result.type !== 'success') {
				submitting = false;
				await update();
				return;
			}
			const payload = result.data as {
				success?: boolean;
				turnId?: null;
				roomEntryId?: string | null;
			};
			await invalidateAll();
			if (payload.success && payload.roomEntryId) {
				await consume({ kind: 'room', id: payload.roomEntryId });
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

	function resultText() {
		return awaitingTurn
			? (liveText[awaitingTurn.id] ?? awaitingTurn.narration)
			: 'The result could not be loaded.';
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

<svelte:head><title>Depth {data.room.number} | Dungeon of the Endless</title></svelte:head>
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
<div class:active={dmActive} class="dm-status-region" role="status" aria-live="polite">
	{#if dmActive}
		<div class="dm-status-toast">
			<span class="dm-orb" aria-hidden="true"></span>
			<div>
				<strong>{selectedAction || 'The chronicle is unfolding...'}</strong>
				<span>The Dungeon Master is writing.</span>
			</div>
		</div>
	{/if}
</div>
{#if data.status !== 'active'}
	<div class="alert alert-info play-alert" role="status">
		This expedition is {data.status}. Its chronicle remains available, but no further actions can be
		taken.
	</div>
{/if}

<div class="play-layout">
	<details class="card run-panel" aria-label="Run status and inventory" open>
		<summary>Run status and inventory</summary>
		<div class="run-panel-content">
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
				<div
					style={`width:${Math.max(0, (data.character.hp / data.character.maxHp) * 100)}%`}
				></div>
			</div>
			<div class="expedition-stat-groups" aria-label="Expedition attributes and skills">
				{#each attributeGroups as group}
					<div class="expedition-stat-group">
						<StatBreakdown
							breakdown={data.character.breakdowns.attributes[group.stat]}
							uid={`play-${group.stat}`}
						/>
						<div class="expedition-skills">
							{#each group.skills as skill}
								<StatBreakdown
									breakdown={data.character.breakdowns.skills[skill]}
									uid={`play-${skill}`}
								/>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<dl class="run-facts">
				<div>
					<dt class="sr-only">Defense</dt>
					<dd>
						<StatBreakdown breakdown={data.character.breakdowns.defense} uid="play-defense" />
					</dd>
				</div>
				<div>
					<dt class="sr-only">Attack</dt>
					<dd>
						<StatBreakdown
							breakdown={data.character.breakdowns.attack}
							uid="play-attack"
							prefix="+"
						/>
					</dd>
				</div>
				<div>
					<dt>Company gold</dt>
					<dd>{data.companyGold}</dd>
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
		</div>
	</details>

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
		{#if data.status === 'active' && data.phase === 'ready'}
			<section class="card action-card" aria-labelledby="choose-action">
				<div class="eyebrow">Your turn</div>
				<h2 id="choose-action">What does {data.character.name} do?</h2>
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
		{:else if data.status === 'active' && data.phase === 'awaiting_proceed'}
			<section class="card resolution-card" aria-labelledby="resolution-title">
				<div class="resolution-head">
					<div>
						<div class="eyebrow">Encounter resolved</div>
						<h2 id="resolution-title">The room falls behind you</h2>
					</div>
					{#if awaitingTurn}
						<span
							class="badge {awaitingTurn.outcome.result === 'failure' ||
							awaitingTurn.outcome.result === 'defeat'
								? 'red'
								: 'green'}"
						>
							{awaitingTurn.outcome.result}
						</span>
					{/if}
				</div>
				{#if awaitingTurn}
					<div class="resolution-action">
						<span>Your action</span>
						<strong>{awaitingTurn.action}</strong>
					</div>
					<div
						class:typing={activeStreams[awaitingTurn.id]}
						class="resolution-prose"
						aria-label="Resolved action narration"
					>
						{resultText()}
					</div>
					<div class="resolution-outcome">
						<div>
							<span>Outcome</span>
							<strong>{awaitingTurn.outcome.message}</strong>
						</div>
						<div>
							<span>Vitality</span>
							<strong>
								{awaitingTurn.outcome.hpBefore} -&gt; {awaitingTurn.outcome.hpAfter}
								({awaitingTurn.outcome.hpDelta >= 0 ? '+' : ''}{awaitingTurn.outcome.hpDelta})
							</strong>
						</div>
					</div>
					{#if awaitingTurn.rolls.length > 0}
						<div class="resolution-rolls" aria-label="Encounter rolls">
							{#each awaitingTurn.rolls as roll}
								<div class="terminal-roll {roll.success ? 'success' : 'failure'}">
									<span>{roll.label}</span>
									<code>
										[{roll.dice.join(', ')}] kept {roll.selected} + {roll.modifier} = {roll.total}
										vs {roll.target}
									</code>
									<b>{roll.success ? 'PASS' : 'FAIL'}</b>
								</div>
							{/each}
						</div>
					{/if}
					<form method="POST" action="?/proceed" class="proceed-form" use:enhance={enhanceProceed}>
						<input type="hidden" name="expectedVersion" value={data.expectedVersion} />
						<input type="hidden" name="commandKey" value={data.proceedKey} />
						<button type="submit" disabled={proceedDisabled}>Proceed Deeper</button>
					</form>
				{:else}
					<div class="alert alert-error" role="alert">
						The resolved turn is unavailable. Reload before proceeding.
					</div>
				{/if}
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
