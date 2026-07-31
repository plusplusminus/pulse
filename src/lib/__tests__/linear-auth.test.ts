import { describe, it, expect } from "vitest";
import { linearAuthHeader } from "../linear-auth";

describe("linearAuthHeader", () => {
  it("sends API keys raw — Linear rejects them with a Bearer prefix", () => {
    expect(linearAuthHeader("lin_api_abc123")).toBe("lin_api_abc123");
  });

  it("prefixes OAuth tokens with Bearer — Linear 401s without it", () => {
    expect(linearAuthHeader("lin_oauth_abc123")).toBe("Bearer lin_oauth_abc123");
  });

  it("treats any non-API-key token as an OAuth token", () => {
    expect(linearAuthHeader("some-opaque-token")).toBe("Bearer some-opaque-token");
  });

  it("does not treat a token merely containing lin_api_ as an API key", () => {
    expect(linearAuthHeader("xlin_api_abc")).toBe("Bearer xlin_api_abc");
  });
});
