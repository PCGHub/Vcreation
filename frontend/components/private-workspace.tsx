"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import styles from "@/app/workspace.module.css";

type Access = "loading" | "ready" | "signed-out" | "denied" | "unavailable";
export function PrivateWorkspace({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Access>("loading");
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    let active = true;
    let revision = 0;
    async function verify(token?: string) {
      const current = ++revision;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin", ...(token ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: token }) } : {}) });
        // A slow check made before sign-in must not overwrite a newer verified session.
        if (active && current === revision) setState(response.ok ? "ready" : response.status === 401 ? "signed-out" : response.status === 403 ? "denied" : "unavailable");
      } catch { if (active && current === revision) setState("unavailable"); }
    }
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return; // Initialization below handles this once.
      // Keep async verification outside Supabase's auth-state lock.
      queueMicrotask(() => { if (active) void verify(session?.access_token); });
    });
    const initialRevision = revision;
    void (async () => {
      try {
        const session = supabase ? (await supabase.auth.getSession()).data.session : null;
        if (active && revision === initialRevision) await verify(session?.access_token);
      } catch { if (active && revision === initialRevision) await verify(); }
    })();
    return () => { active = false; revision++; subscription?.data.subscription.unsubscribe(); };
  }, []);
  if (state === "ready" || process.env.NODE_ENV === "development") return <>{children}</>;
  return <div className={styles.toolSurface}><main id="workspace" className="workspace-tool workspace-access"><span className="workspace-access-icon">◇</span><h1>{state === "loading" ? "Opening your workspace…" : state === "unavailable" ? "We couldn't verify your session" : state === "denied" ? "This account doesn't have workspace access" : "Sign in to Vcreation"}</h1><p>{state === "loading" ? "Restoring your sign-in and checking access." : state === "unavailable" ? "The sign-in service is temporarily unavailable. Your projects haven't been changed." : state === "denied" ? "This pilot is restricted to its verified owner account. Use the owner's email to sign in." : "Your workspace includes the Film Assistant, Film Studio, footage editor, and render history. Sign in once to use them together."}</p>{state !== "loading" && <Link href="/auth" className="workspace-primary">Sign in to Vcreation</Link>}<small>Private pilot · Your projects stay protected.</small></main></div>;
}
