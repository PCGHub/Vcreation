"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSessionUser, supabase } from "@/lib/supabase";
import DashboardScrollRail from "./scroll-rail";

const navItems = [
  { href: "/studio", label: "Film Studio" },
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/upload", label: "AI Editor" },
  { href: "/dashboard/music/upload", label: "Music AI" },
  { href: "/dashboard/history", label: "History" },
  { href: "/video", label: "Video Lab" },
  { href: "/image", label: "Image Lab" },
  { href: "/jobs", label: "Jobs" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const checkUser = async () => {
      const user = await getSessionUser();

      if (!active) return;

      if (!user) {
        router.replace("/auth");
        return;
      }

      setUserEmail(user.email || "");
      setLoading(false);
    };

    void checkUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;

      if (!session?.user) {
        setUserEmail("");
        setLoading(false);
        router.replace("/auth");
        return;
      }

      setUserEmail(session.user.email || "");
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const activeLabel = useMemo(() => {
    return navItems.find((item) => pathname === item.href)?.label || "Dashboard";
  }, [pathname]);

  if (!supabase) return <main className="mx-auto max-w-xl space-y-4 px-6 py-16"><h1 className="text-3xl">Account dashboard not configured</h1><p>Use the local filmmaking workspace, or configure your own Supabase connection.</p><Link href="/studio" className="text-teal-200">Open Film Studio →</Link></main>;

  if (loading) {
    return (
      <div className="clayme-shell flex min-h-screen items-center justify-center px-6">
        <div className="glass-panel rounded-3xl px-8 py-6 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-[var(--accent)]">Vcreation</p>
          <p className="mt-3 text-lg">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="clayme-shell min-h-screen">
      <div className="mx-auto grid min-h-screen max-w-[1360px] gap-6 px-4 py-4 lg:grid-cols-[280px_26px_minmax(0,1fr)]">
        <aside className="glass-panel rounded-[28px] p-6 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[var(--accent)]">Vcreation</p>
            <h1 className="section-title mt-3 text-3xl font-semibold">Creator OS</h1>
            <p className="muted mt-3 text-sm leading-6">
              Upload, edit, monitor jobs, and manage outputs from one premium dashboard.
            </p>
          </div>

          <nav className="mt-8 space-y-2">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-2xl px-4 py-3 text-sm font-medium transition ${
                    active
                      ? "bg-white text-slate-950"
                      : "border border-transparent text-[var(--muted)] hover:border-[var(--line)] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-8 rounded-2xl border border-[var(--line)] bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">Signed in as</div>
            <div className="mt-2 break-all text-sm text-white">{userEmail}</div>
            <button
              onClick={async () => {
                await supabase?.auth.signOut();
                router.replace("/auth");
              }}
              className="mt-4 rounded-xl border border-white/15 px-4 py-2 text-sm text-white transition hover:bg-white hover:text-slate-950"
            >
              Log out
            </button>
          </div>
        </aside>

        <DashboardScrollRail />

        <main className="min-w-0 py-2">
          <div className="mx-auto w-full max-w-5xl">
            <div className="glass-panel mb-6 rounded-[28px] px-6 py-5">
              <p className="text-xs uppercase tracking-[0.35em] text-[var(--muted)]">Dashboard</p>
              <h2 className="section-title mt-2 text-3xl font-semibold">{activeLabel}</h2>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
