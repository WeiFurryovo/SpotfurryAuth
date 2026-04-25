import { base64UrlEncode, importPkcs8Pem } from "./crypto";
import type { Env } from "./types";

const TOKEN_TTL_SECONDS = 60 * 60;
const TOKEN_REFRESH_SKEW_SECONDS = 60;

interface CachedDeveloperToken {
  cacheKey: string;
  source: DeveloperTokenSource;
  token: string;
  expiresAt: number;
}

let cachedToken: CachedDeveloperToken | undefined;

export type DeveloperTokenSource = "apple-secrets" | "external-provider";

export interface DeveloperTokenResult {
  developerToken: string;
  expiresAt: number;
  source: DeveloperTokenSource;
}

export function hasAppleDeveloperConfig(env: Env): boolean {
  return Boolean(
    env.APPLE_TEAM_ID?.trim() &&
      env.APPLE_KEY_ID?.trim() &&
      env.APPLE_PRIVATE_KEY?.trim()
  );
}

export function hasExternalDeveloperTokenProvider(env: Env): boolean {
  return Boolean(env.MUSICKIT_TOKEN_PROVIDER_URL?.trim());
}

export function hasDeveloperTokenSource(env: Env): boolean {
  return hasAppleDeveloperConfig(env) || hasExternalDeveloperTokenProvider(env);
}

export function getDeveloperTokenSource(env: Env): DeveloperTokenSource | undefined {
  if (hasAppleDeveloperConfig(env)) {
    return "apple-secrets";
  }

  if (hasExternalDeveloperTokenProvider(env)) {
    return "external-provider";
  }

  return undefined;
}

export async function getAppleDeveloperToken(env: Env): Promise<DeveloperTokenResult> {
  if (hasAppleDeveloperConfig(env)) {
    return getSignedAppleDeveloperToken(env);
  }

  if (hasExternalDeveloperTokenProvider(env)) {
    return getExternalDeveloperToken(env);
  }

  throw new Error("No Apple Music developer token source is configured");
}

async function getSignedAppleDeveloperToken(env: Env): Promise<DeveloperTokenResult> {
  const teamId = requiredSecret(env.APPLE_TEAM_ID, "APPLE_TEAM_ID");
  const keyId = requiredSecret(env.APPLE_KEY_ID, "APPLE_KEY_ID");
  const privateKeyPem = requiredSecret(env.APPLE_PRIVATE_KEY, "APPLE_PRIVATE_KEY");
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = `${teamId}:${keyId}`;

  if (
    cachedToken?.cacheKey === cacheKey &&
    cachedToken.source === "apple-secrets" &&
    cachedToken.expiresAt - TOKEN_REFRESH_SKEW_SECONDS > now
  ) {
    return {
      developerToken: cachedToken.token,
      expiresAt: cachedToken.expiresAt,
      source: cachedToken.source
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
    source: "apple-secrets",
    token,
    expiresAt
  };

  return {
    developerToken: token,
    expiresAt,
    source: "apple-secrets"
  };
}

async function getExternalDeveloperToken(env: Env): Promise<DeveloperTokenResult> {
  const providerUrl = requiredSecret(
    env.MUSICKIT_TOKEN_PROVIDER_URL,
    "MUSICKIT_TOKEN_PROVIDER_URL"
  );
  const authorization = env.MUSICKIT_TOKEN_PROVIDER_AUTHORIZATION?.trim();
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = `external:${providerUrl}:${authorization ?? ""}`;

  if (
    cachedToken?.cacheKey === cacheKey &&
    cachedToken.source === "external-provider" &&
    cachedToken.expiresAt - TOKEN_REFRESH_SKEW_SECONDS > now
  ) {
    return {
      developerToken: cachedToken.token,
      expiresAt: cachedToken.expiresAt,
      source: cachedToken.source
    };
  }

  const headers = new Headers({
    accept: "application/json, text/plain;q=0.9"
  });
  if (authorization) {
    headers.set("authorization", authorization);
  }

  const response =
    await fetch(providerUrl, {
      method: "GET",
      headers
    });
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(
      `External MusicKit token provider failed with HTTP ${response.status}: ${bodyText}`
    );
  }

  const providerPayload = parseProviderPayload(bodyText);
  const token =
    extractString(providerPayload, [
      "developerToken",
      "token",
      "musicKitToken",
      "musicKitDeveloperToken",
      "data.developerToken",
      "data.token"
    ]) ?? bodyText.trim();

  if (!looksLikeJwt(token)) {
    throw new Error("External MusicKit token provider did not return a JWT token");
  }

  const expiresAt =
    extractNumber(providerPayload, [
      "expiresAt",
      "expires_at",
      "expires",
      "data.expiresAt",
      "data.expires_at"
    ]) ??
    readJwtExpiry(token) ??
    now + EXTERNAL_TOKEN_FALLBACK_TTL_SECONDS;

  cachedToken = {
    cacheKey,
    source: "external-provider",
    token,
    expiresAt
  };

  return {
    developerToken: token,
    expiresAt,
    source: "external-provider"
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

function parseProviderPayload(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}

function extractString(
  payload: unknown,
  paths: string[]
): string | undefined {
  for (const path of paths) {
    const value = readPath(payload, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function extractNumber(
  payload: unknown,
  paths: string[]
): number | undefined {
  for (const path of paths) {
    const value = readPath(payload, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return normalizeEpochSeconds(value);
    }

    if (typeof value === "string" && value.trim()) {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        return normalizeEpochSeconds(numericValue);
      }
    }
  }

  return undefined;
}

function readPath(
  payload: unknown,
  path: string
): unknown {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  return path
    .split(".")
    .reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      return (current as Record<string, unknown>)[key];
    }, payload);
}

function looksLikeJwt(value: string): boolean {
  return value.split(".").length === 3;
}

function readJwtExpiry(token: string): number | undefined {
  const [, payload] = token.split(".");
  if (!payload) {
    return undefined;
  }

  try {
    const normalizedPayload = payload.replace(/-/gu, "+").replace(/_/gu, "/");
    const decodedPayload = JSON.parse(atob(normalizedPayload)) as Record<string, unknown>;
    const exp = decodedPayload.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}

function normalizeEpochSeconds(value: number): number {
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

const EXTERNAL_TOKEN_FALLBACK_TTL_SECONDS = 10 * 60;
