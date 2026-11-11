import { startJobResponse } from "@/lib/start-job";
import { fail } from "@/lib/api";

export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await ctx.params;
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > 12) return fail("Bad chapter number", 400);
  return startJobResponse(req, id, "chapter", num);
}
