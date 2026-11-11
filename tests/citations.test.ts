import { describe, expect, it } from "vitest";
import {
  verifyQuoteInChunk,
  validateConceptCitations,
  parseStoredConceptSource,
  parseStoredCitations,
  type SourceMapping,
} from "@/lib/engine/citations";
import { VerifySchema, RecallSchema } from "@/lib/engine/novel-schemas";
import { FakeDb } from "./fake-db";
import { stageAnalyze, stageChapter } from "@/lib/engine/stages";
import type { AIProvider } from "@/lib/ai";

describe("Citations and Source Validation (Parts 1, 2, 3, 4, 5)", () => {
  const sampleChunk = `
    The Transmission Control Protocol (TCP) uses a three-way handshake to establish a connection.
    Specifically, the client sends a SYN packet, the server responds with a SYN-ACK packet,
    and finally the client acknowledges with an ACK packet. Sequence numbers are synchronized during this exchange.
  `;

  describe("verifyQuoteInChunk", () => {
    it("accepts a verbatim excerpt from the source chunk", () => {
      const quote = "client sends a SYN packet, the server responds with a SYN-ACK packet";
      expect(verifyQuoteInChunk(quote, sampleChunk)).toBe(true);
    });

    it("accepts verbatim quote with different case and spacing", () => {
      const quote = "CLIENT  sends a syn packet,   the server responds";
      expect(verifyQuoteInChunk(quote, sampleChunk)).toBe(true);
    });

    it("rejects a fake or hallucinated quote not present in the chunk", () => {
      const fakeQuote = "the protocol transmits directly over quantum entanglement channels";
      expect(verifyQuoteInChunk(fakeQuote, sampleChunk)).toBe(false);
    });

    it("rejects quotes exceeding the 25-word limit", () => {
      // 26 words
      const longQuote = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six";
      expect(verifyQuoteInChunk(longQuote, sampleChunk)).toBe(false);
    });

    it("rejects empty or whitespace-only quotes", () => {
      expect(verifyQuoteInChunk("", sampleChunk)).toBe(false);
      expect(verifyQuoteInChunk("   ", sampleChunk)).toBe(false);
    });
  });

  describe("validateConceptCitations", () => {
    const sources: SourceMapping[] = [
      {
        sourceId: "S1",
        title: "Networking 101",
        type: "pdf",
        urlOrFilename: "networking101.pdf",
      },
    ];

    const chunks = [
      {
        location: "Page 4",
        content: sampleChunk,
      },
    ];

    it("drops citations whose quotes do not exist in the source chunk", () => {
      const rawCitations = [
        {
          source_id: "S1",
          location: "Page 4",
          quote: "hallucinated statement never stated anywhere in the source",
        },
      ];

      const result = validateConceptCitations(rawCitations, chunks, sources, false);
      expect(result.citations).toHaveLength(0);
      expect(result.isUnsourced).toBe(true);
      expect(result.statusLabel).toBe("unsourced");
    });

    it("preserves valid verbatim citations and attaches source metadata", () => {
      const rawCitations = [
        {
          source_id: "S1",
          location: "Page 4",
          quote: "client acknowledges with an ACK packet",
        },
        {
          source_id: "S1",
          location: "Page 4",
          quote: "fake quote that will be dropped",
        },
      ];

      const result = validateConceptCitations(rawCitations, chunks, sources, false);
      expect(result.citations).toHaveLength(1);
      expect(result.isUnsourced).toBe(false);
      expect(result.citations[0].quote).toBe("client acknowledges with an ACK packet");
      expect(result.citations[0].sourceTitle).toBe("Networking 101");
      expect(result.citations[0].location).toBe("Page 4");
    });

    it("labels topic-only concepts as from general knowledge without fabricating URLs", () => {
      const result = validateConceptCitations([], [], [], true);
      expect(result.citations).toHaveLength(0);
      expect(result.isUnsourced).toBe(true);
      expect(result.sourceStatus).toBe("general_knowledge");
      expect(result.statusLabel).toBe("from general knowledge, not independently sourced");
      // Never fabricate a URL
      for (const cit of result.citations) {
        expect(cit.sourceUrl).toBeUndefined();
      }
    });
  });

  describe("parseStoredConceptSource", () => {
    it("correctly parses JSON stored in concept source_ref", () => {
      const stored = JSON.stringify({
        citations: [
          {
            source_id: "S1",
            location: "Page 4",
            quote: "client sends a SYN packet",
            verified: true,
            sourceTitle: "Networking 101",
          },
        ],
        isUnsourced: false,
        statusLabel: "sourced",
      });

      const parsed = parseStoredConceptSource(stored);
      expect(parsed.isUnsourced).toBe(false);
      expect(parsed.citations).toHaveLength(1);
      expect(parsed.citations[0].quote).toBe("client sends a SYN packet");
    });

    it("gracefully falls back when source_ref is empty or null", () => {
      const empty = parseStoredConceptSource(null);
      expect(empty.isUnsourced).toBe(true);
      expect(empty.citations).toHaveLength(0);
      expect(empty.statusLabel).toBe("from general knowledge, not independently sourced");
    });
  });

  describe("Fact boundaries and Verifier schema", () => {
    it("validates Verifier schema requiring fact_boundaries_clean and unsupported_facts", () => {
      const validVerify = {
        accurate: true,
        every_concept_acted_on: true,
        continuity_clean: true,
        fact_boundaries_clean: true,
        no_in_text_citations: true,
        unsupported_facts: [],
        problems: [],
      };
      const parsed = VerifySchema.parse(validVerify);
      expect(parsed.fact_boundaries_clean).toBe(true);
      expect(parsed.no_in_text_citations).toBe(true);
      expect(parsed.unsupported_facts).toHaveLength(0);
    });

    it("rejects or flags chapters with unsupported facts beyond concept definitions", () => {
      const flaggedVerify = {
        accurate: false,
        every_concept_acted_on: true,
        continuity_clean: true,
        fact_boundaries_clean: false,
        no_in_text_citations: true,
        unsupported_facts: ["Introduced unsubstantiated claim about quantum routing"],
        problems: [
          {
            concept_name: "TCP",
            quote: "quantum routing",
            issue: "technical claim not supported by source or concept definition",
          },
        ],
      };
      const parsed = VerifySchema.parse(flaggedVerify);
      expect(parsed.fact_boundaries_clean).toBe(false);
      expect(parsed.unsupported_facts).toHaveLength(1);
    });
  });

  describe("Recall questions schema with source quote support", () => {
    it("parses recall question with source_quote and evidence", () => {
      const recallData = {
        questions: [
          {
            prompt: "What packet does the client send first in the handshake?",
            options: ["SYN", "ACK", "FIN", "RST"],
            correct_index: 0,
            concept_name: "TCP Handshake",
            explanation: "The three-way handshake initiates with the client transmitting a SYN packet.",
            evidence: "the client sends a SYN packet",
            source_quote: "the client sends a SYN packet",
          },
        ],
      };
      const parsed = RecallSchema.parse(recallData);
      expect(parsed.questions[0].source_quote).toBe("the client sends a SYN packet");
      expect(parsed.questions[0].evidence).toBe("the client sends a SYN packet");
    });
  });

  describe("Integration pipeline with stubbed model", () => {
    it("drops hallucinated citations during stageAnalyze and tags unsourced concepts", async () => {
      const db = new FakeDb() as any;
      const user = "u_citations_test";

      // Insert project with source chunks
      const { data: project } = await db
        .from("projects")
        .insert({
          user_id: user,
          title: "Operating Systems",
          subject: "Virtual Memory",
          settings: {
            sources: [
              {
                sourceId: "S1",
                title: "OS Concepts",
                type: "pdf",
                urlOrFilename: "os.pdf",
              },
            ],
          },
        })
        .select("id")
        .single();

      await db.from("extracted_content").insert({
        project_id: project.id,
        chunk_index: 0,
        location: "Page 42",
        content: "Paging divides physical memory into fixed-size frames and virtual memory into pages.",
      });

      const fakeAi: AIProvider = {
        name: "gemini",
        validateKey: async () => ({ ok: true, models: [] }),
        generateText: async () => "",
        async generateJson(req: any) {
          // Model returns one valid quote and one fake quote
          return req.parse({
            title: "Virtual Memory",
            summary: "Memory paging",
            recommended_genre: "sci-fi",
            estimated_chapters: 1,
            concepts: [
              {
                name: "Paging",
                explanation: "Dividing memory into pages and frames",
                objective: "understand paging",
                kind: "concept",
                complexity: 1,
                importance: 1,
                misconceptions: [],
                prerequisites: [],
                citations: [
                  {
                    source_id: "S1",
                    location: "Page 42",
                    quote: "Paging divides physical memory into fixed-size frames", // Valid
                  },
                ],
              },
              {
                name: "Hallucinated Concept",
                explanation: "An invented concept with fake citation",
                objective: "test rejection",
                kind: "concept",
                complexity: 1,
                importance: 2,
                misconceptions: [],
                prerequisites: [],
                citations: [
                  {
                    source_id: "S1",
                    location: "Page 42",
                    quote: "nonexistent text that does not appear in chunk", // Fake -> must be dropped
                  },
                ],
              },
            ],
          });
        },
      };

      await stageAnalyze(db, fakeAi, user, project.id);

      const { data: concepts } = await db.from("concepts").select("*").eq("project_id", project.id);
      expect(concepts).toHaveLength(2);

      const paging = concepts.find((c: any) => c.name === "Paging");
      const fake = concepts.find((c: any) => c.name === "Hallucinated Concept");

      const pagingMeta = parseStoredConceptSource(paging.source_ref);
      expect(pagingMeta.isUnsourced).toBe(false);
      expect(pagingMeta.citations).toHaveLength(1);
      expect(pagingMeta.citations[0].quote).toBe("Paging divides physical memory into fixed-size frames");

      const fakeMeta = parseStoredConceptSource(fake.source_ref);
      expect(fakeMeta.isUnsourced).toBe(true);
      expect(fakeMeta.citations).toHaveLength(0);
      expect(fakeMeta.statusLabel).toBe("unsourced");
    });
  });
});
