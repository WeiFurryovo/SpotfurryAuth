import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { PairingSessionObject } from "../src/pairingSessionObject";
import { clearRateLimitBuckets } from "../src/rateLimit";
import type { Env } from "../src/types";

describe("SpotfurryAuth routes", () => {
  beforeEach(() => {
    clearRateLimitBuckets();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("completes an Apple Music pairing once without wildcard CORS", async () => {
    const env = createTestEnv({
      PUBLIC_BASE_URL: "https://auth.example.test"
    });
    const startResponse =
      await fetchApp("/api/pairing/start", env, {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.10"
        }
      });

    expect(startResponse.status).toBe(200);
    expect(startResponse.headers.get("access-control-allow-origin")).toBeNull();
    expect(startResponse.headers.get("x-content-type-options")).toBe("nosniff");

    const startPayload = await readJson(startResponse);
    const sessionId = String(startPayload.sessionId);
    const watchSecret = String(startPayload.watchSecret);
    const pairUrl = new URL(String(startPayload.pairUrl));
    const phoneSecret = pairUrl.searchParams.get("p") ?? "";

    expect(pairUrl.origin).toBe("https://auth.example.test");
    expect(pairUrl.pathname).toBe("/apple-music/pair");
    expect(pairUrl.searchParams.get("s")).toBe(sessionId);
    expect(phoneSecret.length).toBeGreaterThan(30);
    expect(pairUrl.toString()).not.toContain(watchSecret);

    const pendingResponse =
      await fetchApp(`/api/pairing/status?sessionId=${sessionId}`, env, {
        headers: {
          authorization: `Bearer ${watchSecret}`
        }
      });
    expect(await readJson(pendingResponse)).toMatchObject({
      status: "pending"
    });

    const forbiddenResponse =
      await fetchApp(`/api/pairing/status?sessionId=${sessionId}`, env, {
        headers: {
          authorization: "Bearer wrong-secret"
        }
      });
    expect(forbiddenResponse.status).toBe(403);

    const completeResponse =
      await fetchApp("/api/pairing/complete", env, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          phoneSecret,
          musicUserToken: "music-user-token"
        })
      });
    expect(completeResponse.status).toBe(200);

    const authorizedResponse =
      await fetchApp(`/api/pairing/status?sessionId=${sessionId}`, env, {
        headers: {
          authorization: `Bearer ${watchSecret}`
        }
      });
    expect(await readJson(authorizedResponse)).toMatchObject({
      status: "authorized",
      musicUserToken: "music-user-token",
      developerTokenAvailable: false
    });

    const replayResponse =
      await fetchApp(`/api/pairing/status?sessionId=${sessionId}`, env, {
        headers: {
          authorization: `Bearer ${watchSecret}`
        }
      });
    expect(await readJson(replayResponse)).toMatchObject({
      status: "expired"
    });
  });

  it("completes Spotify OAuth pairing without returning refresh tokens", async () => {
    const env = createTestEnv({
      PUBLIC_BASE_URL: "https://auth.example.test",
      SPOTIFY_CLIENT_ID: "spotify-client-id",
      SPOTIFY_CLIENT_SECRET: "spotify-client-secret"
    });
    const startResponse =
      await fetchApp("/api/spotify/pairing/start", env, {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.20"
        }
      });
    const startPayload = await readJson(startResponse);
    const sessionId = String(startPayload.sessionId);
    const watchSecret = String(startPayload.watchSecret);
    const pairUrl = new URL(String(startPayload.pairUrl));
    const phoneSecret = pairUrl.searchParams.get("p") ?? "";

    expect(pairUrl.pathname).toBe("/spotify/pair");
    expect(phoneSecret.length).toBeGreaterThan(30);

    const loginResponse =
      await fetchApp(
        `/spotify/login?s=${encodeURIComponent(sessionId)}&p=${encodeURIComponent(phoneSecret)}`,
        env
      );
    const authorizeUrl = new URL(loginResponse.headers.get("location") ?? "");
    const oauthState = authorizeUrl.searchParams.get("state") ?? "";

    expect(loginResponse.status).toBe(302);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
      "https://accounts.spotify.com/authorize"
    );
    expect(authorizeUrl.searchParams.get("client_id")).toBe("spotify-client-id");
    expect(oauthState).toContain(".");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://accounts.spotify.com/api/token");
        expect(String(init?.body)).toContain("code=spotify-code");
        return new Response(
          JSON.stringify({
            access_token: "spotify-access-token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "streaming user-read-email",
            refresh_token: "must-not-leave-worker"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      })
    );

    const callbackResponse =
      await fetchApp(
        `/spotify/callback?code=spotify-code&state=${encodeURIComponent(oauthState)}`,
        env
      );
    expect(callbackResponse.status).toBe(200);
    expect(await callbackResponse.text()).toContain("Spotify 已连接");

    const statusResponse =
      await fetchApp(`/api/spotify/pairing/status?sessionId=${sessionId}`, env, {
        headers: {
          authorization: `Bearer ${watchSecret}`
        }
      });
    const statusPayload = await readJson(statusResponse);

    expect(statusPayload).toMatchObject({
      status: "authorized",
      accessToken: "spotify-access-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      scope: "streaming user-read-email"
    });
    expect(statusPayload).not.toHaveProperty("refresh_token");
    expect(statusPayload).not.toHaveProperty("refreshToken");
  });

  it("rate limits repeated pairing session creation", async () => {
    const env = createTestEnv();

    for (let requestIndex = 0; requestIndex < 20; requestIndex += 1) {
      const response =
        await fetchApp("/api/pairing/start", env, {
          method: "POST",
          headers: {
            "cf-connecting-ip": "203.0.113.30"
          }
        });
      expect(response.status).toBe(200);
    }

    const limitedResponse =
      await fetchApp("/api/pairing/start", env, {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.30"
        }
      });

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("retry-after")).toBeTruthy();
    expect(await readJson(limitedResponse)).toMatchObject({
      error: "Too many requests"
    });
  });
});

async function fetchApp(
  path: string,
  env: Env,
  init?: RequestInit
): Promise<Response> {
  return await app.fetch(new Request(`https://auth.example.test${path}`, init), env);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function createTestEnv(overrides: Partial<Env> = {}): Env {
  const env = {
    ...overrides
  } as Env;
  env.PAIRING_SESSION = createPairingNamespace(env);
  return env;
}

function createPairingNamespace(env: Env): DurableObjectNamespace {
  const objects = new Map<string, PairingSessionObject>();

  return {
    idFromName(name: string): DurableObjectId {
      return name as unknown as DurableObjectId;
    },
    get(id: DurableObjectId): DurableObjectStub {
      const objectId = String(id);
      let object = objects.get(objectId);
      if (!object) {
        object =
          new PairingSessionObject(
            {
              storage: new InMemoryDurableObjectStorage()
            } as unknown as DurableObjectState,
            env
          );
        objects.set(objectId, object);
      }

      return {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          return await object.fetch(request);
        }
      } as unknown as DurableObjectStub;
    }
  } as unknown as DurableObjectNamespace;
}

class InMemoryDurableObjectStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(
    key: string,
    value: T
  ): Promise<void> {
    this.values.set(key, value);
  }

  async deleteAll(): Promise<void> {
    this.values.clear();
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    void scheduledTime;
  }
}
