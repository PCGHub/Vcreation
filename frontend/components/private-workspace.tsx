"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import styles from "@/app/workspace.module.css";
import { restoreWorkspaceSession } from "@/lib/workspace-session";

type Access = "loading" | "ready" | "signed-out" | "denied" | "unavailable";
export function PrivateWorkspace({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Access>("loading");
  const [diagnostic, setDiagnostic] = useState({ code: "", detail: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    let active = true;
    let revision = 0;
    async function verify() {
      const current = ++revision;
      try {
        const result = await restoreWorkspaceSession();
        if (active && current === revision) { setState(result.state); setDiagnostic({ code: result.code, detail: result.detail }); }
      } catch { if (active && current === revision) { setState("unavailable"); setDiagnostic({ code: "SESSION_CONNECTION", detail: "Could not reach Vcreation's session service." }); } }
    }
    const subscription = supabase?.auth.onAuthStateChange(event => {
      if (event !== "INITIAL_SESSION") queueMicrotask(() => { if (active) void verify(); });
    });
    void verify();
    return () => { active = false; revision++; subscription?.data.subscription.unsubscribe(); };
  }, [attempt]);
  if (state === "ready" || process.env.NODE_ENV === "development") return <>{children}</>;
  return <div className={styles.toolSurface}><main id="workspace" className="workspace-tool workspace-access"><span className="workspace-access-icon">◇</span><h1>{state === "loading" ? "Opening your workspace…" : state === "unavailable" ? "We couldn't verify your session" : state === "denied" ? "This account doesn't have workspace access" : "Sign in to Vcreation"}</h1><p>{diagnostic.detail || (state === "loading" ? "Restoring your sign-in and checking access." : state === "unavailable" ? "The sign-in service is temporarily unavailable. Your projects haven't been changed." : state === "denied" ? "This pilot is restricted to its verified owner account. Use the owner's email to sign in." : "Your workspace includes the Film Assistant, Film Studio, footage editor, and render history. Sign in once to use them together.")}</p>{state !== "loading" && <Link href="/auth" className="workspace-primary">Sign in to Vcreation</Link>}{state !== "loading" && <><button type="button" className="workspace-primary" style={{ marginLeft: 12 }} onClick={() => { setState("loading"); setDiagnostic({ code: "", detail: "" }); setAttempt(value => value + 1); }}>Retry session check</button><small>Support code: {diagnostic.code || "SESSION_CHECK"}</small></>}<small>Private pilot · Your projects stay protected.</small></main></div>;
}
