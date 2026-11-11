import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUser, fail, json } from "@/lib/api";
import { PROVIDERS, ProviderError, createProvider, userMessage, PROVIDER_LABEL, type ProviderName } from "@/lib/ai";
import { MODELS } from "@/lib/ai/config";
import { keyAad, maskKey, sealSecret } from "@/lib/crypto";

export const maxDuration = 30;

const Body = z.object({
  provider: z.enum(PROVIDERS as [string, ...string[]]),
  key: z.string().trim().min(20).max(400).regex(/^\S+$/),
});

/** Lists connections. The ciphertext is never selected here: only the mask and status. */
export async function GET() {
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  const { data } = await auth.supabase
    .from("provider_connections")
    .select("provider,key_mask,status,capabilities,last_validated_at");
  return json({ connections: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await currentUser();
  if (!auth) return fail("Please sign in.", 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("That does not look like an API key. Paste the whole key with no spaces.", 400);
  const { provider: name, key } = parsed.data as { provider: ProviderName; key: string };

  let models: string[] = [];
  try {
    models = (await createProvider(name, key).validateKey()).models;
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : "network";
    return fail(userMessage(code, PROVIDER_LABEL[name]), code === "invalid_key" ? 400 : 502, { code });
  }

  // Image access is only known for sure after a real image call, so a visible image model is "untested", not "yes".
  const imageModelVisible = name === "gemini" && models.some((m) => m.includes(MODELS.gemini.image));
  const sealed = sealSecret(key, keyAad(auth.user.id, name));
  const { error } = await createAdminClient().from("provider_connections").upsert(
    {
      user_id: auth.user.id, provider: name,
      key_ciphertext: sealed.ciphertext, key_iv: sealed.iv, key_tag: sealed.tag,
      key_mask: maskKey(key), status: "connected",
      capabilities: { text: true, image: imageModelVisible ? null : false },
      models: { count: models.length },
      last_validated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
  if (error) return fail("Could not save the key.", 500);
  return json({ provider: name, mask: maskKey(key), status: "connected" }, 201);
}
