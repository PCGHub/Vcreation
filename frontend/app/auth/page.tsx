"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authErrorMessage } from "@/lib/auth-errors";

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
  async function sessionError(response: Response) {
    let data: { detail?: string; code?: string } = {};
    try { data = await response.json(); } catch { /* A hosting/proxy response is not a password error. */ }
    return new Error(`${data.detail || "Vcreation could not establish your workspace session."} (Support: ${data.code || "SESSION_HTTP_" + response.status})`);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (!supabase) throw new Error("Sign-in is being configured. Please try again later.");
      const result = mode === "login" ? await supabase.auth.signInWithPassword({ email: email.trim(), password }) : await supabase.auth.signUp({ email: email.trim(), password });
      if (result.error) {
        const code = result.error.code || (result.error.status ? `auth_${result.error.status}` : "connection_error");
        throw new Error(`${authErrorMessage(result.error, mode === "signup")} (Error: ${code})`);
      }
      if (!result.data.session) { setMessage("Check your email to confirm your account, then return here to sign in. This pilot only admits its workspace owner."); return; }
      const response = await fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: result.data.session.access_token }) });
      // A temporary server verification failure must not globally sign the user out.
      if (!response.ok) throw await sessionError(response);
      // Confirm that the browser retained the HttpOnly cookie before navigating.
      const confirmed = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
      if (!confirmed.ok) {
        const retained = await confirmed.clone().json().catch(() => ({}));
        if (confirmed.status === 401 && (!retained.code || retained.code === "SESSION_MISSING")) throw new Error("Your account signed in, but the browser session wasn't retained. (Support: COOKIE_NOT_RETAINED)");
        throw await sessionError(confirmed);
      }
      router.replace("/studio");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Sign-in is temporarily unavailable."); }
    finally { setBusy(false); }
  }
  return <main id="workspace" className="workspace-tool workspace-auth"><section><p className="workspace-kicker">YOUR PRIVATE CREATIVE SPACE</p><h1>{mode === "login" ? "Welcome back." : "Set up your owner account."}</h1><p>Sign in to keep your projects, footage, and final cuts behind your verified account.</p><div className="workspace-auth-tabs"><button type="button" aria-pressed={mode === "login"} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Sign in</button><button type="button" aria-pressed={mode === "signup"} onClick={() => { setMode("signup"); setError(""); setMessage(""); }}>Create account</button></div><form onSubmit={submit}><label>Email address<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input required minLength={mode === "signup" ? 8 : 1} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} /></label><button className="workspace-primary" disabled={busy}>{busy ? "Checking your account…" : mode === "login" ? "Open private workspace" : "Create owner account"}</button></form>{error && <p role="alert" className="workspace-error">{error}</p>}{message && <p role="status">{message}</p>}<small>Owner-only pilot. Creating an account does not automatically grant workspace access.</small></section></main>;
}
