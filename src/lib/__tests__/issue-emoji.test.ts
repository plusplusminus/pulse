import { describe, it, expect } from "vitest";
import {
  classifyIssueEmoji,
  extractLeadingEmoji,
  applyEmojiToTitle,
  URGENT_EMOJI,
  BUG_HIGH_EMOJI,
  BUG_MEDIUM_EMOJI,
  BUG_LOW_EMOJI,
  FEATURE_HIGH_EMOJI,
  FEATURE_MED_LOW_EMOJI,
} from "../issue-emoji";

describe("classifyIssueEmoji", () => {
  describe("urgent rule (priority 1 or Emergency SoS label)", () => {
    it("returns 🔥 for urgent priority regardless of labels", () => {
      expect(classifyIssueEmoji([{ name: "Bug" }], 1)).toBe(URGENT_EMOJI);
      expect(classifyIssueEmoji([{ name: "Improvement" }], 1)).toBe(URGENT_EMOJI);
      expect(classifyIssueEmoji([], 1)).toBe(URGENT_EMOJI);
    });

    it("returns 🔥 for Emergency SoS label regardless of priority", () => {
      expect(classifyIssueEmoji([{ name: "Emergency SoS" }], 3)).toBe(URGENT_EMOJI);
      expect(classifyIssueEmoji([{ name: "Emergency SoS" }, { name: "Bug" }], 4)).toBe(
        URGENT_EMOJI
      );
      expect(classifyIssueEmoji([{ name: "Emergency SoS" }], undefined)).toBe(URGENT_EMOJI);
    });

    it("matches Emergency SoS case-insensitively and tolerates punctuation", () => {
      expect(classifyIssueEmoji([{ name: "emergency sos" }], 0)).toBe(URGENT_EMOJI);
      expect(classifyIssueEmoji([{ name: "EMERGENCY SOS" }], 0)).toBe(URGENT_EMOJI);
      // Real-world variant in the workspace.
      expect(classifyIssueEmoji([{ name: "EMERGENCY SOS!!" }], 0)).toBe(URGENT_EMOJI);
    });
  });

  describe("bug rule (Bug or Defect label)", () => {
    it("maps bug priorities to colored circles", () => {
      expect(classifyIssueEmoji([{ name: "Bug" }], 2)).toBe(BUG_HIGH_EMOJI);
      expect(classifyIssueEmoji([{ name: "Bug" }], 3)).toBe(BUG_MEDIUM_EMOJI);
      expect(classifyIssueEmoji([{ name: "Bug" }], 4)).toBe(BUG_LOW_EMOJI);
    });

    it("treats Defect as bug", () => {
      expect(classifyIssueEmoji([{ name: "Defect" }], 2)).toBe(BUG_HIGH_EMOJI);
      expect(classifyIssueEmoji([{ name: "defect" }], 4)).toBe(BUG_LOW_EMOJI);
    });

    it('treats compound "Bug / Defect" label as bug', () => {
      expect(classifyIssueEmoji([{ name: "Bug / Defect" }], 2)).toBe(BUG_HIGH_EMOJI);
      expect(classifyIssueEmoji([{ name: "Bug/Defect" }], 3)).toBe(BUG_MEDIUM_EMOJI);
      expect(classifyIssueEmoji([{ name: "bug / defect" }], 4)).toBe(BUG_LOW_EMOJI);
    });

    it('compound bug label takes precedence over Feature when both present', () => {
      // Real-world case: SS-30 had labels [Feature, "Bug / Defect"] @ priority High,
      // and was wrongly classified as Feature (🟣) before the split-name fix.
      expect(
        classifyIssueEmoji([{ name: "Feature" }, { name: "Bug / Defect" }], 2)
      ).toBe(BUG_HIGH_EMOJI);
    });

    it("returns null when bug-labelled but priority is 0 (No priority)", () => {
      expect(classifyIssueEmoji([{ name: "Bug" }], 0)).toBeNull();
      expect(classifyIssueEmoji([{ name: "Bug" }], undefined)).toBeNull();
    });
  });

  describe("feature rule (Feature or Improvement label)", () => {
    it("maps feature high to 🟣 and medium/low to 🔵", () => {
      expect(classifyIssueEmoji([{ name: "Feature" }], 2)).toBe(FEATURE_HIGH_EMOJI);
      expect(classifyIssueEmoji([{ name: "Feature" }], 3)).toBe(FEATURE_MED_LOW_EMOJI);
      expect(classifyIssueEmoji([{ name: "Feature" }], 4)).toBe(FEATURE_MED_LOW_EMOJI);
    });

    it("treats Improvement as feature", () => {
      expect(classifyIssueEmoji([{ name: "Improvement" }], 2)).toBe(FEATURE_HIGH_EMOJI);
      expect(classifyIssueEmoji([{ name: "Improvement" }], 3)).toBe(FEATURE_MED_LOW_EMOJI);
    });

    it("returns null when feature-labelled but priority is 0", () => {
      expect(classifyIssueEmoji([{ name: "Feature" }], 0)).toBeNull();
    });
  });

  describe("precedence", () => {
    it("urgent priority beats bug-label classification", () => {
      expect(classifyIssueEmoji([{ name: "Bug" }], 1)).toBe(URGENT_EMOJI);
    });

    it("Emergency SoS beats both Bug and Feature labels", () => {
      expect(
        classifyIssueEmoji([{ name: "Emergency SoS" }, { name: "Bug" }], 3)
      ).toBe(URGENT_EMOJI);
      expect(
        classifyIssueEmoji([{ name: "Emergency SoS" }, { name: "Feature" }], 2)
      ).toBe(URGENT_EMOJI);
    });

    it("if both Bug and Feature labels are present, bug wins", () => {
      expect(classifyIssueEmoji([{ name: "Bug" }, { name: "Feature" }], 2)).toBe(
        BUG_HIGH_EMOJI
      );
    });
  });

  describe("no classification", () => {
    it("returns null when no recognised label and priority is non-urgent", () => {
      expect(classifyIssueEmoji([{ name: "Documentation" }], 2)).toBeNull();
      expect(classifyIssueEmoji([], 3)).toBeNull();
      expect(classifyIssueEmoji(undefined, 2)).toBeNull();
    });

    it("ignores labels with empty/whitespace names", () => {
      expect(classifyIssueEmoji([{ name: "" }, { name: "   " }], 2)).toBeNull();
    });
  });
});

describe("extractLeadingEmoji", () => {
  it("returns null when title has no known leading emoji", () => {
    expect(extractLeadingEmoji("Plain title")).toEqual({
      emoji: null,
      rest: "Plain title",
    });
  });

  it("extracts each known emoji and the rest", () => {
    expect(extractLeadingEmoji("🔥 Login broken")).toEqual({
      emoji: URGENT_EMOJI,
      rest: "Login broken",
    });
    expect(extractLeadingEmoji("🟣 Add dark mode")).toEqual({
      emoji: FEATURE_HIGH_EMOJI,
      rest: "Add dark mode",
    });
  });

  it("strips multiple whitespace after emoji", () => {
    expect(extractLeadingEmoji("🔴   Some bug")).toEqual({
      emoji: BUG_HIGH_EMOJI,
      rest: "Some bug",
    });
  });

  it("does not match emojis we don't manage", () => {
    expect(extractLeadingEmoji("✨ unrelated")).toEqual({
      emoji: null,
      rest: "✨ unrelated",
    });
  });
});

describe("applyEmojiToTitle", () => {
  it("prepends emoji when title has none", () => {
    expect(applyEmojiToTitle("Plain", URGENT_EMOJI)).toBe("🔥 Plain");
  });

  it("replaces an existing leading emoji", () => {
    expect(applyEmojiToTitle("🟠 Some bug", BUG_LOW_EMOJI)).toBe("🟡 Some bug");
  });

  it("strips a leading emoji when newEmoji is null", () => {
    expect(applyEmojiToTitle("🔥 Plain", null)).toBe("Plain");
  });

  it("is idempotent: applying the same emoji twice is a no-op", () => {
    const once = applyEmojiToTitle("Some bug", BUG_HIGH_EMOJI);
    const twice = applyEmojiToTitle(once, BUG_HIGH_EMOJI);
    expect(once).toBe(twice);
  });

  it("leaves a non-emoji title unchanged when newEmoji is null", () => {
    expect(applyEmojiToTitle("Plain", null)).toBe("Plain");
  });
});
