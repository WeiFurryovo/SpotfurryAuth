import { randomBase64Url } from "./crypto";
import type { StartPairingInput } from "./types";

const READABLE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const POLL_AFTER_MS = 2 * 1000;

export function createPairingSession(
  now: number = Date.now()
): StartPairingInput {
  return {
    sessionId: randomBase64Url(18),
    code: createReadableCode(),
    phoneSecret: randomBase64Url(32),
    watchSecret: randomBase64Url(32),
    createdAt: now,
    expiresAt: now + PAIRING_TTL_MS
  };
}

export function createPairUrl(
  baseUrl: string,
  session: Pick<StartPairingInput, "sessionId" | "phoneSecret" | "code">
): string {
  const url = new URL("/apple-music/pair", normalizeBaseUrl(baseUrl));
  url.searchParams.set("s", session.sessionId);
  url.searchParams.set("p", session.phoneSecret);
  url.searchParams.set("code", session.code);
  return url.toString();
}

export function resolvePublicBaseUrl(
  configuredBaseUrl: string | undefined,
  request: Request
): string {
  const configured = configuredBaseUrl?.trim();
  if (configured) {
    return normalizeBaseUrl(configured);
  }

  return new URL(request.url).origin;
}

export function isExpired(
  expiresAt: number,
  now: number = Date.now()
): boolean {
  return expiresAt <= now;
}

function createReadableCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const rawCode =
    [...bytes]
      .map((byte) => READABLE_CODE_ALPHABET[byte % READABLE_CODE_ALPHABET.length])
      .join("");

  return `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}
