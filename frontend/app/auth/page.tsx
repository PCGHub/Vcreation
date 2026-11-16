"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { getSessionUser, supabase } from "@/lib/supabase";

export default function AuthPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const checkUser = async () => {
      const user = await getSessionUser();
      if (active && user) {
        router.replace("/dashboard");
      }
    };

    void checkUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session?.user) {
        router.replace("/dashboard");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const handleSubmit = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError("Enter your email and password.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (mode === "signup") {
        const { error: signupError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (signupError) {
          throw signupError;
        }

        setMessage("Account created. Check your email for the confirmation link.");
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (loginError) {
          throw loginError;
        }

        router.push("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="clayme-shell min-h-screen px-4 py-10">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-[32px] p-8 lg:p-12"
        >
          <p className="mb-4 text-sm uppercase tracking-[0.35em] text-[var(--accent)]">Clayme AI</p>
          <h1 className="section-title max-w-xl text-5xl font-semibold leading-none sm:text-6xl">
            Build viral-ready content from raw footage in minutes.
          </h1>
          <p className="muted mt-6 max-w-2xl text-lg leading-8">
            Upload once, trigger AI editing, track progress live, and manage every output from one creator dashboard.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              { label: "AI Editing", value: "Upload -> edit -> export" },
              { label: "Creator Workflow", value: "Dashboard, history, auth" },
              { label: "Built For SaaS", value: "Ready for credits and billing" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-[var(--line)] bg-black/20 p-4">
                <div className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">{item.label}</div>
                <div className="mt-3 text-lg font-semibold text-white">{item.value}</div>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="glass-panel flex items-center rounded-[32px] p-6 sm:p-8"
        >
          <div className="w-full">
            <div className="mb-6 flex rounded-full border border-[var(--line)] bg-black/20 p-1">
              <button
                onClick={() => setMode("login")}
                className={`flex-1 rounded-full px-4 py-3 text-sm font-semibold transition ${mode === "login" ? "bg-white text-black" : "text-[var(--muted)]"}`}
              >
                Login
              </button>
              <button
                onClick={() => setMode("signup")}
                className={`flex-1 rounded-full px-4 py-3 text-sm font-semibold transition ${mode === "signup" ? "bg-white text-black" : "text-[var(--muted)]"}`}
              >
                Sign up
              </button>
            </div>

            <h2 className="section-title text-3xl font-semibold">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="muted mt-3 text-sm">
              {mode === "login"
                ? "Access your Clayme workspace and continue generating content."
                : "Start building a creator workflow with AI-powered editing."}
            </p>

            <div className="mt-8 space-y-4">
              <input
                type="email"
                className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-4 outline-none placeholder:text-[var(--muted)]"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="password"
                className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-4 outline-none placeholder:text-[var(--muted)]"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="mt-6 w-full rounded-2xl bg-[var(--accent)] px-4 py-4 font-semibold text-slate-950 transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Working..." : mode === "login" ? "Enter Dashboard" : "Create Account"}
            </button>

            {error && (
              <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {message && (
              <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {message}
              </div>
            )}
          </div>
        </motion.section>
      </div>
    </main>
  );
}
