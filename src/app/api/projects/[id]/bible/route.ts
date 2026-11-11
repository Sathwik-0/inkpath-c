import { startJobResponse } from "@/lib/start-job";

export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return startJobResponse(req, id, "bible");
}
