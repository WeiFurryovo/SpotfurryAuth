export interface Env {
  PAIRING_SESSION: DurableObjectNamespace;
  PUBLIC_BASE_URL?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  MUSICKIT_TOKEN_PROVIDER_URL?: string;
  MUSICKIT_TOKEN_PROVIDER_AUTHORIZATION?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  SPOTIFY_REDIRECT_URI?: string;
  SPOTIFY_SCOPES?: string;
}

export type PairingStatus = "pending" | "authorized" | "consumed" | "expired";

export interface PairingSessionRecord {
  sessionId: string;
  code: string;
  phoneSecretHash: string;
  watchSecretHash: string;
  status: PairingStatus;
  createdAt: number;
  expiresAt: number;
  musicUserToken?: string;
  oauthStateHash?: string;
  authorizedPayload?: Record<string, unknown>;
}

export interface StartPairingInput {
  sessionId: string;
  code: string;
  phoneSecret: string;
  watchSecret: string;
  createdAt: number;
  expiresAt: number;
}

export interface StartPairingResponse {
  sessionId: string;
  watchSecret: string;
  code: string;
  pairUrl: string;
  expiresAt: number;
  pollAfterMs: number;
}

export interface CompletePairingInput {
  sessionId: string;
  phoneSecret: string;
  musicUserToken: string;
}

export interface PrepareOAuthPairingInput {
  phoneSecret: string;
  stateSecret: string;
}

export interface CompleteOAuthPairingInput {
  stateSecret: string;
  authorizedPayload: Record<string, unknown>;
}
