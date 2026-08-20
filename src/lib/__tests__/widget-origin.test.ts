import { describe, it, expect } from "vitest";
import {
  normaliseOrigin,
  normaliseOrigins,
  invalidOrigins,
  isOriginAllowed,
  canActivate,
  corsHeaders,
  pageUrlMatchesOrigin,
  readClientIp,
  stripUrlForStorage,
} from "../widget-origin";

describe("normaliseOrigin", () => {
  it("lower-cases scheme and host", () => {
    expect(normaliseOrigin("HTTPS://Acme.Example")).toBe("https://acme.example");
  });
  it("drops default ports but keeps explicit non-default ports", () => {
    expect(normaliseOrigin("https://acme.example:443")).toBe("https://acme.example");
    expect(normaliseOrigin("http://acme.example:80")).toBe("http://acme.example");
    expect(normaliseOrigin("http://localhost:5173")).toBe("http://localhost:5173");
  });
  it("strips trailing slashes, paths, query and hash", () => {
    expect(normaliseOrigin("https://acme.example/")).toBe("https://acme.example");
    expect(normaliseOrigin("https://acme.example/app/page?x=1#y")).toBe("https://acme.example");
    expect(normaliseOrigin("  https://acme.example  ")).toBe("https://acme.example");
  });
  it("rejects non-http schemes, bare hosts, 'null' and garbage", () => {
    expect(normaliseOrigin("ftp://acme.example")).toBeNull();
    expect(normaliseOrigin("acme.example")).toBeNull();
    expect(normaliseOrigin("null")).toBeNull();
    expect(normaliseOrigin("")).toBeNull();
    expect(normaliseOrigin(null)).toBeNull();
    expect(normaliseOrigin("not a url")).toBeNull();
  });
});

describe("normaliseOrigins / invalidOrigins / canActivate", () => {
  it("dedupes after normalisation and drops invalid entries", () => {
    expect(normaliseOrigins(["https://A.example/", "https://a.example", "nope", "http://b.example:80"]))
      .toEqual(["https://a.example", "http://b.example"]);
    expect(invalidOrigins(["https://a.example", "nope", "ftp://x"])).toEqual(["nope", "ftp://x"]);
  });
  it("requires at least one valid origin to activate", () => {
    expect(canActivate([])).toBe(false);
    expect(canActivate(null)).toBe(false);
    expect(canActivate(["garbage"])).toBe(false);
    expect(canActivate(["https://a.example"])).toBe(true);
  });
});

describe("isOriginAllowed", () => {
  const config = { allowed_origins: ["https://Acme.Example/", "http://localhost:5173"] };
  it("exact-matches after normalising both sides", () => {
    expect(isOriginAllowed(config, "https://acme.example")).toBe(true);
    expect(isOriginAllowed(config, "HTTPS://ACME.EXAMPLE")).toBe(true);
    expect(isOriginAllowed(config, "http://localhost:5173")).toBe(true);
  });
  it("rejects other ports, schemes, subdomains and wildcards", () => {
    expect(isOriginAllowed(config, "http://acme.example")).toBe(false);
    expect(isOriginAllowed(config, "https://acme.example:8443")).toBe(false);
    expect(isOriginAllowed(config, "https://www.acme.example")).toBe(false);
    expect(isOriginAllowed(config, "https://evil.example")).toBe(false);
    expect(isOriginAllowed({ allowed_origins: ["*"] }, "https://evil.example")).toBe(false);
  });
  it("denies everything when the allowlist is empty or the Origin header is missing", () => {
    expect(isOriginAllowed({ allowed_origins: [] }, "https://acme.example")).toBe(false);
    expect(isOriginAllowed(config, null)).toBe(false);
  });
});

describe("corsHeaders", () => {
  it("echoes the exact origin with Vary: Origin only when allowed", () => {
    const h = corsHeaders("https://acme.example", { allowed: true, methods: "POST, OPTIONS" });
    expect(h["Access-Control-Allow-Origin"]).toBe("https://acme.example");
    expect(h["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(h["Access-Control-Allow-Headers"]).toContain("X-Site-Key");
    expect(h.Vary).toBe("Origin");
  });
  it("emits no Access-Control-* headers when not allowed or origin missing — never *", () => {
    expect(corsHeaders("https://evil.example", { allowed: false })).toEqual({ Vary: "Origin" });
    expect(corsHeaders(null, { allowed: true })).toEqual({ Vary: "Origin" });
  });
});

describe("pageUrlMatchesOrigin / stripUrlForStorage", () => {
  it("compares the page URL origin with the request origin", () => {
    expect(pageUrlMatchesOrigin("https://acme.example/app?x=1", "https://acme.example")).toBe(true);
    expect(pageUrlMatchesOrigin("https://acme.example/app", "https://other.example")).toBe(false);
    expect(pageUrlMatchesOrigin("garbage", "https://acme.example")).toBe(false);
    expect(pageUrlMatchesOrigin("https://acme.example/", null)).toBe(false);
  });
  it("strips query and hash but keeps the path", () => {
    expect(stripUrlForStorage("https://acme.example/app/page?token=abc#frag")).toBe("https://acme.example/app/page");
    expect(stripUrlForStorage("https://acme.example")).toBe("https://acme.example/");
    expect(stripUrlForStorage("relative/path?x=1")).toBe("relative/path");
  });
});

describe("readClientIp", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost/x", { headers });

  it("takes the first hop of x-forwarded-for", () => {
    expect(readClientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" }))).toBe(
      "203.0.113.9"
    );
    expect(readClientIp(req({ "x-forwarded-for": " 203.0.113.9 " }))).toBe("203.0.113.9");
  });
  it("falls back to x-real-ip, then unknown", () => {
    expect(readClientIp(req({ "x-real-ip": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(readClientIp(req({ "x-forwarded-for": "" , "x-real-ip": "198.51.100.1" }))).toBe(
      "198.51.100.1"
    );
    expect(readClientIp(req({}))).toBe("unknown");
  });
});
