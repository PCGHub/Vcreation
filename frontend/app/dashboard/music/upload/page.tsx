"use client";

import { API_BASE } from "@/lib/api";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { addOrUpdateJob } from "@/lib/jobHistory";

type MusicJobResponse = {
  job_id?: string;
  status?: string;
  progress?: number;
  output_url?: string | null;
  detail?: string;
  error?: string;
};

const voiceOptions = [
  { value: "original", label: "Original voice" },
  { value: "afrobeats_star", label: "Afrobeats Star" },
  { value: "gospel_power", label: "Gospel Power" },
  { value: "soul_female", label: "Soul Female" },
  { value: "trap_melodic", label: "Trap Melodic" },
];

export default function MusicUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"prompt" | "lyrics">("prompt");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [voice, setVoice] = useState("original");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadedRef, setUploadedRef] = useState<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const fullUrl = (path?: string | null) => {
    if (!path) return null;
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `${API_BASE}${path}`;
  };

  const uploadAudio = async (selectedFile: File) => {
    const formData = new FormData();
    formData.append("file", selectedFile);

    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.error || "Audio upload failed");
    }

    const ref = data.ref || data.url || data.path;
    if (!ref) {
      throw new Error("Upload completed but no audio reference was returned");
    }

    return ref as string;
  };

  const pollJobStatus = (id: string) => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/music/status/${id}`);
        const data: MusicJobResponse = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || data.error || "Could not fetch music job status");
        }

        const nextStatus = data.status || "processing";
        const nextProgress = Number(data.progress || 0);
        const nextOutputUrl = fullUrl(data.output_url);

        setStatus(nextStatus);
        setProgress(nextProgress);

        addOrUpdateJob({
          job_id: id,
          label: "Music AI generation",
          source: "jobs",
          status: nextStatus,
          progress: nextProgress,
          output_url: nextOutputUrl || undefined,
          outputs: nextOutputUrl ? [nextOutputUrl] : [],
          created_at: new Date().toISOString(),
        });

        if (nextStatus === "completed" || nextStatus === "succeeded") {
          if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          setLoading(false);
          setProgress(100);
          setOutputUrl(nextOutputUrl);
        }

        if (nextStatus === "failed") {
          if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          setLoading(false);
          setError(data.error || data.detail || "Music generation failed");
        }
      } catch (err) {
        if (pollIntervalRef.current) {
          window.clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        setLoading(false);
        setStatus("failed");
        setError(err instanceof Error ? err.message : "Could not track music generation");
      }
    }, 2500);
  };

  const handleGenerate = async () => {
    if (!file) {
      setError("Upload an audio file first.");
      return;
    }

    if (mode === "prompt" && !prompt.trim()) {
      setError("Enter a prompt before generating.");
      return;
    }

    if (mode === "lyrics" && !lyrics.trim()) {
      setError("Paste your custom lyrics before generating.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("uploading");
    setProgress(0);
    setOutputUrl(null);
    setJobId(null);

    try {
      const fileRef = uploadedRef || (await uploadAudio(file));
      setUploadedRef(fileRef);

      const payload =
        mode === "prompt"
          ? {
              mode,
              prompt: prompt.trim(),
              voice,
              file_url: fileRef,
            }
          : {
              mode,
              lyrics: lyrics.trim(),
              voice,
              file_url: fileRef,
            };

      setStatus("starting");

      const res = await fetch(`${API_BASE}/api/music/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data: MusicJobResponse = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || data.error || "Could not start music generation");
      }

      const immediateOutput = fullUrl(data.output_url);
      if (immediateOutput && !data.job_id) {
        setOutputUrl(immediateOutput);
        setStatus("completed");
        setProgress(100);
        setLoading(false);
        return;
      }

      if (!data.job_id) {
        throw new Error("No music job ID was returned");
      }

      setJobId(data.job_id);
      setStatus(data.status || "queued");

      addOrUpdateJob({
        job_id: data.job_id,
        label: "Music AI generation",
        source: "jobs",
        status: data.status || "queued",
        progress: 0,
        created_at: new Date().toISOString(),
      });

      pollJobStatus(data.job_id);
    } catch (err) {
      setLoading(false);
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Music generation failed");
    }
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[28px] p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-[var(--accent)]">Music AI Engine</p>
            <h1 className="section-title mt-4 text-4xl font-semibold">Generate transformed songs with live progress tracking.</h1>
            <p className="muted mt-4 max-w-2xl leading-8">
              Upload a song, switch between prompt mode and custom lyrics, choose a voice style, and monitor the job until your final audio is ready.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-2xl border border-[var(--line-strong)] px-5 py-3 text-sm font-semibold transition hover:bg-white hover:text-slate-950"
          >
            Back to dashboard
          </Link>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="glass-panel rounded-[28px] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--accent-warm)]">Upload and Input</p>
          <h2 className="section-title mt-3 text-3xl font-semibold">Drop in a song, then guide the transformation.</h2>

          <label className="mt-6 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-[24px] border-2 border-dashed border-[var(--line-strong)] bg-black/20 px-6 py-10 text-center transition hover:border-white">
            <input
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              className="hidden"
              onChange={(e) => {
                const nextFile = e.target.files?.[0];
                if (nextFile) {
                  setFile(nextFile);
                  setUploadedRef(null);
                  setOutputUrl(null);
                  setJobId(null);
                  setProgress(0);
                  setStatus("");
                  setError("");
                }
              }}
            />
            <div className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">Audio upload</div>
            <p className="mt-4 text-lg font-semibold text-white">
              {file ? file.name : "Click to upload or drag your .mp3 / .wav file here"}
            </p>
            <p className="muted mt-3 max-w-md text-sm leading-7">
              Use a source track you want to transform into a new prompt-driven version or a custom-lyrics output.
            </p>
          </label>

          <div className="mt-6 flex rounded-full border border-[var(--line)] bg-black/20 p-1">
            <button
              type="button"
              onClick={() => setMode("prompt")}
              className={`flex-1 rounded-full px-4 py-3 text-sm font-semibold transition ${mode === "prompt" ? "bg-white text-black" : "text-[var(--muted)]"}`}
            >
              Prompt Mode
            </button>
            <button
              type="button"
              onClick={() => setMode("lyrics")}
              className={`flex-1 rounded-full px-4 py-3 text-sm font-semibold transition ${mode === "lyrics" ? "bg-white text-black" : "text-[var(--muted)]"}`}
            >
              Custom Lyrics
            </button>
          </div>

          <div className="mt-6">
            {mode === "prompt" ? (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                className="w-full rounded-[24px] border border-[var(--line)] bg-black/25 px-5 py-4 outline-none placeholder:text-[var(--muted)]"
                placeholder="e.g. Turn this into a motivational Afrobeats song"
              />
            ) : (
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                rows={10}
                className="w-full rounded-[24px] border border-[var(--line)] bg-black/25 px-5 py-4 outline-none placeholder:text-[var(--muted)]"
                placeholder="Paste your full custom lyrics here"
              />
            )}
          </div>

          <div className="mt-6 rounded-[24px] border border-[var(--line)] bg-black/20 p-5">
            <label className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">Voice selection</label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="mt-4 w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-4 outline-none"
            >
              {voiceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="muted mt-3 text-sm leading-7">
              Future feature: upload a voice sample and clone the performer profile directly from your own reference audio.
            </p>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="mt-6 w-full rounded-2xl bg-[var(--accent)] px-5 py-4 text-base font-semibold text-slate-950 transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Generating Song..." : "Generate Song"}
          </button>
        </div>

        <div className="space-y-6">
          <section className="glass-panel rounded-[28px] p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--accent-warm)]">Job Tracking</p>
            <h2 className="section-title mt-3 text-3xl font-semibold">Real-time status, progress, and final output in one place.</h2>

            {(status || jobId || loading) ? (
              <div className="mt-6 rounded-[24px] border border-[var(--line)] bg-black/20 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.26em] text-[var(--muted)]">Status</div>
                    <div className="mt-2 text-2xl font-semibold capitalize text-white">{status || "idle"}</div>
                  </div>
                  {jobId && (
                    <div className="rounded-full border border-[var(--line)] bg-black/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white">
                      {jobId}
                    </div>
                  )}
                </div>

                <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-warm)_100%)] transition-all"
                    style={{ width: `${Math.max(5, Math.min(progress, 100))}%` }}
                  />
                </div>
                <p className="muted mt-3 text-sm">{progress}% complete</p>
              </div>
            ) : (
              <p className="muted mt-6 leading-7">
                Start a generation to see the music job ID, progress state, and completion status update automatically every few seconds.
              </p>
            )}

            {error && (
              <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </section>

          <section className="glass-panel rounded-[28px] p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--accent-warm)]">Output</p>
            <h2 className="section-title mt-3 text-3xl font-semibold">Preview the generated song and export it immediately.</h2>

            {outputUrl ? (
              <div className="mt-6 rounded-[24px] border border-[var(--line)] bg-black/20 p-5">
                <audio controls className="w-full">
                  <source src={outputUrl} />
                </audio>

                <div className="mt-5 break-all rounded-2xl border border-[var(--line)] bg-black/20 px-4 py-3 text-sm text-white/80">
                  {outputUrl}
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <a
                    href={outputUrl}
                    download
                    className="rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={loading}
                    className="rounded-2xl border border-[var(--line-strong)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted mt-6 leading-7">
                Once the job is complete, your generated audio will appear here with a built-in player and direct download action.
              </p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
