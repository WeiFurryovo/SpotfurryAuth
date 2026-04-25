import { describe, expect, it } from "vitest";
import { readBearerToken } from "../src/http";

describe("HTTP helpers", () => {
  it("reads bearer tokens with extra surrounding whitespace", () => {
    const request =
      new Request("https://auth.example.test", {
        headers: {
          authorization: "  Bearer   watch-secret  "
        }
      });

    expect(readBearerToken(request)).toBe("watch-secret");
  });

  it("rejects malformed bearer authorization headers", () => {
    const request =
      new Request("https://auth.example.test", {
        headers: {
          authorization: "Bearer watch-secret extra"
        }
      });

    expect(readBearerToken(request)).toBeUndefined();
  });
});
