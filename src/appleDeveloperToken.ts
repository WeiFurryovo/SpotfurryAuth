import { base64UrlEncode, importPkcs8Pem } from "./crypto";
import type { Env } from "./types";

const TOKEN_TTL_SECONDS = 60 * 60;
const TOKEN_REFRESH_SKEW_SECONDS = 60;

interface CachedDeveloperToken {
  cacheKey: string;
  token: string;
  expiresAt: number;
}

let cachedToken: CachedDeveloperToken | undefined;

export function hasAppleDeveloperConfig(env: Env): boolean {
  return Boolean(
    env.APPLE_TEAM_ID?.trim() &&
      env.APPLE_KEY_ID?.trim() &&
      env.APPLE_PRIVATE_KEY?.trim()
  );
}

export async function getAppleDeveloperToken(env: Env): Promise<{
  developerToken: string;
  expiresAt: number;
}> {
  const teamId = requiredSecret(env.APPLE_TEAM_ID, "APPLE_TEAM_ID");
  const keyId = requiredSecret(env.APPLE_KEY_ID, "APPLE_KEY_ID");
  const privateKeyPem = requiredSecret(env.APPLE_PRIVATE_KEY, "APPLE_PRIVATE_KEY");
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = `${teamId}:${keyId}`;

  if (
    cachedToken?.cacheKey === cacheKey &&
    cachedToken.expiresAt - TOKEN_REFRESH_SKEW_SECONDS > now
  ) {
    return {
      developerToken: cachedToken.token,
      expiresAt: cachedToken.expiresAt
    };
  }

  const expiresAt = now + TOKEN_TTL_SECONDS;
  const header = {
    alg: "ES256",
    kid: keyId,
    typ: "JWT"
  };
  const payload = {
    iss: teamId,
    iat: now,
    exp: expiresAt
  };
  const signingInput =
    `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const privateKey = await importPkcs8Pem(privateKeyPem);
  const signature =
    await crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: "SHA-256"
      },
      privateKey,
      new TextEncoder().encode(signingInput)
    );
  const token = `${signingInput}.${base64UrlEncode(signature)}`;

  cachedToken = {
    cacheKey,
    token,
    expiresAt
  };

  return {
    developerToken: token,
    expiresAt
  };
}

function requiredSecret(
  value: string | undefined,
  name: string
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is not configured`);
  }

  return trimmed;
}
