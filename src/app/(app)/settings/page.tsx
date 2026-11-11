import { createClient } from "@/lib/supabase/server";
import { Keys } from "./Keys";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI keys" };

export default async function Settings() {
  const supabase = await createClient();
  const [{ data: connections }, { data: free }] = await Promise.all([
    supabase.from("provider_connections").select("provider,key_mask,status,capabilities"),
    supabase.rpc("free_status"),
  ]);
  const f = (free as { total: number; used: number; remaining: number } | null) ?? { total: 3, used: 0, remaining: 3 };
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg">AI keys</h1>
      <p className="mt-2 text-body-lg text-on-surface-variant">
        You get {f.total} free chapters ({f.remaining} left). After that, connect your own key and keep reading at your provider's price. Keys are encrypted and never shown again.
      </p>
      <Keys connections={(connections ?? []) as { provider: string; key_mask: string; status: string }[]} />
    </div>
  );
}
