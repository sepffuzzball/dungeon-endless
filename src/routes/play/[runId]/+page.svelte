<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Depth {data.room.number} | Dungeon Endless</title></svelte:head>
<header class="page-header">
	<div>
		<div class="eyebrow">{data.characterName} / {data.status} expedition</div>
		<h1 style="font-size:clamp(2rem,4vw,3.4rem)">Depth {data.room.number}</h1>
	</div>
	<div class="actions">
		<a class="btn btn-secondary" href="/characters">Leave table</a>
		{#if data.status === 'active'}
			<form method="POST" action="?/abandon">
				<button class="btn-danger" type="submit">Abandon run</button>
			</form>
		{/if}
	</div>
</header>
{#if form?.error}
	<div class="alert alert-error" role="alert" style="margin-bottom:1rem">{form.error}</div>
{/if}
{#if data.status !== 'active'}
	<div class="alert alert-info" role="status" style="margin-bottom:1rem">
		This expedition is {data.status}. Its chronicle remains available, but no further actions can be
		taken.
	</div>
{/if}
<div class="play-layout">
	<aside class="card run-panel" aria-label="Run status">
		<div class="eyebrow">Wayfarer</div>
		<h2>{data.character.name}</h2>
		<div class="text-muted">
			{data.character.title} / Level {data.character.level}
			{data.character.className}
		</div>
		<hr class="divider" />
		<div class="card-head">
			<strong>Vitality</strong><span>{data.character.hp} / {data.character.maxHp}</span>
		</div>
		<div class="hp-bar" aria-label={`Health ${data.character.hp} of ${data.character.maxHp}`}>
			<div style={`width:${Math.max(0, (data.character.hp / data.character.maxHp) * 100)}%`}></div>
		</div>
		<hr class="divider" />
		<div class="mini-stats">
			<span><small>Body</small>{data.character.body}</span><span
				><small>Mind</small>{data.character.mind}</span
			><span><small>Spirit</small>{data.character.spirit}</span>
		</div>
		<ul class="list-plain" style="margin-top:1rem">
			<li>
				<span class="text-muted">Defense</span><strong style="float:right"
					>{data.character.defense}</strong
				>
			</li>
			<li>
				<span class="text-muted">Attack</span><strong style="float:right"
					>+{data.character.attackBonus}</strong
				>
			</li>
			<li>
				<span class="text-muted">Banked gold</span><strong style="float:right"
					>{data.character.gold}</strong
				>
			</li>
			<li>
				<span class="text-muted">Carried items</span><strong style="float:right"
					>{data.inventory.length}</strong
				>
			</li>
		</ul>
	</aside>
	<main class="stack">
		<article class="card room-card">
			<div class="card-head">
				<span class="badge red">{data.room.kind}</span><span class="eyebrow"
					>Room {data.room.number}</span
				>
			</div>
			<h2>{data.room.title}</h2>
			<div class="prose-block">{data.room.prose}</div>
		</article>
		{#if data.status === 'active'}
			<section class="card" aria-labelledby="choose-action">
				<div class="eyebrow">Your turn</div>
				<h2 id="choose-action">What does {data.character.name} do?</h2>
				<div class="action-grid">
					{#each data.suggestions as suggestion, index (data.actionKeys[index])}
						<form method="POST" action="?/act">
							<input type="hidden" name="actionText" value={suggestion.typed} />
							<input type="hidden" name="expectedVersion" value={data.expectedVersion} />
							<input type="hidden" name="actionKey" value={data.actionKeys[index]} />
							<button type="submit" title={suggestion.detail}>{suggestion.label}</button>
						</form>
					{/each}
				</div>
				<form method="POST" action="?/act" class="composer">
					<label for="action-text" style="position:absolute;left:-9999px"
						>Describe another action</label
					>
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
					/>
					<button type="submit">Attempt</button>
				</form>
			</section>
		{:else if data.summary}
			<section class="card" aria-labelledby="last-echo">
				<div class="eyebrow">Final echo</div>
				<h2 id="last-echo">The descent is ended</h2>
				<p class="text-dim">{data.summary}</p>
			</section>
		{/if}
	</main>
	<aside class="card turn-column" aria-label="Turn chronicle">
		<div class="eyebrow">Recent echoes</div>
		<h2>The chronicle</h2>
		{#if data.turns.length === 0}
			<p class="text-muted">No deeds have been recorded yet.</p>
		{/if}
		{#each data.turns.slice().reverse() as turn (turn.id)}
			<article class="turn-entry">
				<div class="turn-meta">Turn {turn.turn} / {turn.actor}</div>
				<h3>{turn.action}</h3>
				<p class="text-dim">{turn.narration}</p>
				{#if turn.roll}
					{@const roll = turn.roll}
					<article
						class="roll {roll.success ? 'success' : 'failure'}"
						aria-label="Dice roll result"
					>
						<header class="roll-head">
							<strong>{roll.label}</strong>
							<span class="badge {roll.success ? 'green' : 'red'}"
								>{roll.success ? 'Success' : 'Failure'}</span
							>
						</header>
						<div class="dice-row" aria-label={`Dice rolled: ${roll.dice.join(', ')}`}>
							{#each roll.dice as die, index}
								<span
									class:selected={index ===
										(roll.selectedIndex ?? roll.dice.indexOf(roll.selected))}>{die}</span
								>
							{/each}
						</div>
						<div class="roll-equation">
							<span><small>Kept</small>{roll.selected}</span><b>+</b><span
								><small>Modifier</small>{roll.modifier}</span
							><b>=</b><span class="total"><small>Total</small>{roll.total}</span><b>/</b><span
								><small>Target</small>{roll.target}</span
							>
						</div>
						<div class="text-muted">
							Selected die {roll.selectedIndex === undefined ? 'recorded' : roll.selectedIndex + 1};
							net advantage {roll.advantage > 0 ? '+' : ''}{roll.advantage}.
						</div>
					</article>
				{/if}
			</article>
		{/each}
	</aside>
</div>
