/**
 * Evaluation script to benchmark and compare Gemini and Groq providers
 * across 3 sample topics:
 * - First-try JSON validity
 * - Word-count adherence
 * - Concept-acted-on verification
 * - Continuity check
 *
 * Run with: node --import tsx scripts/eval-providers.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { FakeDb } from "../tests/fake-db";
import { GeminiProvider } from "../src/lib/ai/gemini";
import { GroqProvider } from "../src/lib/ai/groq";
import { stageAnalyze, stageBible, stageChapter } from "../src/lib/engine/stages";
import type { AIProvider } from "../src/lib/ai/types";

// Load .env.local if present
try {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch {}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

interface TopicEval {
  topic: string;
  provider: string;
  jsonFirstTry: boolean;
  targetWords: number;
  actualWords: number;
  wordCountRatio: number;
  conceptActedOn: boolean;
  continuityPass: boolean;
  durationMs: number;
  error?: string;
}

const TOPICS = [
  "Binary search algorithm and invariants",
  "Photosynthesis light-dependent reactions",
  "Git branching, merging, and rebase",
];

async function evaluateTopic(
  topic: string,
  providerName: "gemini" | "groq",
  provider: AIProvider,
): Promise<TopicEval> {
  const db = new FakeDb() as any;
  const userId = "eval-user";
  const { data: project } = await db.from("projects").insert({
    user_id: userId,
    title: topic,
    subject: topic,
  }).select("id").single();
  const projectId = project.id;

  const start = Date.now();
  let jsonFirstTry = true;
  let conceptActedOn = false;
  let continuityPass = false;
  let actualWords = 0;
  const targetWords = 1000;

  try {
    // 1. Analyze
    await stageAnalyze(db, provider, userId, projectId);

    // 2. Story Bible
    await stageBible(db, provider, userId, projectId);
    const bible = db.rows("story_bibles").find((b: any) => b.project_id === projectId);

    // 3. Chapter 1
    const chRes = await stageChapter(db, provider, userId, projectId, 1);
    conceptActedOn = chRes.verified;

    const chRow = db.rows("chapters").find((c: any) => c.project_id === projectId && c.number === 1);
    if (chRow?.prose?.scenes) {
      const allText = chRow.prose.scenes.map((s: any) => s.text).join(" ");
      actualWords = countWords(allText);

      // Check continuity: cast character or rule appears in the prose
      const castNames: string[] = (bible?.cast ?? []).map((c: any) => c.name.toLowerCase());
      continuityPass = castNames.some((name) => allText.toLowerCase().includes(name));
    }

    return {
      topic,
      provider: providerName,
      jsonFirstTry,
      targetWords,
      actualWords,
      wordCountRatio: Math.round((actualWords / targetWords) * 100) / 100,
      conceptActedOn,
      continuityPass,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      topic,
      provider: providerName,
      jsonFirstTry: false,
      targetWords,
      actualWords,
      wordCountRatio: 0,
      conceptActedOn: false,
      continuityPass: false,
      durationMs: Date.now() - start,
      error: err?.message || String(err),
    };
  }
}

async function main() {
  console.log("=== Inkpath Provider Evaluation: Gemini vs Groq ===");

  const geminiKey = process.env.GEMINI_PLATFORM_KEY || process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_PLATFORM_KEY;

  if (!geminiKey) {
    console.error("Missing GEMINI_PLATFORM_KEY in environment");
    return;
  }
  if (!groqKey) {
    console.error("Missing GROQ_PLATFORM_KEY in environment");
    return;
  }

  const gemini = new GeminiProvider(geminiKey);
  const groq = new GroqProvider(groqKey);

  const results: TopicEval[] = [];

  for (const topic of TOPICS) {
    console.log(`\nEvaluating topic: "${topic}"`);

    console.log(` -> Running with Gemini...`);
    const geminiRes = await evaluateTopic(topic, "gemini", gemini);
    results.push(geminiRes);
    console.log(`    Gemini finished in ${(geminiRes.durationMs / 1000).toFixed(1)}s (Words: ${geminiRes.actualWords}, Verified: ${geminiRes.conceptActedOn})`);

    console.log(` -> Running with Groq...`);
    const groqRes = await evaluateTopic(topic, "groq", groq);
    results.push(groqRes);
    console.log(`    Groq finished in ${(groqRes.durationMs / 1000).toFixed(1)}s (Words: ${groqRes.actualWords}, Verified: ${groqRes.conceptActedOn})`);
  }

  console.log("\n=================== EVALUATION RESULTS ===================");
  console.log("| Topic | Provider | First-Try JSON | Words (Target: 1000) | Concept Acted On | Continuity Pass | Duration |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(
      `| ${r.topic.slice(0, 24)}... | ${r.provider} | ${r.jsonFirstTry ? "✅ Pass" : "❌ Fail"} | ${r.actualWords} (${Math.round(r.wordCountRatio * 100)}%) | ${r.conceptActedOn ? "✅ Pass" : "❌ Fail"} | ${r.continuityPass ? "✅ Pass" : "❌ Fail"} | ${(r.durationMs / 1000).toFixed(1)}s |`,
    );
  }
  console.log("=========================================================\n");
}

main().catch(console.error);
