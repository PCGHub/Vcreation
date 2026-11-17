"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import styles from "@/app/workspace.module.css";

export function PrivateWorkspace({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "signed-out" | "unavailable">("loading");
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    let active = true;
    async function verify(token?: string) {
      try {
        const response = await fetch("/api/auth/session", token ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: token }) } : { cache: "no-store" });
        if (active) setState(response.ok ? "ready" : response.status === 401 || response.status === 403 ? "signed-out" : "unavailable");
      } catch { if (active) setState("unavailable"); }
    }
    void verify();
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => { if (session?.access_token) void verify(session.access_token); else void verify(); });
    return () => { active = false; subscription?.data.subscription.unsubscribe(); };
  }, []);
  if (state === "ready" || process.env.NODE_ENV === "development") return <>{children}</>;
  return <div className={styles.toolSurface}><main id="workspace" className="workspace-tool workspace-access"><span className="workspace-access-icon">◇</span><h1>{state === "loading" ? "Opening your private workspace…" : state === "unavailable" ? "We couldn't verify your session" : "Your films belong to you."}</h1><p>{state === "loading" ? "Checking your sign-in." : state === "unavailable" ? "Please try signing in again in a moment. Your saved projects haven't been changed." : "Sign in with the workspace owner's verified account to open projects, footage, and render history."}</p>{state !== "loading" && <Link href="/auth" className="workspace-primary">Sign in to workspace</Link>}<small>Owner-only pilot · Customer accounts are not enabled yet.</small></main></div>;
}
