import { describe, it, expect } from "vitest";
import { resolveReturnPath } from "../login-return-path";

const SLUG = "linear-gratis-client-app";
const FALLBACK = `/hub/${SLUG}`;

describe("resolveReturnPath", () => {
  it("falls back to the hub root when next is missing", () => {
    expect(resolveReturnPath(undefined, SLUG)).toBe(FALLBACK);
    expect(resolveReturnPath(null, SLUG)).toBe(FALLBACK);
    expect(resolveReturnPath("", SLUG)).toBe(FALLBACK);
  });

  it("accepts in-hub deep links", () => {
    expect(
      resolveReturnPath(`/hub/${SLUG}/PULSE?issue=78239308-4b5a`, SLUG)
    ).toBe(`/hub/${SLUG}/PULSE?issue=78239308-4b5a`);
    expect(
      resolveReturnPath(`/hub/${SLUG}?issue=abc&tab=activity`, SLUG)
    ).toBe(`/hub/${SLUG}?issue=abc&tab=activity`);
    expect(resolveReturnPath(`/hub/${SLUG}/PULSE/task/abc`, SLUG)).toBe(
      `/hub/${SLUG}/PULSE/task/abc`
    );
    expect(resolveReturnPath(FALLBACK, SLUG)).toBe(FALLBACK);
  });

  it("rejects destinations outside this hub", () => {
    expect(resolveReturnPath("/hub/other-hub/PULSE", SLUG)).toBe(FALLBACK);
    expect(resolveReturnPath("/admin", SLUG)).toBe(FALLBACK);
    expect(resolveReturnPath(`/hub/${SLUG}-evil`, SLUG)).toBe(FALLBACK);
  });

  it("rejects open-redirect attempts", () => {
    expect(resolveReturnPath("https://evil.com", SLUG)).toBe(FALLBACK);
    expect(resolveReturnPath("//evil.com", SLUG)).toBe(FALLBACK);
    expect(resolveReturnPath(`/hub/${SLUG}//evil.com`, SLUG)).toBe(FALLBACK);
    expect(resolveReturnPath(`/hub/${SLUG}/\\evil.com`, SLUG)).toBe(FALLBACK);
  });

  it("rejects non-ASCII input that would break btoa", () => {
    expect(resolveReturnPath(`/hub/${SLUG}/PULSE?issue=déjà`, SLUG)).toBe(
      FALLBACK
    );
  });

  it("never bounces back to the login page", () => {
    expect(resolveReturnPath(`/hub/${SLUG}/login`, SLUG)).toBe(FALLBACK);
    expect(resolveReturnPath(`/hub/${SLUG}/login?next=x`, SLUG)).toBe(
      FALLBACK
    );
  });
});
