import { describe, expect, it } from "vitest";
import { base64UrlEncode } from "../src/crypto";
import {
  createPairingSession,
  createPairUrl,
  isExpired,
  PAIRING_TTL_MS,
  resolvePublicBaseUrl
} from "../src/pairing";

describe("pairing helpers", () => {
  it("creates a readable short code and five minute expiry", () => {
    const now = 1_000;
    const session = createPairingSession(now);

    expect(session.code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/u);
    expect(session.expiresAt).toBe(now + PAIRING_TTL_MS);
    expect(session.phoneSecret.length).toBeGreaterThan(30);
    expect(session.watchSecret.length).toBeGreaterThan(30);
  });

  it("creates a phone pairing url without leaking the watch secret", () => {
    const session = {
      sessionId: "session-id",
      phoneSecret: "phone-secret",
      watchSecret: "watch-secret",
      code: "ABCD-1234"
    };

    const url = createPairUrl("https://auth.example.com/", session);

    expect(url).toBe(
      "https://auth.example.com/apple-music/pair?s=session-id&p=phone-secret&code=ABCD-1234"
    );
    expect(url).not.toContain(session.watchSecret);
  });

  it("prefers configured public base url over request origin", () => {
    const request = new Request("https://worker.example.dev/api/pairing/start");

    expect(resolvePublicBaseUrl("https://auth.example.com/root", request)).toBe(
      "https://auth.example.com/root"
    );
    expect(resolvePublicBaseUrl("", request)).toBe("https://worker.example.dev");
  });

  it("checks expiry using epoch milliseconds", () => {
    expect(isExpired(2_000, 2_000)).toBe(true);
    expect(isExpired(2_001, 2_000)).toBe(false);
  });

  it("encodes base64url without padding", () => {
    expect(base64UrlEncode("Spotfurry?")).toBe("U3BvdGZ1cnJ5Pw");
  });
});
