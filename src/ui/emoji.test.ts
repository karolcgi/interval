import { describe, expect, it } from "vitest";
import { leadingEmoji, startsWithEmoji, withLeadingEmoji } from "./EmojiPicker";

describe("emoji in front of names", () => {
  it("adds, swaps and removes the leading emoji", () => {
    expect(withLeadingEmoji("Render tests", "🧊")).toBe("🧊 Render tests");
    expect(withLeadingEmoji("🧊 Render tests", "🔥")).toBe("🔥 Render tests");
    expect(withLeadingEmoji("🖥️Render", "🔥")).toBe("🔥 Render");
    expect(withLeadingEmoji("🏋️ Gym", null)).toBe("Gym");
    expect(withLeadingEmoji(null, "☕")).toBe("☕");
    expect(withLeadingEmoji("3D lookdev", "🎨")).toBe("🎨 3D lookdev");
  });
  it("detects a leading emoji, not digits or text", () => {
    expect(startsWithEmoji("🐕 Walk")).toBe(true);
    expect(startsWithEmoji("👨‍👩‍👧 Family")).toBe(true);
    expect(leadingEmoji("👨‍👩‍👧 Family")).toBe("👨‍👩‍👧");
    expect(startsWithEmoji("3D lookdev")).toBe(false);
    expect(startsWithEmoji("#hashtag")).toBe(false);
    expect(startsWithEmoji("")).toBe(false);
  });
});
