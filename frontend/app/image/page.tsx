"use client";

import { useState } from "react";
import Link from "next/link";

type ImageResponse = {
  url?: string;
  detail?: string;
  [key: string]: unknown;
};

export default function ImagePage() {
  const API_BASE = "http://127.0.0.1:8000";

  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [result, setResult] = useState<ImageResponse | null>(null);
  const [error, setError] = useState("");

  async function handleGenerateImage() {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setError("Prompt is required");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setImageUrl("");
      setResult(null);

      const res = await fetch(`${API_BASE}/api/generate/image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: cleanPrompt,
          aspect_ratio: aspectRatio,
        }),
      });

      const data: ImageResponse = await res.json();

      if (!res.ok) {
        throw new Error(String(data?.detail || "Image generation failed"));
      }

      setResult(data);
      if (typeof data.url === "string") {
        setImageUrl(data.url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="clayme-shell min-h-screen px-4 py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="glass-panel rounded-[28px] p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-[var(--accent)]">Image Lab</p>
              <h1 className="section-title mt-3 text-4xl font-semibold">Generate visual concepts with AI</h1>
              <p className="muted mt-4 max-w-2xl leading-8">
                Create thumbnails, campaign images, visual moodboards, or concept art to support your content workflow.
              </p>
            </div>
            <Link href="/dashboard" className="rounded-2xl border border-[var(--line-strong)] px-5 py-3 text-sm font-semibold transition hover:bg-white hover:text-slate-950">
              Open dashboard
            </Link>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="glass-panel rounded-[28px] p-6">
            <h2 className="section-title text-2xl font-semibold">Prompt Builder</h2>
            <div className="mt-6 grid gap-4">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A cinematic portrait of a creator in neon city light, editorial, crisp focus"
                rows={7}
                className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-4 outline-none placeholder:text-[var(--muted)]"
              />

              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-4 outline-none"
              >
                <option value="1:1">1:1 square</option>
                <option value="16:9">16:9 landscape</option>
                <option value="9:16">9:16 portrait</option>
                <option value="4:5">4:5 feed</option>
              </select>
            </div>

            <button
              onClick={handleGenerateImage}
              disabled={loading || !prompt.trim()}
              className="mt-6 rounded-2xl bg-[var(--accent)] px-5 py-3 font-semibold text-slate-950 transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Generating..." : "Generate Image"}
            </button>

            {error && (
              <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>

          <div className="glass-panel rounded-[28px] p-6">
            <h2 className="section-title text-2xl font-semibold">Preview</h2>
            {!imageUrl && !loading && (
              <div className="mt-6 rounded-[24px] border border-dashed border-[var(--line-strong)] bg-black/20 p-8 text-center text-[var(--muted)]">
                Your generated image will appear here.
              </div>
            )}

            {loading && (
              <div className="mt-6 rounded-[24px] border border-[var(--line)] bg-black/20 p-8 text-center text-white">
                Generating image...
              </div>
            )}

            {imageUrl && (
              <div className="mt-6">
                <img src={imageUrl} alt="Generated by Clayme AI" className="w-full rounded-[24px] border border-[var(--line)]" />
                <div className="mt-4 flex gap-3">
                  <a href={imageUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950">
                    Open
                  </a>
                  <a href={imageUrl} download className="rounded-xl border border-[var(--line-strong)] px-4 py-2 text-sm font-semibold text-white">
                    Download
                  </a>
                </div>
              </div>
            )}

            {result && (
              <pre className="mt-6 overflow-x-auto rounded-[24px] border border-[var(--line)] bg-black/20 p-4 text-xs text-[var(--muted)]">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
