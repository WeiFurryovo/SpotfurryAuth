import { describe, expect, it } from "vitest";
import {
  createSpotifyAuthorizeUrl,
  createSpotifyOAuthState,
  getSpotifyScopes,
  parseSpotifyOAuthState,
  resolveSpotifyRedirectUri,
  toSpotifyAuthorizedPayload
} from "../src/spotify";
import type { Env } from "../src/types";

const env = {
  SPOTIFY_CLIENT_ID: "client-id",
  SPOTIFY_CLIENT_SECRET: "client-secret"
} as Env;

describe("Spotify OAuth helpers", () => {
  it("uses the Web Playback scopes by default", () => {
    expect(getSpotifyScopes({})).toEqual([
      "streaming",
      "user-read-email",
      "user-read-private",
      "user-modify-playback-state",
      "user-read-playback-state"
    ]);
  });

  it("creates and parses OAuth state without embedding the phone secret", () => {
    const state = createSpotifyOAuthState("session-id", "state-secret");

    expect(state).toBe("session-id.state-secret");
    expect(state).not.toContain("phone-secret");
    expect(parseSpotifyOAuthState(state)).toEqual({
      sessionId: "session-id",
      stateSecret: "state-secret"
    });
    expect(parseSpotifyOAuthState("bad-state")).toBeUndefined();
  });

  it("builds the Spotify authorize URL with callback and scopes", () => {
    const url = new URL(
      createSpotifyAuthorizeUrl({
        env,
        publicBaseUrl: "https://auth.example.com",
        state: "session.state"
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.spotify.com/authorize"
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://auth.example.com/spotify/callback"
    );
    expect(url.searchParams.get("scope")).toContain("streaming");
    expect(url.searchParams.get("state")).toBe("session.state");
  });

  it("prefers a configured Spotify redirect URI", () => {
    expect(
      resolveSpotifyRedirectUri(
        { SPOTIFY_REDIRECT_URI: "https://auth.example.com/callback" },
        "https://worker.example.dev"
      )
    ).toBe("https://auth.example.com/callback");
  });

  it("normalizes the token response and strips refresh tokens", () => {
    const payload = toSpotifyAuthorizedPayload({
      access_token: " access-token ",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "streaming user-read-email",
      refresh_token: "do-not-return-this"
    });

    expect(payload).toEqual({
      accessToken: "access-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      scope: "streaming user-read-email"
    });
    expect(payload).not.toHaveProperty("refresh_token");
    expect(payload).not.toHaveProperty("refreshToken");
  });
});
