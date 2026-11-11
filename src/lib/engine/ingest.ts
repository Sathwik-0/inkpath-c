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
