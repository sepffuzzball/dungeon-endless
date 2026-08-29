import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { config } from './config';

export const loginSchema = z.object({
	username: z.string().min(1).max(64),
	password: z.string().min(1).max(256)
});

/** Lower-cases and trims usernames so lookups are case-insensitive. */
export function normalizeUsername(value: string): string {
	return value.trim().toLowerCase();
}

function isPrivateV4(address: string): boolean {
	const parts = address.split('.').map((part) => Number.parseInt(part, 10));
	const [a, b, c] = parts;
	if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
		return true;
	}
	if (a === 0) return true; // unspecified/current network
	if (a === 10) return true; // 10.0.0.0/8
	if (a === 127) return true; // 127.0.0.0/8 loopback
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
	if (a === 192 && b === 168) return true; // 192.168.0.0/16
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 shared
	if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
	if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
	if (a >= 224) return true; // multicast and reserved
	return false;
}

function normalizeIpHostname(hostname: string): string {
	return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function ipv6Bytes(address: string): number[] | null {
	let value = address.toLowerCase();
	const mappedV4 = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
	if (mappedV4) {
		if (isIP(mappedV4[2]) !== 4) return null;
		const octets = mappedV4[2].split('.').map(Number);
		value = `${mappedV4[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
	}
	const halves = value.split('::');
	if (halves.length > 2) return null;
	const left = halves[0] ? halves[0].split(':') : [];
	const right = halves[1] ? halves[1].split(':') : [];
	const missing = 8 - left.length - right.length;
	if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
	const groups = [...left, ...Array(missing).fill('0'), ...right];
	if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
	return groups.flatMap((part) => {
		const group = Number.parseInt(part, 16);
		return [group >> 8, group & 0xff];
	});
}

function isPrivateV6(address: string): boolean {
	const bytes = ipv6Bytes(address);
	if (!bytes) return true;
	if (bytes.slice(0, 15).every((byte) => byte === 0) && (bytes[15] === 0 || bytes[15] === 1)) {
		return true; // unspecified or loopback
	}
	if (bytes[0] === 0xff) return true; // multicast
	if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // link-local
	if ((bytes[0] & 0xfe) === 0xfc) return true; // unique-local
	if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
		return isPrivateV4(bytes.slice(12).join('.')); // IPv4-mapped IPv6
	}
	return false;
}

/** True for literal private, loopback, link-local or unspecified IP hostnames. */
export function isPrivateOrLoopback(hostname: string): boolean {
	const normalized = normalizeIpHostname(hostname);
	const family = isIP(normalized);
	if (family === 4) return isPrivateV4(normalized);
	if (family === 6) return isPrivateV6(normalized);
	return false;
}

/**
 * Validates an LLM endpoint base URL against the SSRF policy.
 * - Only http(s) URLs are accepted.
 * - Plain http requires ALLOW_INSECURE_LLM_URLS.
 * - Literal private/loopback/link-local IP hosts require ALLOW_PRIVATE_LLM_URLS.
 *
 */
export function validateLlmUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Endpoint URL is not a valid URL');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Endpoint URL must use http or https');
	}
	if (url.username || url.password) throw new Error('Endpoint URL must not contain credentials');
	if (url.protocol === 'http:' && !config.ALLOW_INSECURE_LLM_URLS) {
		throw new Error(
			'Plain http endpoints are disallowed; use https or set ALLOW_INSECURE_LLM_URLS'
		);
	}
	if (!config.ALLOW_PRIVATE_LLM_URLS && isPrivateOrLoopback(url.hostname)) {
		throw new Error(
			'Private, loopback or link-local endpoint hosts are disallowed; set ALLOW_PRIVATE_LLM_URLS'
		);
	}
	return url;
}

/** Resolves every advertised address and rejects the URL if any result violates the SSRF policy. */
export async function validateResolvedLlmUrl(raw: string): Promise<URL> {
	const url = validateLlmUrl(raw);
	if (config.ALLOW_PRIVATE_LLM_URLS) return url;
	const hostname = normalizeIpHostname(url.hostname);
	if (isIP(hostname)) return url;
	let addresses: Array<{ address: string; family: number }>;
	try {
		addresses = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		throw new Error('Endpoint hostname could not be resolved');
	}
	if (addresses.length === 0 || addresses.some(({ address }) => isPrivateOrLoopback(address))) {
		throw new Error('Endpoint hostname resolves to a disallowed network address');
	}
	return url;
}
