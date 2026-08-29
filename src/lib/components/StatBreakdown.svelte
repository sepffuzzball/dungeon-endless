<script lang="ts">
	import type { StatBreakdown } from '$lib/types';
	import { onMount } from 'svelte';

	let {
		breakdown,
		uid,
		prefix = ''
	}: { breakdown: StatBreakdown; uid: string; prefix?: string } = $props();
	let open = $state(false);
	let trigger: HTMLButtonElement;
	let popover: HTMLElement;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	let pointerType: string | undefined;
	let suppressPointerFocus = false;
	let wasOpenOnPointerDown = false;
	let id = $derived(`stat-breakdown-${uid}`);

	function place() {
		if (!trigger || !popover) return;
		const margin = 12;
		const gap = 8;
		const rect = trigger.getBoundingClientRect();
		const width = Math.min(360, window.innerWidth - margin * 2);
		popover.style.width = `${width}px`;
		popover.style.maxHeight = `${window.innerHeight - margin * 2}px`;

		const height = popover.offsetHeight;
		const roomBelow = window.innerHeight - margin - rect.bottom - gap;
		const roomAbove = rect.top - margin - gap;
		const placeBelow = height <= roomBelow || roomBelow >= roomAbove;
		const preferredTop = placeBelow ? rect.bottom + gap : rect.top - gap - height;
		const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
		const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin));
		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;
	}

	function show() {
		clearTimeout(closeTimer);
		if (!popover?.matches(':popover-open')) popover?.showPopover();
		requestAnimationFrame(place);
	}

	function scheduleClose() {
		clearTimeout(closeTimer);
		closeTimer = setTimeout(() => {
			if (!popover?.matches(':hover') && document.activeElement !== trigger) popover?.hidePopover();
		}, 100);
	}

	function handlePointerDown(event: PointerEvent) {
		pointerType = event.pointerType;
		suppressPointerFocus = pointerType === 'touch' || pointerType === 'pen';
		wasOpenOnPointerDown = popover?.matches(':popover-open') ?? false;
	}

	function handleClick(event: MouseEvent) {
		if (pointerType === 'touch' || pointerType === 'pen') {
			if (wasOpenOnPointerDown) popover.hidePopover();
			else show();
		} else if (pointerType === 'mouse') {
			show();
		} else if (event.detail === 0) {
			if (popover.matches(':popover-open')) popover.hidePopover();
			else show();
		} else {
			show();
		}

		queueMicrotask(() => {
			pointerType = undefined;
			suppressPointerFocus = false;
		});
	}

	function handleFocus() {
		if (!suppressPointerFocus) show();
	}

	function handlePointerEnter(event: PointerEvent) {
		if (
			event.pointerType === 'mouse' &&
			window.matchMedia('(hover: hover) and (pointer: fine)').matches
		) {
			show();
		}
	}

	function handlePointerLeave(event: PointerEvent) {
		if (
			event.pointerType === 'mouse' &&
			window.matchMedia('(hover: hover) and (pointer: fine)').matches
		) {
			scheduleClose();
		}
	}

	onMount(() => {
		const reposition = () => {
			if (popover?.matches(':popover-open')) place();
		};
		window.addEventListener('resize', reposition);
		window.addEventListener('scroll', reposition, true);
		return () => {
			window.removeEventListener('resize', reposition);
			window.removeEventListener('scroll', reposition, true);
		};
	});
</script>

<span class="stat-breakdown">
	<button
		bind:this={trigger}
		type="button"
		class="stat-breakdown-trigger"
		aria-expanded={open}
		aria-controls={id}
		aria-describedby={open ? id : undefined}
		onclick={handleClick}
		onpointerdown={handlePointerDown}
		onpointercancel={() => {
			pointerType = undefined;
			suppressPointerFocus = false;
		}}
		onfocus={handleFocus}
		onblur={scheduleClose}
		onpointerenter={handlePointerEnter}
		onpointerleave={handlePointerLeave}
	>
		<span class="stat-breakdown-label">{breakdown.label}</span>
		<strong>{prefix}{breakdown.total}</strong>
	</button>
	<div
		bind:this={popover}
		{id}
		class="stat-breakdown-popover"
		popover="auto"
		role="tooltip"
		onpointerenter={handlePointerEnter}
		onpointerleave={handlePointerLeave}
		ontoggle={(event) => (open = (event as ToggleEvent).newState === 'open')}
	>
		<strong>{breakdown.label} breakdown</strong>
		<p>
			{#each breakdown.parts as part, index}
				<span>{part.label} <b>{Math.abs(part.value)}</b></span
				>{#if index < breakdown.parts.length - 1}
					<i>{breakdown.parts[index + 1].value < 0 ? '-' : '+'}</i>
				{/if}
			{/each}
			<i>=</i> <span class="stat-breakdown-total">{breakdown.total}</span>
		</p>
		{#if breakdown.formula}<small>{breakdown.formula}</small>{/if}
	</div>
</span>

<style>
	.stat-breakdown {
		display: block;
		min-width: 0;
	}
	.stat-breakdown-trigger {
		width: 100%;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.35rem;
		align-items: baseline;
		padding: 0.3rem 0.4rem;
		border: 1px solid transparent;
		border-radius: 7px;
		background: transparent;
		box-shadow: none;
		color: var(--parchment);
		font-family: inherit;
		font-size: 0.75rem;
		letter-spacing: 0;
		text-align: left;
	}
	.stat-breakdown-trigger:hover,
	.stat-breakdown-trigger[aria-expanded='true'] {
		border-color: var(--line);
		background: rgba(217, 169, 94, 0.08);
		color: var(--parchment);
		filter: none;
	}
	.stat-breakdown-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.stat-breakdown-trigger strong {
		color: var(--amber);
		font-size: 0.9rem;
	}
	.stat-breakdown-popover {
		display: none;
		position: fixed;
		inset: auto;
		box-sizing: border-box;
		max-width: calc(100vw - 24px);
		max-height: calc(100vh - 24px);
		overflow-y: auto;
		margin: 0;
		padding: 0.85rem;
		border: 1px solid rgba(217, 169, 94, 0.42);
		border-radius: 10px;
		background: #111923;
		color: var(--parchment);
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
		font-size: 0.78rem;
		line-height: 1.45;
	}
	.stat-breakdown-popover:popover-open {
		display: block;
	}
	.stat-breakdown-popover::backdrop {
		background: transparent;
	}
	.stat-breakdown-popover > strong {
		display: block;
		margin-bottom: 0.45rem;
		color: var(--amber);
	}
	.stat-breakdown-popover p {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.35rem;
		align-items: baseline;
		margin: 0;
	}
	.stat-breakdown-popover p span {
		white-space: nowrap;
	}
	.stat-breakdown-popover i {
		color: var(--muted);
		font-style: normal;
	}
	.stat-breakdown-total {
		color: var(--amber);
		font-weight: 700;
	}
	.stat-breakdown-popover small {
		display: block;
		margin-top: 0.5rem;
		color: var(--muted);
	}
</style>
