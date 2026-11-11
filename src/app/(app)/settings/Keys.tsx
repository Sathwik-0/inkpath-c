"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn, btnGhost, card, input, ErrorNote } from "@/components/ui";

const PROVIDERS = [
  { id: "gemini", name: "Google Gemini", help: "Create a key at aistudio.google.com/apikey. Free keys work for text; illustrated images need billing." },
  { id: "openai", name: "OpenAI", help: "Create a key at platform.openai.com/api-keys." },
  { id: "anthropic", name: "Anthropic Claude", help: "Create a key at console.anthropic.com." },
  { id: "groq", name: "Groq", help: "Create a key at console.groq.com/keys for ultra-fast Llama models." },
];

export function Keys({ connections }: { connections: { provider: string; key_mask: string; status: string }[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<Record<string, string>>({});

  async function save(provider: string) {
    setBusy(provider); setError((e) => ({ ...e, [provider]: "" }));
    const r = await fetch("/api/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, key: values[provider] ?? "" }) });
    const body = await r.json();
    if (!r.ok) setError((e) => ({ ...e, [provider]: body.error ?? "Could not save." }));
    else { setValues((v) => ({ ...v, [provider]: "" })); router.refresh(); }
    setBusy("");
  }
  async function remove(provider: string) {
    setBusy(provider);
    await fetch(`/api/providers/${provider}`, { method: "DELETE" });
    setBusy(""); router.refresh();
  }

  return (
    <div className="mt-8 space-y-gutter-mobile">
      {PROVIDERS.map((p) => {
        const c = connections.find((x) => x.provider === p.id);
        return (
          <div key={p.id} className={card}>
            <div className="flex items-center justify-between">
              <h2 className="font-title-md text-title-md">{p.name}</h2>
              {c && <span className="font-label-sm text-label-sm uppercase text-tertiary">Connected · {c.key_mask}</span>}
            </div>
            <p className="mt-1 text-body-sm text-on-surface-variant">{p.help}</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input className={input} type="password" autoComplete="off" spellCheck={false} placeholder={c ? "Paste a new key to replace" : "Paste your API key"}
                value={values[p.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))} />
              <button className={btn} disabled={busy === p.id || (values[p.id] ?? "").length < 20} onClick={() => save(p.id)}>{busy === p.id ? "Checking…" : "Save"}</button>
              {c && <button className={btnGhost} disabled={busy === p.id} onClick={() => remove(p.id)}>Remove</button>}
            </div>
            <div className="mt-3"><ErrorNote>{error[p.id]}</ErrorNote></div>
          </div>
        );
      })}
    </div>
  );
}
