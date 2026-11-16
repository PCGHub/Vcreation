"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addOrUpdateJob, clearJobs, getStoredJobs, removeJob, type StoredJob } from "@/lib/jobHistory";
import { dedupeVideoOutputs, extractVideoOutputs, type NestedOutputValue } from "@/lib/videoOutputs";

type JobResponse = {
  job_id?: string;
  status?: string;
  progress?: number;
  output_url?: string;
  outputs?: NestedOutputValue;
  detail?: string;
  error?: string;
  [key: string]: any;
};

export default function JobsPage() {
  const API_BASE = "http://127.0.0.1:8000";

  const [jobId, setJobId] = useState("");
  const [jobResult, setJobResult] = useState<JobResponse | null>(null);
  const [history, setHistory] = useState<StoredJob[]>([]);

  const [loading, setLoading] = useState(false);
  const [autoPolling, setAutoPolling] = useState(true);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setHistory(getStoredJobs());
  }, []);

  function refreshHistory() {
    setHistory(getStoredJobs());
  }

  function clearMessages() {
    setError("");
    setSuccess("");
  }

  async function copyText(text: string, label = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess(`${label} ✅`);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  function fullUrl(path?: string) {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return `${API_BASE}${path}`;
  }

  function extractOutputs(data: JobResponse) {
    return dedupeVideoOutputs([
      ...extractVideoOutputs(data.output_url, fullUrl, ["primary_output"]),
      ...extractVideoOutputs(data.outputs, fullUrl, ["outputs"]),
    ]);
  }

  async function checkStatus(targetJobId?: string) {
    const id = (targetJobId || jobId).trim();
    if (!id) return;

    try {
      clearMessages();
      setLoading(true);

      const res = await fetch(`${API_BASE}/api/edit/status/${id}`);
      const data: JobResponse = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Status check failed");
      }

      setJobId(id);
      setJobResult(data);

      addOrUpdateJob({
        job_id: id,
        label: history.find((h) => h.job_id === id)?.label || `Job ${id.slice(0, 8)}`,
        source: "jobs",
        status: data.status || "unknown",
        progress: data.progress || 0,
        output_url: data.output_url,
        outputs: extractOutputs(data).map((item) => item.url),
        created_at: history.find((h) => h.job_id === id)?.created_at || new Date().toISOString(),
      });
      refreshHistory();

      if (data.status === "succeeded") {
        setSuccess("Job completed successfully ✅");
      } else if (data.status === "failed") {
        setError(data.error || "Job failed");
      } else {
        setSuccess(`Job status: ${data.status || "unknown"}`);
      }
    } catch (err: any) {
      setError(err.message || "Could not fetch job status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoPolling || !jobId) return;
    const terminal = jobResult?.status === "succeeded" || jobResult?.status === "failed";
    if (terminal) return;

    const interval = window.setInterval(() => {
      checkStatus();
    }, 2500);

    return () => window.clearInterval(interval);
  }, [autoPolling, jobId, jobResult?.status]);

  const outputs = useMemo(() => {
    if (!jobResult) return [];
    return extractOutputs(jobResult);
  }, [jobResult]);

  const progressValue = Number(jobResult?.progress || 0);

  return (
    <div style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Link
          href="/"
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #333", background: "#111", color: "#fff", fontWeight: 600 }}
        >
          Back Home
        </Link>
        <Link
          href="/dashboard"
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #333", background: "#1f6feb", color: "#fff", fontWeight: 600 }}
        >
          Back to Dashboard
        </Link>
      </div>

      <h1 style={{ fontSize: 30, fontWeight: 700, marginBottom: 6 }}>Jobs</h1>
      <p style={{ opacity: 0.8, marginBottom: 22 }}>
        Track Clayme jobs, monitor progress, and preview outputs.
      </p>

      <div style={{ padding: 18, borderRadius: 16, border: "1px solid #333", background: "rgba(255,255,255,0.03)" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Check Job Status</h2>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={autoPolling} onChange={(e) => setAutoPolling(e.target.checked)} />
            Auto-poll every 2.5s
          </label>
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr auto auto", alignItems: "end" }}>
          <div>
            <label style={{ display: "block", marginBottom: 6 }}>Job ID</label>
            <input
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              placeholder="Paste job ID here"
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #333", background: "rgba(255,255,255,0.04)", color: "inherit" }}
            />
          </div>

          <button onClick={() => checkStatus()} disabled={loading} style={{ padding: "10px 14px", background: "#1f6feb", color: "#fff", borderRadius: 10, border: "none", cursor: loading ? "not-allowed" : "pointer", fontWeight: 600 }}>
            {loading ? "Checking..." : "Check Status"}
          </button>

          <button onClick={() => copyText(jobId, "Job ID copied")} disabled={!jobId.trim()} style={{ padding: "10px 14px", background: "#111", color: "#fff", borderRadius: 10, border: "1px solid #333", cursor: !jobId.trim() ? "not-allowed" : "pointer", fontWeight: 600 }}>
            Copy Job ID
          </button>
        </div>

        {jobResult && (
          <div style={{ marginTop: 18 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ marginBottom: 6 }}><b>Status:</b> {jobResult.status || "unknown"}</div>
              <div style={{ marginBottom: 6 }}><b>Progress:</b> {progressValue}%</div>

              <div style={{ width: "100%", height: 12, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden", border: "1px solid #333" }}>
                <div style={{ width: `${Math.max(0, Math.min(100, progressValue))}%`, height: "100%", background: "#1f6feb", transition: "width 0.3s ease" }} />
              </div>
            </div>

            <pre style={{ marginTop: 16, padding: 14, borderRadius: 12, border: "1px solid #333", background: "rgba(255,255,255,0.04)", overflowX: "auto", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(jobResult, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div style={{ marginTop: 24, padding: 18, borderRadius: 16, border: "1px solid #333", background: "rgba(255,255,255,0.03)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Local Job History</h2>
          <button
            onClick={() => {
              clearJobs();
              refreshHistory();
            }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #333", background: "#551111", color: "white", cursor: "pointer" }}
          >
            Clear History
          </button>
        </div>

        {!history.length ? (
          <p style={{ opacity: 0.8 }}>No saved jobs yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {history.map((item) => (
              <div key={item.job_id} style={{ padding: 12, borderRadius: 12, border: "1px solid #333", background: "rgba(255,255,255,0.03)" }}>
                <div><b>{item.label}</b></div>
                <div style={{ opacity: 0.85, marginTop: 4 }}>Job ID: {item.job_id}</div>
                <div style={{ opacity: 0.85 }}>Status: {item.status || "unknown"} • Progress: {item.progress ?? 0}%</div>
                <div style={{ opacity: 0.7, marginTop: 4 }}>{new Date(item.created_at).toLocaleString()}</div>

                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => checkStatus(item.job_id)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #333", background: "#1f6feb", color: "white", cursor: "pointer" }}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => copyText(item.job_id, "Job ID copied")}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #333", background: "#111", color: "white", cursor: "pointer" }}
                  >
                    Copy ID
                  </button>
                  <button
                    onClick={() => {
                      removeJob(item.job_id);
                      refreshHistory();
                    }}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #333", background: "#551111", color: "white", cursor: "pointer" }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!!outputs.length && (
        <div style={{ marginTop: 24, padding: 18, borderRadius: 16, border: "1px solid #333", background: "rgba(255,255,255,0.03)" }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Job Outputs</h2>

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {outputs.map((output, idx) => (
              <div key={output.id || `${output.url}-${idx}`} style={{ padding: 12, borderRadius: 12, border: "1px solid #333", background: "rgba(255,255,255,0.03)" }}>
                <div style={{ marginBottom: 10, opacity: 0.85 }}>
                  <b>{output.group}</b> • {output.label}
                </div>
                <video controls style={{ width: "100%", borderRadius: 10, marginBottom: 10 }}>
                  <source src={output.url} />
                </video>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <a href={output.url} target="_blank" rel="noreferrer" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #333", textDecoration: "none", color: "white" }}>
                    Open
                  </a>
                  <a href={output.url} download style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #333", textDecoration: "none", color: "white" }}>
                    Download
                  </a>
                  <button
                    onClick={() => copyText(output.url, "Output link copied")}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #333", background: "#111", color: "white", cursor: "pointer" }}
                  >
                    Copy Link
                  </button>
                </div>

                <div style={{ marginTop: 10, wordBreak: "break-all", opacity: 0.85 }}>
                  {output.url}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #7a1f1f", background: "rgba(255,0,0,0.08)" }}>
          <b>Error:</b> {error}
        </div>
      )}

      {success && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #1f6f3f", background: "rgba(0,255,120,0.08)" }}>
          <b>Success:</b> {success}
        </div>
      )}
    </div>
  );
}
