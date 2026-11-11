import { describe, expect, it } from "vitest";
import { BibleSchema, ChapterSchema, ConceptGraphSchema, RecallSchema } from "@/lib/engine/novel-schemas";

describe("novel schemas", () => {
  it("normalises a sloppy concept graph", () => {
    const g = ConceptGraphSchema.parse({
      title: " Recursion ", summary: "s", recommended_genre: "Sci Fi", estimated_chapters: "3",
      concepts: [{ name: "Base case", explanation: "e", objective: "o", kind: "weird", misconceptions: ["a", "b", "c", "d"] }],
    });
    expect(g.recommended_genre).toBe("sci-fi");
    expect(g.estimated_chapters).toBe(3);
    expect(g.concepts[0].kind).toBe("idea");
    expect(g.concepts[0].misconceptions).toHaveLength(3);
    expect(g.concepts[0].prerequisites).toEqual([]);
  });

  it("rejects a chapter with a single scene", () => {
    expect(() => ChapterSchema.parse({ title: "t", scenes: [{ heading: "h", text: "x" }], hook: "h", summary: "s" })).toThrow();
  });

  it("accepts a chapter and defaults thread lists", () => {
    const c = ChapterSchema.parse({
      title: "t", hook: "h", summary: "s",
      scenes: [{ heading: "a", text: "x" }, { heading: "b", text: "y", concepts_applied: ["Base case"] }],
    });
    expect(c.new_threads).toEqual([]);
    expect(c.scenes[1].concepts_applied).toEqual(["Base case"]);
  });

  it("rejects a recall question whose answer index is out of range", () => {
    expect(() =>
      RecallSchema.parse({ questions: [
        { prompt: "p", options: ["a", "b"], correct_index: 2, explanation: "e", concept_name: "c" },
        { prompt: "p", options: ["a", "b"], correct_index: 0, explanation: "e", concept_name: "c" },
      ] }),
    ).toThrow();
  });

  it("requires every world rule to name a concept", () => {
    expect(() => BibleSchema.parse({ title: "t" })).toThrow();
  });
});
