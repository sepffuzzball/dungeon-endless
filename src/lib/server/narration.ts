export type NarrationEventName = 'snapshot' | 'chunk' | 'done' | 'error';

/** Formats one safe SSE event. JSON encoding prevents embedded newlines from changing fields. */
export function formatSseEvent(event: NarrationEventName, payload: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function formatSseComment(comment = 'keepalive'): string {
	return `: ${comment.replace(/[\r\n]/g, ' ')}\n\n`;
}

/** Returns only durable text not yet sent to a follower, including reset snapshots after repair. */
export function persistedSuffix(
	previous: string,
	persisted: string
): {
	text: string;
	reset: boolean;
} {
	if (persisted.startsWith(previous))
		return { text: persisted.slice(previous.length), reset: false };
	return { text: persisted, reset: true };
}

/** True only when an in-progress narration no longer has a live producer lease. */
export function isNarrationLeaseStale(
	status: string,
	updatedAt: Date | null,
	now: Date,
	leaseMs = 30_000
): boolean {
	return status === 'streaming' && (!updatedAt || updatedAt.getTime() < now.getTime() - leaseMs);
}
