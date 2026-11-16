"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStoredJobs } from "@/lib/jobHistory";

type ProjectRecord = {
  id?: string | number;
  prompt?: string;
  type?: string;
  output_url?: string;
  created_at?: string;
};

export default function DashboardOverviewPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadProjects = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from("projects")
          .select("id, prompt, type, output_url, created_at")
          .order("created_at", { ascending: false })
          .limit(6);

        if (fetchError) {
          throw fetchError;
        }

        if (active) {
          setProjects(data || []);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not load projects");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadProjects();

    return () => {
      active = false;
    };
  }, []);

  const stats = useMemo(() => {
    const localJobs = getStoredJobs();
    return [
      { label: "Saved Projects", value: String(projects.length) },
      { label: "Tracked Jobs", value: String(localJobs.length) },
      { label: "Studios", value: "3" },
    ];
  }, [projects]);

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[28px] p-6 sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-[var(--accent)]">Clayme mission</p>
            <h3 className="section-title mt-4 max-w-3xl text-4xl font-semibold leading-tight">
              Turn rough footage and ideas into polished, viral-ready content from one workflow.
            </h3>
            <p className="muted mt-5 max-w-2xl text-base leading-8">
              Your MVP already covers uploading, AI editing, auth, history, and job tracking. This dashboard
              pulls those pieces together into a product shell you can iterate on.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/dashboard/upload"
                className="rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-slate-950 transition hover:bg-[var(--accent-strong)]"
              >
                Start New Edit
              </Link>
              <Link
                href="/dashboard/history"
                className="rounded-2xl border border-[var(--line-strong)] px-5 py-3 font-semibold text-white transition hover:bg-white hover:text-slate-950"
              >
                View History
              </Link>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {stats.map((item) => (
              <div key={item.label} className="rounded-[24px] border border-[var(--line)] bg-black/20 p-5">
                <div className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">{item.label}</div>
                <div className="mt-3 text-4xl font-semibold text-white">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="glass-panel rounded-[28px] p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="section-title text-2xl font-semibold">Recent Projects</h3>
              <p className="muted mt-2 text-sm">Your latest saved AI outputs from Supabase.</p>
            </div>
            <Link href="/dashboard/history" className="text-sm text-[var(--accent)]">
              Open history
            </Link>
          </div>

          {loading ? (
            <p className="muted mt-6">Loading projects...</p>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : projects.length === 0 ? (
            <p className="muted mt-6">No projects yet. Generate your first AI edit from the upload page.</p>
          ) : (
            <div className="mt-6 grid gap-4">
              {projects.map((project, index) => (
                <div key={project.id || `${project.output_url}-${index}`} className="rounded-[22px] border border-[var(--line)] bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{project.type || "video"}</div>
                      <div className="mt-2 text-lg font-semibold text-white">
                        {project.prompt || "Untitled generation"}
                      </div>
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {project.created_at ? new Date(project.created_at).toLocaleDateString() : "Just now"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-panel rounded-[28px] p-6">
          <h3 className="section-title text-2xl font-semibold">Build Next</h3>
          <div className="mt-5 grid gap-4">
            {[
              "Add download and share actions to every saved output.",
              "Connect credits and pay-per-generation logic to the job flow.",
              "Add viral score and content analytics after generation.",
            ].map((item) => (
              <div key={item} className="rounded-[22px] border border-[var(--line)] bg-black/20 p-4 text-sm leading-7 text-white/90">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
