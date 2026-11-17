"use client";

import { API_BASE } from "@/lib/api";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { addOrUpdateJob } from "@/lib/jobHistory";
import { saveSingleClip } from "@/lib/clipStore";
import { supabase } from "@/lib/supabase";
import { dedupeVideoOutputs, extractVideoOutputs, type NestedOutputValue, type VideoOutputItem } from "@/lib/videoOutputs";

type EditStatusResponse = {
  job_id?: string;
  status?: string;
  progress?: number;
  output_url?: string;
  outputs?: NestedOutputValue;
  detail?: string;
  error?: string;
};

export default function UploadPage() {
  const modeOptions = [
    { value: "viral", label: "Viral Edit" },
    { value: "cartoon", label: "Clay / Cartoon" },
    { value: "cinematic", label: "Cinematic" },
    { value: "story", label: "Storytelling" },
  ];

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState("viral");
  const [loading, setLoading] = useState(false);
  const [outputs, setOutputs] = useState<VideoOutputItem[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [outputRefreshToken, setOutputRefreshToken] = useState(Date.now());
  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }

      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  const fullUrl = (path?: string | null) => {
    if (!path) return null;
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `${API_BASE}${path}`;
  };

  const extractOutputs = (data: EditStatusResponse) => {
    return dedupeVideoOutputs([
      ...extractVideoOutputs(data.output_url, (path) => fullUrl(path) || "", ["primary_output"]),
      ...extractVideoOutputs(data.outputs, (path) => fullUrl(path) || "", ["outputs"]),
    ]);
  };

  const handleFile = (nextFile: File) => {
    if (preview) {
      URL.revokeObjectURL(preview);
    }

    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
    setOutputs([]);
    setJobId(null);
    setProgress(0);
    setStatus("");
  };

  const uploadFile = async (selectedFile: File) => {
    const formData = new FormData();
    formData.append("file", selectedFile);

    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.error || "Upload failed");
    }

    const ref = data.ref || data.url || data.path;
    if (!ref) {
      throw new Error("Upload succeeded but no file reference was returned");
    }

    return ref as string;
  };

  const saveProject = async (outputUrl: string) => {
    if (!supabase) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user ?? null;

    if (!user) return;

    await supabase.from("projects").insert([
      {
        user_id: user.id,
        type: "video",
        prompt: prompt.trim(),
        output_url: outputUrl,
      },
    ]);
  };

  const pollJobStatus = (id: string) => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/edit/status/${id}`);
        const data: EditStatusResponse = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || data.error || "Could not fetch job status");
        }

        setStatus(data.status || "processing");
        setProgress(Math.max(5, Number(data.progress || 0)));

        addOrUpdateJob({
          job_id: id,
          label: "Dashboard upload edit",
          source: "upload",
          status: data.status || "processing",
          progress: Number(data.progress || 0),
          output_url: data.output_url,
          outputs: extractOutputs(data).map((item) => item.url),
          created_at: new Date().toISOString(),
        });

        if (data.status === "completed" || data.status === "succeeded") {
          if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          const nextOutputs = extractOutputs(data);
          setOutputs(nextOutputs);
          setOutputRefreshToken(Date.now());
          setProgress(100);
          setLoading(false);

          if (nextOutputs[0]?.url) {
            await saveProject(nextOutputs[0].url);
          }
        }

        if (data.status === "failed") {
          if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }

          setLoading(false);
          setStatus("failed");
          alert(data.error || "Video generation failed");
        }
      } catch (err) {
        if (pollIntervalRef.current) {
          window.clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        setLoading(false);
        setStatus("failed");
        console.error(err);
        alert(err instanceof Error ? err.message : "Could not track job status");
      }
    }, 2000);
  };

  const handleGenerate = async () => {
    if (!file || !prompt.trim()) {
      alert("Upload a video and enter a prompt");
      return;
    }

    setLoading(true);
    setOutputs([]);
    setJobId(null);
    setProgress(0);
    setStatus("uploading");

    try {
      const ref = await uploadFile(file);
      saveSingleClip(ref);
      setStatus("starting");

      const res = await fetch(`${API_BASE}/api/edit/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          mode,
          clips: [{ id: 1, ref }],
        }),
      });

      const data: EditStatusResponse = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || data.error || "Could not start generation");
      }

      const immediateOutputs = extractOutputs(data);
      const firstImmediateOutput = immediateOutputs[0];

      if (firstImmediateOutput && !data.job_id) {
        setOutputs(immediateOutputs);
        setOutputRefreshToken(Date.now());
        setStatus("succeeded");
        setProgress(100);
        setLoading(false);
        await saveProject(firstImmediateOutput.url);
        return;
      }

      if (!data.job_id) {
        throw new Error("No job ID or output URL was returned");
      }

      setJobId(data.job_id);
      setStatus(data.status || "processing");
      addOrUpdateJob({
        job_id: data.job_id,
        label: "Dashboard upload edit",
        source: "upload",
        status: data.status || "processing",
        progress: 0,
        created_at: new Date().toISOString(),
      });
      pollJobStatus(data.job_id);
    } catch (err) {
      setLoading(false);
      setStatus("failed");
      console.error(err);
      alert(err instanceof Error ? err.message : "Error generating video");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white px-4">
      <h1 className="text-5xl font-bold mb-4 text-center">Create Viral Video</h1>

      <p className="text-gray-400 mb-10 text-center max-w-xl">
        Upload your content and let Vcreation transform it into viral clips.
      </p>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-2xl bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 space-y-6"
      >
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-600 rounded-xl p-8 cursor-pointer hover:border-white transition">
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const nextFile = e.target.files?.[0];
              if (nextFile) {
                handleFile(nextFile);
              }
            }}
          />

          {file ? (
            <p className="text-sm text-gray-300">{file.name}</p>
          ) : (
            <p className="text-gray-400">Click to upload or drag video here</p>
          )}
        </label>

        {preview && <video src={preview} controls className="w-full rounded-lg" />}

        <input
          className="w-full p-3 rounded-lg bg-black/40 border border-gray-700 outline-none"
          placeholder="Describe your video..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-black/40 p-3 outline-none"
          >
            {modeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-gray-400">
            Prompt and mode work together. If the backend only edits lightly, it may still return footage close to the source.
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full bg-white text-black py-3 rounded-lg font-semibold hover:scale-105 transition disabled:opacity-60 disabled:hover:scale-100"
        >
          {loading ? "Processing..." : "Generate"}
        </button>

        {(status || jobId) && (
          <div className="rounded-lg border border-white/10 bg-black/30 p-4 text-sm text-gray-300 space-y-2">
            <p>Status: {status || "idle"}</p>
            {jobId && <p>Job ID: {jobId}</p>}
            {loading && (
              <>
                <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-white transition-all"
                    style={{ width: `${Math.max(5, Math.min(progress, 100))}%` }}
                  />
                </div>
                <p>{progress}%</p>
              </>
            )}
          </div>
        )}
      </motion.div>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
        {outputs.map((output, index) => (
          <div key={output.id || `${output.url}-${index}`} className="space-y-3">
            <div className="text-sm text-gray-300">
              {output.group} • {output.label}
            </div>
            <video
              key={`${output.url}-${outputRefreshToken}`}
              src={`${output.url}?t=${outputRefreshToken}`}
              controls
              className="rounded-xl w-full"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
