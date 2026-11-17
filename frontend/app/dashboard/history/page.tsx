"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type ProjectRecord = {
  id?: string | number;
  prompt?: string;
  type?: string;
  output_url?: string;
  created_at?: string;
};

export default function DashboardHistoryPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadProjects = async () => {
      try {
        if (!supabase) throw new Error("Configure Supabase to use the account dashboard");
        const { data, error: fetchError } = await supabase
          .from("projects")
          .select("id, prompt, type, output_url, created_at")
          .order("created_at", { ascending: false });

        if (fetchError) {
          throw fetchError;
        }

        if (active) {
          setProjects(data || []);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not load history");
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

  return (
    <div className="glass-panel rounded-[28px] p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="section-title text-3xl font-semibold">Saved History</h3>
          <p className="muted mt-3 text-sm">
            Browse every generated project stored in your `projects` table.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-black/20 px-4 py-3 text-sm text-[var(--muted)]">
          {loading ? "Loading..." : `${projects.length} project${projects.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {!error && loading && <p className="muted mt-6">Fetching projects from Supabase...</p>}

      {!error && !loading && projects.length === 0 && (
        <p className="muted mt-6">No saved videos yet. Generate one from the AI editor to populate this page.</p>
      )}

      {!!projects.length && (
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {projects.map((project, index) => (
            <article
              key={project.id || `${project.output_url}-${index}`}
              className="rounded-[24px] border border-[var(--line)] bg-black/20 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-[var(--accent)]">
                    {project.type || "video"}
                  </div>
                  <h4 className="mt-3 text-xl font-semibold text-white">
                    {project.prompt || "Untitled generation"}
                  </h4>
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {project.created_at ? new Date(project.created_at).toLocaleString() : "Just now"}
                </div>
              </div>

              {project.output_url ? (
                <>
                  <video src={project.output_url} controls className="mt-4 w-full rounded-2xl border border-[var(--line)] bg-black" />
                  <div className="mt-4 flex flex-wrap gap-3">
                    <a
                      href={project.output_url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
                    >
                      Open
                    </a>
                    <a
                      href={project.output_url}
                      download
                      className="rounded-xl border border-[var(--line-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white hover:text-slate-950"
                    >
                      Download
                    </a>
                  </div>
                </>
              ) : (
                <p className="muted mt-4 text-sm">This record does not have an output URL yet.</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
