import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db";
import { stageAnalyze, stageBible, stageChapter } from "@/lib/engine/stages";
import type { AIProvider } from "@/lib/ai";

describe("Quality & Safety Pipeline (Parts B, C, D)", () => {
  it("triggers the trim pass when an initial chapter draft is over-length", async () => {
    const db = new FakeDb() as any;
    const user = "u_trim";
    const { data: project } = await db
      .from("projects")
      .insert({
        user_id: user,
        title: "Networks",
        subject: "TCP Handshake",
        settings: { depth: "quick" },
      })
      .select("id")
      .single();

    const calls: string[] = [];

    const longProse = Array(1200)
      .fill("data packet transmitting along the virtual wire with latency.")
      .join(" ");

    const ai: AIProvider = {
      name: "gemini",
      validateKey: async () => ({ ok: true, models: [] }),
      generateText: async () => "",
      async generateJson(req: any) {
        const s: string = req.system;
        if (s.includes("concept graph")) {
          calls.push("graph");
          return req.parse({
            title: "TCP",
            summary: "summary",
            recommended_genre: "sci-fi",
            estimated_chapters: 1,
            concepts: [
              {
                name: "Handshake",
                explanation: "SYN SYN-ACK ACK sequence",
                objective: "trace it",
                kind: "procedure",
                complexity: 1,
                importance: 1,
                misconceptions: ["Immediate transmission"],
                prerequisites: [],
              },
            ],
          });
        }
        if (s.includes("story architect")) {
          calls.push("bible");
          return req.parse({
            title: "The Handshake Protocol",
            logline: "Connecting nodes",
            genre: "sci-fi",
            voice: "third person past",
            world: "Subsea fiber nexus",
            central_question: "Will the packet link?",
            ending: "Link established",
            rules: [{ concept_name: "Handshake", rule: "Rule of handshake", visual_anchor: "three pulses" }],
            cast: [
              { name: "Alex", role: "runner", want: "ping", flaw: "rush", speech: "terse" },
              { name: "Orin", role: "router", want: "sync", flaw: "rigid", speech: "calm" },
            ],
            chapter_plan: [{ number: 1, title: "SYN Pulse", beat: "Connecting" }],
          });
        }
        if (s.includes("line editor")) {
          // This is the TRIM pass
          calls.push("trim");
          return req.parse({
            title: "SYN Pulse",
            hook: "A signal echoed.",
            summary: "Alex initiated the connection.",
            scenes: [
              {
                heading: "Console",
                text: "Alex sent the SYN pulse. The terminal waited.",
                concepts_applied: ["Handshake"],
                concept_action: "Sending connection signal",
              },
              {
                heading: "Response",
                text: "The SYN-ACK returned. Alex confirmed with an ACK.",
                concepts_applied: ["Handshake"],
                concept_action: "Confirming handshake",
              },
            ],
            new_threads: [],
            paid_off_threads: [],
          });
        }
        if (s.includes("story editor") || s.includes("fact-checker")) {
          calls.push("verify");
          return req.parse({
            accurate: true,
            every_concept_acted_on: true,
            continuity_clean: true,
            problems: [],
          });
        }
        if (s.includes("recall questions")) {
          calls.push("recall");
          return req.parse({
            questions: [
              {
                prompt: "When Alex sent the first SYN pulse, why did the terminal wait?",
                options: ["Awaiting SYN-ACK", "Out of power", "Cable cut"],
                correct_index: 0,
                explanation: "TCP requires confirmation before data flows.",
                concept_name: "Handshake",
                evidence: "Alex sent the SYN pulse. The terminal waited.",
              },
            ],
          });
        }
        // Chapter writer: Return an over-length draft
        calls.push("chapter_draft");
        return req.parse({
          title: "SYN Pulse",
          hook: "A signal echoed.",
          summary: "Alex initiated connection.",
          scenes: [
            {
              heading: "One",
              text: longProse, // ~1200 words, way above the quick target of ~400-500 words
              concepts_applied: ["Handshake"],
            },
            {
              heading: "Two",
              text: "Second scene waiting.",
              concepts_applied: ["Handshake"],
            },
          ],
          new_threads: [],
          paid_off_threads: [],
        });
      },
    } as any;

    await stageAnalyze(db, ai, user, project.id);
    await stageBible(db, ai, user, project.id);
    await stageChapter(db, ai, user, project.id, 1);

    expect(calls).toContain("chapter_draft");
    expect(calls).toContain("trim"); // Trim pass was invoked!
  });

  it("triggers one rewrite when a continuity failure is flagged", async () => {
    const db = new FakeDb() as any;
    const user = "u_continuity";
    const { data: project } = await db
      .from("projects")
      .insert({
        user_id: user,
        title: "Countdown Timer",
        subject: "State machine",
      })
      .select("id")
      .single();

    let verifyAttempt = 0;
    let draftAttempt = 0;

    const ai: AIProvider = {
      name: "gemini",
      validateKey: async () => ({ ok: true, models: [] }),
      generateText: async () => "",
      async generateJson(req: any) {
        const s: string = req.system;
        if (s.includes("concept graph")) {
          return req.parse({
            title: "State",
            summary: "summary",
            recommended_genre: "thriller",
            estimated_chapters: 1,
            concepts: [
              {
                name: "Transitions",
                explanation: "Valid states only",
                objective: "trace",
                kind: "idea",
                complexity: 1,
                importance: 1,
                misconceptions: [],
                prerequisites: [],
              },
            ],
          });
        }
        if (s.includes("story architect")) {
          return req.parse({
            title: "The Clock",
            logline: "A ticking timer",
            genre: "thriller",
            voice: "close third",
            world: "Subway tunnels",
            central_question: "Can it stop?",
            ending: "Clock stops",
            rules: [{ concept_name: "Transitions", rule: "Rule of state", visual_anchor: "switch" }],
            cast: [
              { name: "Sam", role: "engineer", want: "stop", flaw: "haste", speech: "fast" },
              { name: "Maya", role: "dispatcher", want: "order", flaw: "cold", speech: "calm" },
            ],
            chapter_plan: [{ number: 1, title: "The Tick", beat: "Starting clock" }],
          });
        }
        if (s.includes("story editor") || s.includes("fact-checker")) {
          verifyAttempt++;
          if (verifyAttempt === 1) {
            // First check fails continuity: countdown counted up
            return req.parse({
              accurate: true,
              every_concept_acted_on: true,
              continuity_clean: false,
              problems: [{ concept_name: "Transitions", issue: "Countdown timer counted up from 5 to 10." }],
              fix_instructions: "Make the countdown timer count down from 10 to 5.",
            });
          }
          // Second check succeeds
          return req.parse({
            accurate: true,
            every_concept_acted_on: true,
            continuity_clean: true,
            problems: [],
          });
        }
        if (s.includes("recall questions")) {
          return req.parse({
            questions: [
              {
                prompt: "Why did the switch fail to transition?",
                options: ["Invalid state", "Power off"],
                correct_index: 0,
                explanation: "Only valid transitions allowed.",
                concept_name: "Transitions",
                evidence: "Sam toggled the switch into an invalid state.",
              },
            ],
          });
        }

        // Chapter drafts
        draftAttempt++;
        return req.parse({
          title: "The Tick",
          hook: "The timer blinked.",
          summary: "Sam handled the transition.",
          scenes: [
            {
              heading: "Panel",
              text: draftAttempt === 1 ? "The countdown rose to 10." : "The countdown dropped to 5.",
              concepts_applied: ["Transitions"],
              concept_action: "flipping switch",
            },
            {
              heading: "Resolution",
              text: "The transition locked safely into place.",
              concepts_applied: ["Transitions"],
            },
          ],
          new_threads: [],
          paid_off_threads: [],
        });
      },
    } as any;

    await stageAnalyze(db, ai, user, project.id);
    await stageBible(db, ai, user, project.id);
    const result = await stageChapter(db, ai, user, project.id, 1);

    expect(draftAttempt).toBe(2); // Rewrote once
    expect(verifyAttempt).toBe(2); // Re-verified
    expect(result.verified).toBe(true);
  });

  it("rejects recall questions that lack valid evidence from the chapter and regenerates", async () => {
    const db = new FakeDb() as any;
    const user = "u_recall";
    const { data: project } = await db
      .from("projects")
      .insert({
        user_id: user,
        title: "Memory",
        subject: "Pointers",
      })
      .select("id")
      .single();

    let recallAttempts = 0;

    const ai: AIProvider = {
      name: "gemini",
      validateKey: async () => ({ ok: true, models: [] }),
      generateText: async () => "",
      async generateJson(req: any) {
        const s: string = req.system;
        if (s.includes("concept graph")) {
          return req.parse({
            title: "Memory Vault",
            summary: "summary",
            recommended_genre: "sci-fi",
            estimated_chapters: 1,
            concepts: [
              {
                name: "Pointers",
                explanation: "An address in memory",
                objective: "dereference",
                kind: "idea",
                complexity: 1,
                importance: 1,
                misconceptions: ["Pointers hold the actual object"],
                prerequisites: [],
              },
            ],
          });
        }
        if (s.includes("story architect")) {
          return req.parse({
            title: "Memory Vault",
            logline: "Address lookups",
            genre: "sci-fi",
            voice: "third person",
            world: "Vault 0",
            central_question: "Can we find the address?",
            ending: "Found",
            rules: [{ concept_name: "Pointers", rule: "Rule of address", visual_anchor: "hex tablet" }],
            cast: [
              { name: "Ada", role: "hacker", want: "access", flaw: "impatience", speech: "sharp" },
              { name: "Kip", role: "archivist", want: "preserve", flaw: "timid", speech: "slow" },
            ],
            chapter_plan: [{ number: 1, title: "The Tablet", beat: "Decoding address" }],
          });
        }
        if (s.includes("story editor") || s.includes("fact-checker")) {
          return req.parse({
            accurate: true,
            every_concept_acted_on: true,
            continuity_clean: true,
            problems: [],
          });
        }
        if (s.includes("recall questions")) {
          recallAttempts++;
          if (recallAttempts === 1) {
            // First attempt: missing evidence ("")
            return req.parse({
              questions: [
                {
                  prompt: "What was written on Ada's tablet?",
                  options: ["An address", "A photo"],
                  correct_index: 0,
                  explanation: "Because pointers store addresses.",
                  concept_name: "Pointers",
                  evidence: "", // Invalid empty evidence!
                },
              ],
            });
          }
          // Second attempt: includes valid evidence from chapter
          return req.parse({
            questions: [
              {
                prompt: "When Ada unlocked Vault 0, what did the hex tablet store?",
                options: ["A memory address", "The actual payload"],
                correct_index: 0,
                explanation: "Pointers hold addresses rather than data.",
                concept_name: "Pointers",
                evidence: "Ada read the hex address off the tablet to dereference the lock.",
              },
            ],
          });
        }

        // Chapter
        return req.parse({
          title: "The Tablet",
          hook: "Vault 0 hummed.",
          summary: "Ada solved the pointer address.",
          scenes: [
            {
              heading: "Chamber",
              text: "Ada read the hex address off the tablet to dereference the lock.",
              concepts_applied: ["Pointers"],
              concept_action: "dereferencing hex address",
            },
            {
              heading: "Gate",
              text: "The heavy vault door unlocked.",
              concepts_applied: ["Pointers"],
            },
          ],
          new_threads: [],
          paid_off_threads: [],
        });
      },
    } as any;

    await stageAnalyze(db, ai, user, project.id);
    await stageBible(db, ai, user, project.id);
    await stageChapter(db, ai, user, project.id, 1);

    expect(recallAttempts).toBe(2); // First failed evidence check and was regenerated
    const quiz = db.rows("quizzes").find((q: any) => q.chapter_id);
    expect(quiz.questions[0].evidence).toBe(
      "Ada read the hex address off the tablet to dereference the lock.",
    );
  });
});
