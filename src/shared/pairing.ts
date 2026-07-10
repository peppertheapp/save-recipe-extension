import { BACKEND_ENABLED } from './config';
import { resolveBaseUrl } from './api';

/**
 * QR pairing (v2 auth): the popup shows a QR encoding a one-time pairing code;
 * the Pepper app scans it and claims the code against the backend; the popup
 * polls until the code is linked and stores the account. Full protocol spec
 * for the app/backend teams: docs/PAIRING.md.
 *
 * While BACKEND_ENABLED is false the QR renders and refreshes, but polling is
 * inert — manual secret-code entry remains the working path.
 */

/** Where the QR points. A universal link so phone cameras open the Pepper app. */
const PAIR_LINK_BASE = 'https://peppertheapp.com/pair';

/** Codes rotate before a (future) server-side TTL would expire them. */
export const PAIRING_CODE_ROTATE_MS = 4 * 60_000;
export const PAIRING_POLL_INTERVAL_MS = 2_000;

/** Unambiguous alphabet (no 0/O/1/l/I) — ~117 bits at 20 chars. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generatePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** The code travels in the fragment so it never reaches web-server logs. */
export function pairingUrl(code: string): string {
  return `${PAIR_LINK_BASE}#v=1&code=${code}`;
}

export interface PairingStatus {
  linked: boolean;
  userId?: string;
  displayName?: string;
}

/** GET /v1/extension/pair/status — inert until the backend ships. */
export async function checkPairingStatus(code: string, apiBaseUrl = ''): Promise<PairingStatus> {
  if (!BACKEND_ENABLED) return { linked: false };
  try {
    const res = await fetch(
      `${resolveBaseUrl(apiBaseUrl)}/v1/extension/pair/status?code=${encodeURIComponent(code)}`,
    );
    if (!res.ok) return { linked: false };
    const body = (await res.json().catch(() => null)) as PairingStatus | null;
    return body?.linked ? body : { linked: false };
  } catch {
    return { linked: false };
  }
}
