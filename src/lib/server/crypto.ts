import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config';

// The encryption key is derived once at startup and never logged.
const KEY: Buffer = deriveEncryptionKey(config.APP_ENCRYPTION_KEY);

function deriveEncryptionKey(raw: string): Buffer {
	if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
	if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
		const decoded = Buffer.from(raw, 'base64');
		if (decoded.length === 32 && decoded.toString('base64') === raw) return decoded;
	}
	throw new Error('APP_ENCRYPTION_KEY must be exactly 64 hex characters or 32 bytes in base64');
}

/** Encrypts a plaintext secret (e.g. an LLM API key) with AES-256-GCM. */
export function encryptEndpointKey(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', KEY, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** Decrypts a payload produced by {@link encryptEndpointKey}. */
export function decryptEndpointKey(payload: string): string {
	const buf = Buffer.from(payload, 'base64');
	if (buf.length < 28) {
		throw new Error('Invalid encrypted payload');
	}
	const iv = buf.subarray(0, 12);
	const tag = buf.subarray(12, 28);
	const data = buf.subarray(28);
	const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** SHA-256 hex digest, used for session tokens and password-bearing digests. */
export function sha256Hex(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

/** Cryptographically random URL-safe token. */
export function randomUrlToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}
