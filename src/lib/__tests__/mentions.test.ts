import { describe, it, expect } from "vitest";
import {
  extractMentionTokens,
  resolveMentions,
  type MentionableMember,
} from "../mentions";

// PULSE-362: mentions are typed @tokens in a client-facing comment, resolved
// against hub members by handle → email local-part → full email, fail-open.

const members: MentionableMember[] = [
  { user_id: "u_jane", email: "jane@acme.com", mention_handle: null },
  { user_id: "u_sam", email: "sam@acme.com", mention_handle: "sammy" },
  // shares the "jane" local-part with u_jane (ambiguity); an explicit handle
  // disambiguates.
  { user_id: "u_jane2", email: "jane@other.com", mention_handle: "janeb" },
];

describe("extractMentionTokens", () => {
  it("extracts @tokens, lowercased and deduped", () => {
    expect(
      extractMentionTokens("heyclient @Jane and @sammy please review @jane")
    ).toEqual(["jane", "sammy"]);
  });

  it("ignores the trigger words written as @heyclient / @pulse", () => {
    expect(extractMentionTokens("@heyclient @pulse @jane")).toEqual(["jane"]);
  });

  it("captures an explicit full-email token", () => {
    expect(extractMentionTokens("pulse ping @jane@acme.com")).toEqual([
      "jane@acme.com",
    ]);
  });

  it("does not treat a prose email as a mention", () => {
    expect(
      extractMentionTokens("heyclient email jane@acme.com for access")
    ).toEqual([]);
  });

  it("returns [] for a bare client-facing comment", () => {
    expect(extractMentionTokens("heyclient the build is ready")).toEqual([]);
  });
});

describe("resolveMentions", () => {
  it("resolves an explicit handle", () => {
    const r = resolveMentions("heyclient @sammy ready", members);
    expect(r.mentionedUserIds).toEqual(["u_sam"]);
    expect(r.unresolved).toEqual([]);
  });

  it("resolves a unique email local-part", () => {
    const r = resolveMentions("heyclient @sam ready", members);
    expect(r.mentionedUserIds).toEqual(["u_sam"]);
    expect(r.unresolved).toEqual([]);
  });

  it("disambiguates a shared local-part via an explicit handle", () => {
    const r = resolveMentions("heyclient @janeb hi", members);
    expect(r.mentionedUserIds).toEqual(["u_jane2"]);
    expect(r.unresolved).toEqual([]);
  });

  it("disambiguates a shared local-part via an explicit full email", () => {
    const r = resolveMentions("heyclient @jane@acme.com hi", members);
    expect(r.mentionedUserIds).toEqual(["u_jane"]);
    expect(r.unresolved).toEqual([]);
  });

  it("marks an ambiguous local-part as unresolved (fail-open, no silent drop)", () => {
    const r = resolveMentions("heyclient @jane hi", members);
    expect(r.mentionedUserIds).toEqual([]);
    expect(r.unresolved).toEqual(["jane"]);
  });

  it("marks an unknown token as unresolved", () => {
    const r = resolveMentions("heyclient @nobody hi", members);
    expect(r.mentionedUserIds).toEqual([]);
    expect(r.unresolved).toEqual(["nobody"]);
  });

  it("treats a bare client-facing comment as a broadcast (no mentions, no warnings)", () => {
    const r = resolveMentions("heyclient the build is ready", members);
    expect(r.mentionedUserIds).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });

  it("resolves multiple distinct mentions in one comment", () => {
    const r = resolveMentions("heyclient @sammy @janeb ship it", members);
    expect(r.mentionedUserIds.sort()).toEqual(["u_jane2", "u_sam"]);
    expect(r.unresolved).toEqual([]);
  });
});
