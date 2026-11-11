/**
 * Source citation validation and tracking for Inkpath.
 *
 * GOAL:
 * Every factual claim the story teaches must be traceable to a source the learner can open.
 * The story is fiction; the facts inside it must not be.
 * Never invent a citation. A missing citation is acceptable. A fake one is not.
 */

export interface SourceMapping {
  sourceId: string; // e.g. "S1", "S2"
  title: string;
  type: "pdf" | "docx" | "txt" | "text" | "youtube" | "web" | "topic";
  urlOrFilename: string;
}

export interface RawCitation {
  source_id?: string;
  location?: string;
  quote?: string;
}

export interface ConceptCitation {
  source_id: string;
  location: string;
  quote: string;
  verified: boolean;
  sourceTitle?: string;
  sourceUrl?: string;
}

export interface ValidatedConceptSources {
  citations: ConceptCitation[];
  isUnsourced: boolean;
  sourceStatus: "sourced" | "unsourced" | "general_knowledge";
  statusLabel: string;
}

/**
 * Normalizes text for verbatim quote matching (stripping punctuation, collapse whitespace, lowercase).
 */
export function normalizeTextForSearch(s: string | null | undefined): string {
  if (!s || typeof s !== "string") return "";
  return s
    .toLowerCase()
    .replace(/['"“”‘’`]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Verifies that a quote (at most 25 words) actually appears verbatim in the chunk text.
 */
export function verifyQuoteInChunk(quote: string, chunkContent: string): boolean {
  if (!quote || typeof quote !== "string") return false;
  if (!chunkContent || typeof chunkContent !== "string") return false;
  const trimmed = quote.trim();
  if (trimmed.length === 0) return false;

  // Max 25 words constraint
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 25) return false;

  const normalizedQuote = normalizeTextForSearch(trimmed);
  const normalizedChunk = normalizeTextForSearch(chunkContent);

  // Must have meaningful content to search
  if (normalizedQuote.length < 4) return false;

  return normalizedChunk.includes(normalizedQuote);
}

/**
 * Validates in code: checks if the citation quote actually appears in any stored chunk at that location or source.
 * Drops any citation that fails verification.
 */
export function validateConceptCitations(
  rawCitations: RawCitation[] | undefined,
  chunks: { content: string; location?: string | null; source_id?: string }[],
  sources: SourceMapping[],
  isTopicOnly = false,
): ValidatedConceptSources {
  if (isTopicOnly || chunks.length === 0) {
    return {
      citations: [],
      isUnsourced: true,
      sourceStatus: "general_knowledge",
      statusLabel: "from general knowledge, not independently sourced",
    };
  }

  const sourcesById = new Map(
    (sources ?? []).map((s) => [((s.sourceId ?? (s as any).source_id ?? "") as string).toUpperCase(), s])
  );
  const defaultSource = sources?.[0];

  const validCitations: ConceptCitation[] = [];

  for (const raw of rawCitations ?? []) {
    const rawQuote = (raw.quote ?? "").trim();
    if (!rawQuote) continue;

    const sourceId = (raw.source_id ?? defaultSource?.sourceId ?? "S1").toUpperCase();
    const source = sourcesById.get(sourceId) ?? defaultSource;

    // Check if the quote actually appears in the chunk content at the specified location (or matching chunk)
    let foundMatch = false;
    let verifiedLocation = (raw.location ?? "").trim();

    for (const chunk of chunks) {
      if (verifyQuoteInChunk(rawQuote, chunk.content)) {
        foundMatch = true;
        if (!verifiedLocation && chunk.location) {
          verifiedLocation = chunk.location;
        }
        break;
      }
    }

    if (foundMatch) {
      validCitations.push({
        source_id: source?.sourceId ?? "S1",
        location: verifiedLocation || source?.urlOrFilename || "Source document",
        quote: rawQuote,
        verified: true,
        sourceTitle: source?.title,
        sourceUrl: source?.type === "web" || source?.type === "youtube" ? source.urlOrFilename : undefined,
      });
    }
  }

  if (validCitations.length === 0) {
    return {
      citations: [],
      isUnsourced: true,
      sourceStatus: "unsourced",
      statusLabel: "unsourced",
    };
  }

  return {
    citations: validCitations,
    isUnsourced: false,
    sourceStatus: "sourced",
    statusLabel: "sourced",
  };
}

/**
 * Helper to safely extract full citation metadata from concept source_ref.
 */
export function parseStoredConceptSource(sourceRef: string | null | undefined): {
  citations: ConceptCitation[];
  isUnsourced: boolean;
  statusLabel: string;
} {
  if (!sourceRef) {
    return {
      citations: [],
      isUnsourced: true,
      statusLabel: "from general knowledge, not independently sourced",
    };
  }
  try {
    if (sourceRef.startsWith("{") || sourceRef.startsWith("[")) {
      const parsed = JSON.parse(sourceRef);
      if (Array.isArray(parsed)) {
        return {
          citations: parsed,
          isUnsourced: parsed.length === 0,
          statusLabel: parsed.length === 0 ? "unsourced" : "sourced",
        };
      }
      return {
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        isUnsourced: typeof parsed.isUnsourced === "boolean" ? parsed.isUnsourced : !parsed.citations?.length,
        statusLabel: parsed.statusLabel || (parsed.citations?.length ? "sourced" : "from general knowledge, not independently sourced"),
      };
    }
  } catch {}
  return {
    citations: [],
    isUnsourced: true,
    statusLabel: "from general knowledge, not independently sourced",
  };
}

/**
 * Helper to safely extract citations from concept source_ref.
 */
export function parseStoredCitations(sourceRef: string | null | undefined): ConceptCitation[] {
  if (!sourceRef) return [];
  try {
    if (sourceRef.startsWith("{") || sourceRef.startsWith("[")) {
      const parsed = JSON.parse(sourceRef);
      if (Array.isArray(parsed)) return parsed;
      if (parsed.citations && Array.isArray(parsed.citations)) return parsed.citations;
    }
  } catch {}
  return [];
}
