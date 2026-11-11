"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { btn, input, ErrorNote } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/library";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const supabase = createClient();
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else { router.push(next.startsWith("/") && !next.startsWith("//") ? next : "/library"); router.refresh(); }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) setError(error.message);
      else if (data.session) { router.push("/library"); router.refresh(); }
      else setNotice("Check your email to confirm your account, then sign in.");
    }
    setBusy(false);
  }

  async function google() {
    await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-margin-mobile">
      <h1 className="font-display-xl-mobile text-display-xl-mobile text-primary">Inkpath</h1>
      <p className="mt-2 text-body-lg text-on-surface-variant">
        {mode === "login" ? "Welcome back. Pick up your story." : "Turn anything you need to learn into a story you finish."}
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <input className={input} type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorNote>{error}</ErrorNote>
        {notice && <p className="rounded-xl border border-tertiary/40 px-4 py-3 text-body-md text-tertiary">{notice}</p>}
        <button className={`${btn} w-full`} disabled={busy}>{busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <button type="button" onClick={google} className="w-full rounded-xl border border-outline-variant px-5 py-3 font-label-md text-label-md hover:bg-surface-container-high">Continue with Google</button>
      </form>
      <p className="mt-6 text-body-md text-on-surface-variant">
        {mode === "login" ? <>New here? <Link className="text-primary" href="/signup">Create an account</Link></> : <>Already have an account? <Link className="text-primary" href="/login">Sign in</Link></>}
      </p>
      <p className="mt-4 text-xs text-outline leading-relaxed text-center">
        For free chapters paid by the platform, learning content may be processed by Google and Groq.
      </p>
    </div>
  );
}
