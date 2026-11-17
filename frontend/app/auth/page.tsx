"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" }).then(response => { if (active && response.ok) router.replace("/studio"); }).catch(() => {});
    return () => { active = false; };
  }, [router]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (!supabase) throw new Error("Sign-in is being configured. Please try again later.");
      const result = mode === "login" ? await supabase.auth.signInWithPassword({ email: email.trim(), password }) : await supabase.auth.signUp({ email: email.trim(), password });
      if (result.error) throw new Error(mode === "login" ? "We couldn't sign you in. Check your email, password, and email confirmation." : "We couldn't create this account. Check the details and try again.");
      if (!result.data.session) { setMessage("Check your email to confirm your account, then return here to sign in. This pilot only admits its workspace owner."); return; }
      const response = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: result.data.session.access_token }) });
      if (!response.ok) {
        await supabase.auth.signOut();
        throw new Error(response.status === 403 ? "This pilot is currently open to its workspace owner only." : "We couldn't open your private workspace. Please try again.");
      }
      router.replace("/studio");
    } catch (error) { setError(error instanceof Error ? error.message : "Sign-in is temporarily unavailable."); }
    finally { setBusy(false); }
  }
  return <main id="workspace" className="workspace-tool workspace-auth"><section><p className="workspace-kicker">YOUR PRIVATE CREATIVE SPACE</p><h1>{mode === "login" ? "Welcome back." : "Set up your owner account."}</h1><p>Sign in to keep your projects, footage, and final cuts behind your verified account.</p><div className="workspace-auth-tabs"><button type="button" aria-pressed={mode === "login"} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Sign in</button><button type="button" aria-pressed={mode === "signup"} onClick={() => { setMode("signup"); setError(""); setMessage(""); }}>Create account</button></div><form onSubmit={submit}><label>Email address<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input required minLength={mode === "signup" ? 8 : 1} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} /></label><button className="workspace-primary" disabled={busy}>{busy ? "Checking your account…" : mode === "login" ? "Open private workspace" : "Create owner account"}</button></form>{error && <p role="alert" className="workspace-error">{error}</p>}{message && <p role="status">{message}</p>}<small>Owner-only pilot. Creating an account does not automatically grant workspace access.</small></section></main>;
}
