"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { addOrUpdateJob } from "@/lib/jobHistory";
import { getMultiClips, getSingleClip, saveMultiClips } from "@/lib/clipStore";
import { dedupeVideoOutputs, extractVideoOutputs, type NestedOutputValue, type VideoOutputItem } from "@/lib/videoOutputs";

type JobResponse = {
  job_id?: string;
  status?: string;
  progress?: number;
  output_url?: string;
  outputs?: NestedOutputValue;
  detail?: string;
  error?: string;
};

export default function VideoPage() {
  const API_BASE = "http://127.0.0.1:8000";
  const SUCCESS_STATUSES = new Set(["completed", "succeeded"]);
  const FAILURE_STATUSES = new Set(["failed", "error"]);
  const modeOptions = [
    { value: "viral", label: "Viral Edit" },
    { value: "cartoon", label: "Clay / Cartoon" },
    { value: "cinematic", label: "Cinematic" },
    { value: "story", label: "Storytelling" },
    { value: "highlight", label: "Highlight Cut" },
  ];

  const [singleClip, setSingleClip] = useState("");
  const [multiClips, setMultiClips] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("viral_mode");
  const [mode, setMode] = useState("viral");
  const [numOutputs, setNumOutputs] = useState("3");
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [outputs, setOutputs] = useState<VideoOutputItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [outputRefreshToken, setOutputRefreshToken] = useState(Date.now());
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    setSingleClip(getSingleClip());
    setMultiClips(getMultiClips());

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, []);

  const hasAssets = useMemo(() => Boolean(singleClip || multiClips.length), [multiClips.length, singleClip]);
  const multiClipRefs = multiClips.length ? multiClips : singleClip ? [singleClip] : [];
  const multiDisabledReason = !prompt.trim()
    ? "Enter a prompt to run multiple outputs."
    : !multiClipRefs.length
      ? "Upload a clip first so Video Lab has something to process."
      : "";

  const fullUrl = (path?: string | null) => {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `${API_BASE}${path}`;
  };

  const extractOutputs = (data: JobResponse) => {
    const items = dedupeVideoOutputs([
      ...extractVideoOutputs(data.output_url, fullUrl, ["primary_output"]),
      ...extractVideoOutputs(data.outputs, fullUrl, ["outputs"]),
    ]);

    return items;
  };

  const normalizedNumOutputs = Math.max(1, Number(numOutputs) || 1);
  const previewSource = outputs[0]?.url || fullUrl(singleClip) || fullUrl(multiClipRefs[0]);
  const savedClipCount = multiClipRefs.length;
  const statusTone =
    status === "failed"
      ? "border-red-400/30 bg-red-500/10 text-red-100"
      : status === "succeeded" || status === "completed"
        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
        : "border-white/12 bg-white/5 text-white";

  const pollStatus = (id: string, label: string) => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
    }

    intervalRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/edit/status/${id}`);
        const data: JobResponse = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || data.error || "Could not fetch job status");
        }

        const nextStatus = data.status || "processing";
        const nextProgress = Number(data.progress || 0);

        setStatus(nextStatus);
        setProgress(nextProgress);

        addOrUpdateJob({
          job_id: id,
          label,
          source: "video",
          status: nextStatus,
          progress: nextProgress,
          output_url: data.output_url,
          outputs: extractOutputs(data).map((item) => item.url),
          created_at: new Date().toISOString(),
        });

        if (SUCCESS_STATUSES.has(nextStatus) || FAILURE_STATUSES.has(nextStatus)) {
          if (intervalRef.current) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
          }

          setLoading(false);

          if (SUCCESS_STATUSES.has(nextStatus)) {
            console.log("OUTPUT FROM BACKEND:", data.output_url || data.outputs);
            setOutputs(extractOutputs(data));
            setOutputRefreshToken(Date.now());
            setProgress(100);
          } else {
            setStatus("failed");
            setError(data.detail || data.error || "Video generation failed");
          }
        }
      } catch (err) {
        if (intervalRef.current) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }

        setLoading(false);
        setError(err instanceof Error ? err.message : "Unexpected error");
      }
    }, 2000);
  };

  const runRequest = async (endpoint: string, body: object, label: string) => {
    setLoading(true);
    setError("");
    setOutputs([]);
    setProgress(0);
    setStatus("starting");
    setJobId("");

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data: JobResponse = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || data.error || "Could not start generation");
      }

      if (!data.job_id) {
        const immediateOutputs = extractOutputs(data);

        if (immediateOutputs.length) {
          console.log("OUTPUT FROM BACKEND:", data.output_url || data.outputs);
          setOutputs(immediateOutputs);
          setOutputRefreshToken(Date.now());
          setStatus("succeeded");
          setProgress(100);
          setLoading(false);
          return;
        }

        throw new Error("No job ID or output URL returned from the backend");
      }

      setJobId(data.job_id);
      setStatus(data.status || "processing");

      addOrUpdateJob({
        job_id: data.job_id,
        label,
        source: "video",
        status: data.status || "processing",
        progress: 0,
        created_at: new Date().toISOString(),
      });

      pollStatus(data.job_id, label);
    } catch (err) {
      setLoading(false);
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Unexpected error");
    }
  };

  return (
    <main className="clayme-shell min-h-screen px-4 py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="relative overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(135deg,rgba(124,58,237,0.22),rgba(34,211,238,0.12)_38%,rgba(10,14,24,0.92)_72%)] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.45)] sm:p-8 lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_26%),radial-gradient(circle_at_76%_14%,rgba(255,214,10,0.16),transparent_18%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.18),transparent_24%)]" />
          <div className="relative grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-white/12 bg-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--accent-warm)]">
                  Video Lab
                </span>
                <span className="rounded-full border border-yellow-300/20 bg-yellow-300/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-yellow-100">
                  Cinematic Output Control
                </span>
              </div>

              <h1 className="section-title mt-6 max-w-4xl text-5xl font-semibold leading-none text-white sm:text-6xl lg:text-7xl">
                Turn raw footage into a premium edit room with a preview that feels like the product.
              </h1>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/80 sm:text-xl">
                Build sharper viral edits, generate multiple variations, and monitor the result from one cinematic command surface instead of a basic utility page.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">
                <button
                  onClick={() =>
                    runRequest("/api/edit/run-multi", {
                      prompt: prompt.trim(),
                      mode,
                      num_outputs: normalizedNumOutputs,
                      clips: multiClipRefs.map((ref, index) => ({ id: index + 1, ref })),
                    }, "Multi clip edit")
                  }
                  disabled={loading || !multiClipRefs.length || !prompt.trim()}
                  className="rounded-2xl bg-[linear-gradient(135deg,#fff18a_0%,#ffd60a_50%,#ffb703_100%)] px-7 py-4 text-base font-extrabold text-slate-950 shadow-[0_16px_40px_rgba(255,214,10,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_50px_rgba(255,214,10,0.35)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Generate {normalizedNumOutputs} Premium Variations
                </button>
                <Link
                  href="/dashboard/upload"
                  className="rounded-2xl border border-white/15 bg-white/5 px-7 py-4 text-base font-semibold text-white transition hover:bg-white hover:text-slate-950"
                >
                  Back to Upload
                </Link>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  { label: "Saved clips", value: `${savedClipCount}`.padStart(2, "0") },
                  { label: "Requested outputs", value: `${normalizedNumOutputs}`.padStart(2, "0") },
                  { label: "Ready outputs", value: `${outputs.length}`.padStart(2, "0") },
                ].map((item) => (
                  <div key={item.label} className="rounded-[24px] border border-white/10 bg-black/20 p-4 backdrop-blur-xl">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">{item.label}</div>
                    <div className="mt-3 text-3xl font-semibold text-white">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-6 rounded-[32px] bg-[radial-gradient(circle_at_center,rgba(124,58,237,0.24),transparent_58%)] blur-2xl" />
              <div className="relative overflow-hidden rounded-[32px] border border-white/12 bg-[#05070d] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.52)]">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--accent-warm)]">Hero Preview</p>
                    <p className="mt-2 text-sm text-white/60">
                      {previewSource ? "Your most important visual should dominate this page." : "Upload a source clip to light up the hero preview."}
                    </p>
                  </div>
                  <div className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
                    {status || "Idle"}
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.22),transparent_42%),linear-gradient(180deg,#0a0f18_0%,#06080d_100%)]">
                  <div className="absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),transparent)] opacity-30" />
                  {previewSource ? (
                    <video
                      key={`${previewSource}-${outputRefreshToken}`}
                      controls
                      className="aspect-[4/5] w-full bg-black object-cover sm:aspect-video"
                    >
                      <source src={`${previewSource}?t=${outputRefreshToken}`} />
                    </video>
                  ) : (
                    <div className="flex aspect-[4/5] w-full items-center justify-center px-8 text-center sm:aspect-video">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.32em] text-white/40">No preview yet</div>
                        <p className="mt-4 max-w-sm text-lg leading-8 text-white/70">
                          Upload footage, save a clip, then this area becomes the visual hero for your generation flow.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-white/40">Mode</div>
                    <div className="mt-2 text-lg font-semibold text-white">{modeOptions.find((option) => option.value === mode)?.label || mode}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-white/40">Prompt</div>
                    <div className="mt-2 line-clamp-2 text-sm leading-6 text-white/70">{prompt.trim() || "Describe the edit direction to make the output more intentional."}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-white/40">Progress</div>
                    <div className="mt-2 text-lg font-semibold text-white">{progress}%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.86fr_1.14fr]">
          <div className="glass-panel rounded-[32px] p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-[var(--accent-warm)]">Footage Stack</p>
                <h2 className="section-title mt-3 text-3xl font-semibold text-white">Source clips should feel curated, not dumped on the page.</h2>
              </div>
              {singleClip && (
                <button
                  onClick={() => {
                    saveMultiClips([singleClip]);
                    setMultiClips([singleClip]);
                  }}
                  className="rounded-2xl border border-yellow-300/24 bg-yellow-300/10 px-5 py-3 text-sm font-semibold text-yellow-50 transition hover:bg-yellow-300 hover:text-slate-950"
                >
                  Use single clip for multi-output
                </button>
              )}
            </div>

            {!hasAssets && (
              <div className="mt-6 rounded-[28px] border border-dashed border-white/15 bg-black/20 px-6 py-10 text-center">
                <div className="text-xs uppercase tracking-[0.3em] text-white/40">No media loaded</div>
                <p className="mx-auto mt-4 max-w-md text-base leading-7 text-white/70">
                  No locally stored clips found yet. Go to the dashboard upload flow and bring in footage first.
                </p>
              </div>
            )}

            <div className="mt-6 space-y-5">
              {singleClip && (
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.28em] text-white/40">Single clip</div>
                      <div className="mt-2 text-lg font-semibold text-white">Primary source for focused edit runs</div>
                    </div>
                    <div className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
                      Hero ready
                    </div>
                  </div>
                  <video controls className="mt-4 aspect-video w-full rounded-[24px] border border-white/10 bg-black object-cover">
                    <source src={fullUrl(singleClip)} />
                  </video>
                </div>
              )}

              {!!multiClips.length && (
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(124,58,237,0.12),rgba(255,255,255,0.02))] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.28em] text-[var(--accent-warm)]">Multi-clip set</div>
                      <div className="mt-2 text-lg font-semibold text-white">Variation-ready footage stack</div>
                    </div>
                    <div className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
                      {multiClips.length} clip{multiClips.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4">
                    {multiClips.map((clip, index) => (
                      <video key={`${clip}-${index}`} controls className="aspect-video w-full rounded-[24px] border border-white/10 bg-black object-cover">
                        <source src={fullUrl(clip)} />
                      </video>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel rounded-[32px] p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-[var(--accent-warm)]">Generation Controls</p>
            <h2 className="section-title mt-3 text-3xl font-semibold text-white">Sharper hierarchy, stronger calls to action, and a control area that feels expensive.</h2>

            <div className="mt-6 grid gap-5">
              <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
                <label className="text-xs font-semibold uppercase tracking-[0.28em] text-white/45">Creative direction</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  className="mt-4 w-full rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] px-5 py-5 text-white outline-none placeholder:text-white/30"
                  placeholder="Describe the edit style, pacing, captions, hook, motion energy, and emotional direction."
                />
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
                  <label className="text-xs font-semibold uppercase tracking-[0.28em] text-white/45">Edit mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    className="mt-4 w-full rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-white outline-none"
                  >
                    {modeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
                  <label className="text-xs font-semibold uppercase tracking-[0.28em] text-white/45">Output count</label>
                  <input
                    value={numOutputs}
                    onChange={(e) => setNumOutputs(e.target.value)}
                    type="number"
                    min="1"
                    className="mt-4 w-full rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-white outline-none"
                    placeholder="Number of outputs"
                  />
                  <p className="mt-3 text-sm leading-6 text-white/60">
                    Clayme will request {normalizedNumOutputs} variation{normalizedNumOutputs === 1 ? "" : "s"} from the backend.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                onClick={() =>
                  runRequest("/api/edit/run", {
                    prompt: prompt.trim(),
                    mode,
                    clips: [{ id: 1, ref: singleClip }],
                  }, "Single clip edit")
                }
                disabled={loading || !singleClip || !prompt.trim()}
                className="rounded-[24px] bg-[linear-gradient(135deg,#7c3aed_0%,#22d3ee_120%)] px-6 py-5 text-base font-extrabold text-white shadow-[0_18px_50px_rgba(124,58,237,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(124,58,237,0.34)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                Run Focused Single Edit
              </button>
              <button
                onClick={() =>
                  runRequest("/api/edit/run-multi", {
                    prompt: prompt.trim(),
                    mode,
                    num_outputs: normalizedNumOutputs,
                    clips: multiClipRefs.map((ref, index) => ({ id: index + 1, ref })),
                  }, "Multi clip edit")
                }
                disabled={loading || !multiClipRefs.length || !prompt.trim()}
                className="rounded-[24px] border border-yellow-300/24 bg-[linear-gradient(135deg,rgba(255,214,10,0.18),rgba(255,183,3,0.1))] px-6 py-5 text-base font-extrabold text-yellow-50 shadow-[0_18px_50px_rgba(255,214,10,0.12)] transition hover:-translate-y-0.5 hover:bg-[linear-gradient(135deg,rgba(255,214,10,0.28),rgba(255,183,3,0.16))] disabled:cursor-not-allowed disabled:opacity-55"
              >
                Run Multiple Premium Outputs
              </button>
            </div>

            {multiDisabledReason && (
              <p className="mt-4 text-sm leading-6 text-white/60">{multiDisabledReason}</p>
            )}

            {(status || jobId || loading) && (
              <div className={`mt-6 rounded-[28px] border p-5 ${statusTone}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.28em] opacity-70">Generation status</div>
                    <div className="mt-2 text-2xl font-semibold capitalize">{status || "idle"}</div>
                  </div>
                  {jobId && (
                    <div className="rounded-full border border-current/20 bg-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em]">
                      {jobId}
                    </div>
                  )}
                </div>

                <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-black/20">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#fff18a_0%,#22d3ee_100%)] transition-all"
                    style={{ width: `${Math.max(5, Math.min(progress, 100))}%` }}
                  />
                </div>
                <div className="mt-3 text-sm font-medium">{progress}% complete</div>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-[24px] border border-red-400/24 bg-red-500/10 px-5 py-4 text-sm leading-6 text-red-100">
                {error}
              </div>
            )}
          </div>
        </section>

        {!!outputs.length && (
          <section className="glass-panel rounded-[32px] p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-[var(--accent-warm)]">Output Gallery</p>
                <h2 className="section-title mt-3 text-3xl font-semibold text-white">Finished clips should look launch-ready, not buried below the fold.</h2>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
                {outputs.length} result{outputs.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              {outputs.map((output, index) => (
                <div
                  key={output.id || `${output.url}-${index}`}
                  className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)]"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.28em] text-white/40">
                        {output.group} • Output {index + 1}
                      </div>
                      <div className="mt-2 text-lg font-semibold text-white">{output.label}</div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
                      Ready
                    </div>
                  </div>

                  <video
                    key={`${output.url}-${outputRefreshToken}`}
                    controls
                    className="aspect-video w-full rounded-[24px] border border-white/10 bg-black object-cover"
                  >
                    <source src={`${output.url}?t=${outputRefreshToken}`} />
                  </video>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <a
                      href={output.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
                    >
                      Open Output
                    </a>
                    <a
                      href={output.url}
                      download
                      className="rounded-2xl border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white hover:text-slate-950"
                    >
                      Download Clip
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
