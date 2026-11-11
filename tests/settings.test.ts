import { describe, expect, it } from "vitest";
import { parseStorySettings, DEFAULT_STORY_SETTINGS } from "@/lib/engine/settings";

describe("Story Settings (Part A)", () => {
  it("defaults to Auto and standard settings when empty or null", () => {
    const s1 = parseStorySettings(null);
    expect(s1.genre).toBe("auto");
    expect(s1.tone).toBe("auto");
    expect(s1.worldSetting).toBe("auto");
    expect(s1.mainCharacter.mode).toBe("auto");
    expect(s1.narration).toBe("third person");
    expect(s1.intensity).toBe("balanced");
    expect(s1.depth).toBe("standard");
    expect(s1.learnerLevel).toBe("beginner");
    expect(s1.language).toBe("English");

    const s2 = parseStorySettings({});
    expect(s2).toEqual(DEFAULT_STORY_SETTINGS);
  });

  it("falls back to Auto or safe defaults on unknown or invalid values", () => {
    const parsed = parseStorySettings({
      genre: "alien-cooking-show",
      tone: "extremely-spicy",
      worldSetting: "mars-grocery-store",
      mainCharacter: { mode: "unknown" },
      narration: "second person",
      intensity: "hyper-extreme",
      depth: "infinite",
      learnerLevel: "genius-level",
      language: "",
    });

    expect(parsed.genre).toBe("auto");
    expect(parsed.tone).toBe("auto");
    expect(parsed.worldSetting).toBe("auto");
    expect(parsed.mainCharacter.mode).toBe("auto");
    expect(parsed.narration).toBe("third person");
    expect(parsed.intensity).toBe("balanced");
    expect(parsed.depth).toBe("standard");
    expect(parsed.learnerLevel).toBe("beginner");
    expect(parsed.language).toBe("English");
  });

  it("parses valid custom settings and protagonist accurately", () => {
    const parsed = parseStorySettings({
      genre: "sci-fi",
      tone: "dark",
      worldSetting: "space station",
      mainCharacter: {
        mode: "custom",
        name: "Ren Vance",
        description: "A pragmatic orbital engineer",
      },
      narration: "first person",
      intensity: "lean",
      depth: "quick",
      learnerLevel: "advanced",
      language: "Japanese",
    });

    expect(parsed.genre).toBe("sci-fi");
    expect(parsed.tone).toBe("dark");
    expect(parsed.worldSetting).toBe("space station");
    expect(parsed.mainCharacter.mode).toBe("custom");
    expect(parsed.mainCharacter.name).toBe("Ren Vance");
    expect(parsed.mainCharacter.description).toBe("A pragmatic orbital engineer");
    expect(parsed.narration).toBe("first person");
    expect(parsed.intensity).toBe("lean");
    expect(parsed.depth).toBe("quick");
    expect(parsed.learnerLevel).toBe("advanced");
    expect(parsed.language).toBe("Japanese");
  });
});
