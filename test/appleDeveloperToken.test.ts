import { describe, expect, it, vi } from "vitest";
import { getAppleDeveloperToken } from "../src/appleDeveloperToken";
import type { Env } from "../src/types";

describe("external MusicKit token provider", () => {
  it("accepts a JSON developerToken response", async () => {
    const token = unsignedJwtWithExpiry(2_000_000_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            developerToken: token,
            expiresAt: 2_000_000_000
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
    );

    const result =
      await getAppleDeveloperToken({
        MUSICKIT_TOKEN_PROVIDER_URL: "https://token.example.test"
      } as Env);

    expect(result).toEqual({
      developerToken: token,
      expiresAt: 2_000_000_000,
      source: "external-provider"
    });
  });

  it("reads JWT expiry from a plain text token response", async () => {
    const token = unsignedJwtWithExpiry(2_100_000_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(token, {
          status: 200,
          headers: {
            "content-type": "text/plain"
          }
        })
      )
    );

    const result =
      await getAppleDeveloperToken({
        MUSICKIT_TOKEN_PROVIDER_URL: "https://plain-token.example.test"
      } as Env);

    expect(result).toEqual({
      developerToken: token,
      expiresAt: 2_100_000_000,
      source: "external-provider"
    });
  });
});

function unsignedJwtWithExpiry(exp: number): string {
  return [
    base64Url(JSON.stringify({ alg: "ES256", typ: "JWT" })),
    base64Url(JSON.stringify({ exp })),
    "signature"
  ].join(".");
}

function base64Url(value: string): string {
  return btoa(value)
    .replace(/=+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}
