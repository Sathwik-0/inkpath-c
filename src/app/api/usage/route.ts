import { currentUser, fail, json } from "@/lib/api";

export async function GET() {
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  const { data } = await auth.supabase.rpc("free_status");
  return json({ free: data ?? { total: 3, used: 0, remaining: 3 } });
}
