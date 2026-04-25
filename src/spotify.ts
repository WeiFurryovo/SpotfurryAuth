import { HttpError } from "./http";
import type { Env } from "./types";

const SPOTIFY_AUTHORIZE_ENDPOINT = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";

export const SPOTIFY_DEFAULT_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state"
] as const;

export interface SpotifyAuthorizedPayload {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
}

interface SpotifyTokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  refresh_token?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export function hasSpotifyOAuthConfig(
  env: Pick<Env, "SPOTIFY_CLIENT_ID" | "SPOTIFY_CLIENT_SECRET">
): boolean {
  return Boolean(env.SPOTIFY_CLIENT_ID?.trim() && env.SPOTIFY_CLIENT_SECRET?.trim());
}

export function getSpotifyScopes(
  env: Pick<Env, "SPOTIFY_SCOPES">
): string[] {
  const configured = env.SPOTIFY_SCOPES?.trim();
  if (!configured) {
    return [...SPOTIFY_DEFAULT_SCOPES];
  }

  return configured
    .split(/\s+/u)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function createSpotifyOAuthState(
  sessionId: string,
  stateSecret: string
): string {
  if (!sessionId.trim() || !stateSecret.trim()) {
    throw new HttpError(400, "Missing Spotify OAuth state");
  }

  return `${sessionId}.${stateSecret}`;
}

export function parseSpotifyOAuthState(
  state: string
): { sessionId: string; stateSecret: string } | undefined {
  const parts = state.split(".");
  if (parts.length !== 2) {
    return undefined;
  }

  const [sessionId, stateSecret] = parts;
  if (!sessionId?.trim() || !stateSecret?.trim()) {
    return undefined;
  }

  return { sessionId, stateSecret };
}

export function createSpotifyAuthorizeUrl(params: {
  env: Env;
  publicBaseUrl: string;
  state: string;
}): string {
  const clientId = requiredSpotifySecret(
    params.env.SPOTIFY_CLIENT_ID,
    "SPOTIFY_CLIENT_ID"
  );
  const url = new URL(SPOTIFY_AUTHORIZE_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", getSpotifyScopes(params.env).join(" "));
  url.searchParams.set(
    "redirect_uri",
    resolveSpotifyRedirectUri(params.env, params.publicBaseUrl)
  );
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeSpotifyCodeForToken(params: {
  env: Env;
  publicBaseUrl: string;
  code: string;
}): Promise<SpotifyAuthorizedPayload> {
  const clientId = requiredSpotifySecret(
    params.env.SPOTIFY_CLIENT_ID,
    "SPOTIFY_CLIENT_ID"
  );
  const clientSecret = requiredSpotifySecret(
    params.env.SPOTIFY_CLIENT_SECRET,
    "SPOTIFY_CLIENT_SECRET"
  );
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: resolveSpotifyRedirectUri(params.env, params.publicBaseUrl)
  });
  const response = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Basic ${base64Encode(`${clientId}:${clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await readSpotifyTokenResponse(response);

  if (!response.ok) {
    throw new HttpError(
      502,
      `Spotify token exchange failed: ${formatSpotifyError(payload)}`
    );
  }

  return toSpotifyAuthorizedPayload(payload);
}

export function resolveSpotifyRedirectUri(
  env: Pick<Env, "SPOTIFY_REDIRECT_URI">,
  publicBaseUrl: string
): string {
  const configured = env.SPOTIFY_REDIRECT_URI?.trim();
  if (configured) {
    return configured;
  }

  return new URL("/spotify/callback", publicBaseUrl).toString();
}

export function toSpotifyAuthorizedPayload(
  payload: SpotifyTokenResponse
): SpotifyAuthorizedPayload {
  if (typeof payload.access_token !== "string" || !payload.access_token.trim()) {
    throw new HttpError(502, "Spotify token response did not include access_token");
  }

  return {
    accessToken: payload.access_token.trim(),
    expiresIn: normalizeExpiresIn(payload.expires_in),
    tokenType:
      typeof payload.token_type === "string" && payload.token_type.trim() ?
        payload.token_type.trim() :
        "Bearer",
    scope:
      typeof payload.scope === "string" ?
        payload.scope.trim() :
        ""
  };
}

function requiredSpotifySecret(
  value: string | undefined,
  name: string
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new HttpError(503, `${name} is not configured`);
  }

  return normalized;
}

async function readSpotifyTokenResponse(
  response: Response
): Promise<SpotifyTokenResponse> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as SpotifyTokenResponse;
  } catch {
    return {
      error: "invalid_response",
      error_description: text.slice(0, 240)
    };
  }
}

function formatSpotifyError(payload: SpotifyTokenResponse): string {
  const error =
    typeof payload.error === "string" && payload.error.trim() ?
      payload.error.trim() :
      "unknown_error";
  const description =
    typeof payload.error_description === "string" && payload.error_description.trim() ?
      payload.error_description.trim() :
      "";

  return description ? `${error}: ${description}` : error;
}

function normalizeExpiresIn(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3600;
  }

  return Math.max(1, Math.floor(value));
}

function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
