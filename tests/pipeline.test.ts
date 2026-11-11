import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db";
import { recordRecall, stageAnalyze, stageBible, stageChapter } from "@/lib/engine/stages";
import type { AIProvider } from "@/lib/ai";

const concepts = ["Base case", "Recursive step", "Call stack"];

function fakeProvider(calls: string[]): AIProvider {
  return {
    name: "gemini",
    validateKey: async () => ({ ok: true, models: [] }),
    generateText: async () => "",
    async generateJson(req: any) {
      const s: string = req.system;
      let raw: any;
      if (s.includes("concept graph")) {
        calls.push("graph");
        raw = {
          title: "Recursion", summary: "s", recommended_genre: "sci-fi", estimated_chapters: 2,
          concepts: [
            { name: "Base case", explanation: "Where recursion stops", objective: "Spot it", kind: "idea", misconceptions: ["Recursion never ends"], prerequisites: [] },
            { name: "Recursive step", explanation: "Shrink the problem", objective: "Write it", prerequisites: ["Base case"] },
            { name: "Call stack", explanation: "Pending calls pile up", objective: "Trace it", prerequisites: ["Recursive step"] },
          ],
        };
      } else if (s.includes("story architect")) {
        calls.push("bible");
        raw = {
          title: "The Echo Vault", logline: "A student unlocks vaults", genre: "sci-fi", voice: "close third, past tense",
          world: "A vault city", central_question: "How do you open the last vault?", ending: "Uses all three",
          rules: concepts.map((c) => ({ concept_name: c, rule: `Rule of ${c}`, visual_anchor: "a door" })),
          cast: [{ name: "Mira", role: "student", want: "w", flaw: "f", speech: "quick" }, { name: "Orrin", role: "keeper", want: "w", flaw: "f", speech: "slow" }],
          chapter_plan: [{ number: 1, title: "The First Door", beat: "b1" }, { number: 2, title: "The Last Vault", beat: "b2" }],
        };
      } else if (s.includes("fact-checker")) {
        calls.push("verify");
        raw = { accurate: true, every_concept_acted_on: true, problems: [] };
      } else if (s.includes("recall questions")) {
        calls.push("recall");
        raw = { questions: [
          { prompt: "q1", options: ["a", "b", "c"], correct_index: 1, explanation: "because", concept_name: "Base case" },
          { prompt: "q2", options: ["a", "b", "c"], correct_index: 0, explanation: "because", concept_name: "Recursive step" },
        ] };
      } else {
        calls.push("chapter");
        raw = {
          title: "Door", hook: "What is behind it?", summary: "Mira opened a door.",
          scenes: [{ heading: "One", text: "x", concepts_applied: ["Base case"] }, { heading: "Two", text: "y" }],
          new_threads: [{ label: "locked vault", concept_name: "Call stack", due_by: 2 }],
        };
      }
      return req.parse(raw);
    },
  } as AIProvider;
}

describe("engine pipeline (in-memory db, fake model)", () => {
  it("runs analyze -> bible -> chapter -> recall -> next chapter", async () => {
    const db = new FakeDb() as any;
    const user = "u1";
    const { data: project } = await db.from("projects").insert({ user_id: user, title: "Recursion", subject: "recursion" }).select("id").single();
    const pid = project.id;
    const calls: string[] = [];
    const ai = fakeProvider(calls);

    await stageAnalyze(db, ai, user, pid);
    expect(db.rows("concepts")).toHaveLength(3);
    expect(db.rows("concept_edges")).toHaveLength(2);

    await stageBible(db, ai, user, pid);
    expect(db.rows("chapters").map((c: any) => c.number)).toEqual([1, 2]);
    expect(db.rows("concepts").every((c: any) => c.world_rule)).toBe(true);

    const r1 = await stageChapter(db, ai, user, pid, 1);
    expect(r1.verified).toBe(true);
    const ch1 = db.rows("chapters").find((c: any) => c.number === 1);
    expect(ch1.status).toBe("ready");
    expect(ch1.prose.scenes).toHaveLength(2);
    expect(db.rows("story_threads")).toHaveLength(1);
    expect(db.rows("learner_concepts").length).toBeGreaterThan(0);
    expect(db.rows("quizzes")).toHaveLength(1);

    const res = await recordRecall(db, user, ch1.id, [1, 2]);
    expect(res.score).toBe(1);
    expect(res.review[0].correctIndex).toBe(1);
    const base = res.concepts.find((c) => c.name === "Base case")!;
    expect(base.correct).toBe(true);
    expect(base.level).toBeGreaterThanOrEqual(1);
    expect(res.concepts.find((c) => c.name === "Recursive step")!.correct).toBe(false);
    expect(db.rows("review_events")).toHaveLength(2);
    expect(db.rows("quiz_attempts")).toHaveLength(1);

    // Chapter 2 is the final chapter: it must pull in whatever is left.
    const r2 = await stageChapter(db, ai, user, pid, 2, new Date(Date.now() + 2 * 86_400_000));
    expect(r2.newConcepts.length).toBeGreaterThan(0);
    expect(r2.reviews).toContain("Recursive step"); // forgotten concept returns
    expect(db.rows("chapters").find((c: any) => c.number === 2).hook).toBeNull();
  });
});
