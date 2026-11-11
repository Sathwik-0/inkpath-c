import "server-only";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type SourceKind = "pdf" | "docx" | "txt";

export function kindFromName(name: string): SourceKind | null {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "txt" || ext === "md") return "txt";
  return null;
}

export interface IngestedChunk {
  content: string;
  location: string;
  chunkIndex: number;
}

/** Splits long text into chunks on paragraph boundaries so each row stays small. */
export function chunkText(text: string, size = 4000): string[] {
  const paras = text.replace(/\r/g, "").split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) {
      out.push(cur.trim());
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/**
 * Splits text into chunks while preserving paragraph location ranges.
 */
export function chunkTextWithLocations(text: string, size = 4000, prefix = "Paragraphs"): IngestedChunk[] {
  const paras = text.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: IngestedChunk[] = [];
  let cur = "";
  let startIdx = 1;

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if ((cur + "\n\n" + p).length > size && cur) {
      out.push({
        content: cur.trim(),
        location: `${prefix} ${startIdx}-${i}`,
        chunkIndex: out.length,
      });
      cur = p;
      startIdx = i + 1;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }

  if (cur.trim()) {
    out.push({
      content: cur.trim(),
      location: `${prefix} ${startIdx}-${paras.length}`,
      chunkIndex: out.length,
    });
  }

  return out;
}

export async function extractText(kind: SourceKind, data: Buffer): Promise<string> {
  if (kind === "txt") return data.toString("utf8");
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: data });
    return value;
  }
  const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await pdfText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

/**
 * Extracts chunks with precise source locations:
 * - PDF: Page numbers (e.g. "Page 1", "Page 2")
 * - DOCX: Paragraph ranges (e.g. "Paragraphs 1-12")
 * - TXT/Text: Paragraph ranges
 */
export async function extractChunksWithLocations(
  kind: "pdf" | "docx" | "txt" | "text" | "youtube" | "topic",
  data?: Buffer,
  rawText?: string,
): Promise<IngestedChunk[]> {
  if (kind === "pdf" && data) {
    try {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const chunks: IngestedChunk[] = [];

      // Extract page by page to track exact page numbers
      const totalPages = pdf.numPages;
      const { text: pages } = await pdfText(pdf, { mergePages: false });
      const pageList = Array.isArray(pages) ? pages : [pages];

      for (let p = 0; p < totalPages; p++) {
        const pageContent = (pageList[p] ?? "").trim();
        if (!pageContent) continue;

        if (pageContent.length > 4000) {
          const subChunks = chunkText(pageContent, 4000);
          subChunks.forEach((sub, sIdx) => {
            chunks.push({
              content: sub,
              location: `Page ${p + 1} (part ${sIdx + 1})`,
              chunkIndex: chunks.length,
            });
          });
        } else {
          chunks.push({
            content: pageContent,
            location: `Page ${p + 1}`,
            chunkIndex: chunks.length,
          });
        }
      }

      if (chunks.length > 0) return chunks;
    } catch {
      // fallback to whole text
    }
  }

  let text = rawText || "";
  if (!text && data && (kind === "docx" || kind === "txt")) {
    text = await extractText(kind as SourceKind, data);
  }

  if (kind === "docx") {
    return chunkTextWithLocations(text, 4000, "Section / Paragraphs");
  }

  return chunkTextWithLocations(text, 4000, "Paragraphs");
}
