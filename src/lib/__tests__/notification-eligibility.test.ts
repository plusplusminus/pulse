import { describe, it, expect } from "vitest";
import {
  resolveEmailDelivery,
  shouldSendImmediateEmail,
  shouldIncludeInDigest,
  type EmailDeliveryMode,
} from "../notification-eligibility";
import type { NotificationPreference } from "../notification-preferences";

// PULSE-361: the shared delivery resolver is the single source of truth for
// "should this recipient be emailed about this event, and via which channel?".
// Both the immediate path and the digest path route through it.

function pref(email_mode: EmailDeliveryMode): NotificationPreference {
  return {
    event_type: "comment",
    in_app_enabled: true,
    email_mode,
    digest_time: "09:00",
    timezone: "UTC",
  };
}

const event = { event_type: "comment" };

describe("resolveEmailDelivery", () => {
  it("returns the recipient's stored email_mode for the event's type", () => {
    expect(resolveEmailDelivery(event, { preference: pref("immediate") })).toBe(
      "immediate"
    );
    expect(resolveEmailDelivery(event, { preference: pref("daily") })).toBe(
      "daily"
    );
    expect(resolveEmailDelivery(event, { preference: pref("weekly") })).toBe(
      "weekly"
    );
    expect(resolveEmailDelivery(event, { preference: pref("off") })).toBe("off");
  });

  it("treats a missing preference as 'off' (no email)", () => {
    expect(resolveEmailDelivery(event, { preference: undefined })).toBe("off");
  });
});

describe("shouldSendImmediateEmail", () => {
  it("is true only for the 'immediate' mode", () => {
    expect(
      shouldSendImmediateEmail(event, { preference: pref("immediate") })
    ).toBe(true);
    for (const mode of ["off", "daily", "weekly"] as EmailDeliveryMode[]) {
      expect(shouldSendImmediateEmail(event, { preference: pref(mode) })).toBe(
        false
      );
    }
    expect(shouldSendImmediateEmail(event, { preference: undefined })).toBe(
      false
    );
  });
});

describe("shouldIncludeInDigest", () => {
  it("includes an event only in the digest matching its cadence", () => {
    expect(
      shouldIncludeInDigest(event, { preference: pref("daily") }, "daily")
    ).toBe(true);
    expect(
      shouldIncludeInDigest(event, { preference: pref("daily") }, "weekly")
    ).toBe(false);
    expect(
      shouldIncludeInDigest(event, { preference: pref("weekly") }, "weekly")
    ).toBe(true);
    expect(
      shouldIncludeInDigest(event, { preference: pref("weekly") }, "daily")
    ).toBe(false);
  });

  it("excludes immediate / off / missing prefs from digests", () => {
    expect(
      shouldIncludeInDigest(event, { preference: pref("immediate") }, "daily")
    ).toBe(false);
    expect(
      shouldIncludeInDigest(event, { preference: pref("off") }, "daily")
    ).toBe(false);
    expect(
      shouldIncludeInDigest(event, { preference: undefined }, "weekly")
    ).toBe(false);
  });
});

// PULSE-362: comment mention-scope.
describe("comment mention-scope", () => {
  it("'all' scope is unaffected by whether the recipient is mentioned", () => {
    expect(
      resolveEmailDelivery(event, {
        preference: pref("immediate"),
        commentScope: "all",
        isMentioned: false,
      })
    ).toBe("immediate");
  });

  it("'mentions_only' suppresses a comment the recipient is not mentioned in", () => {
    expect(
      resolveEmailDelivery(event, {
        preference: pref("immediate"),
        commentScope: "mentions_only",
        isMentioned: false,
      })
    ).toBe("off");
    expect(
      shouldIncludeInDigest(
        event,
        { preference: pref("daily"), commentScope: "mentions_only", isMentioned: false },
        "daily"
      )
    ).toBe(false);
  });

  it("'mentions_only' delivers a comment that mentions the recipient (pierces the quiet setting)", () => {
    expect(
      shouldSendImmediateEmail(event, {
        preference: pref("immediate"),
        commentScope: "mentions_only",
        isMentioned: true,
      })
    ).toBe(true);
  });

  it("'mentions_only' never overrides an 'off' channel, even when mentioned", () => {
    expect(
      resolveEmailDelivery(event, {
        preference: pref("off"),
        commentScope: "mentions_only",
        isMentioned: true,
      })
    ).toBe("off");
  });

  it("mention-scope does not affect non-comment events", () => {
    const statusEvent = { event_type: "status_change" };
    expect(
      resolveEmailDelivery(statusEvent, {
        preference: pref("immediate"),
        commentScope: "mentions_only",
        isMentioned: false,
      })
    ).toBe("immediate");
  });
});
