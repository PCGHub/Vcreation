"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE, jsonBody, MAX_UPLOAD_BYTES, readResponse, requestJSON } from "@/lib/api";
import { useDraft } from "@/lib/use-draft";
import { getMultiClips, getSingleClip, saveMultiClips, saveSingleClip } from "@/lib/clipStore";
import { dedupeVideoOutputs, extractVideoOutputs, type NestedOutputValue } from "@/lib/videoOutputs";
type EditJob = { job_id?: string; status?: string; progress?: number; error?: string; output_url?: string; outputs?: NestedOutputValue };
const terminal = (status: string) => ["succeeded", "completed", "failed", "error"].includes(status);
const media = (path?: string | null) => !path ? "" : path.startsWith("/") ? API_BASE + path : path;
export default function VideoPage() {
  const [clips, setClips] = useState<string[]>([]);
  const [style, setStyle] = useDraft("vcreation.edit-style.v1", "clean");
  const [notes, setNotes] = useDraft("vcreation.edit-notes.v1", "");
  const [count, setCount] = useDraft("vcreation.edit-count.v1", 1);
  const [jobId, setJobId] = useDraft("vcreation.edit-job.v1", "");
  const [job, setJob] = useState<EditJob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const saved = getMultiClips(); const single = getSingleClip(); setClips(saved.length ? saved : single ? [single] : []); }, []);
  const active = !!jobId && !terminal(job?.status || "");
  useEffect(() => {
    if (!jobId || terminal(job?.status || "")) return;
    const controller = new AbortController(); let inFlight = false;
    async function poll() {
      if (inFlight) return; inFlight = true;
      try { const data = await requestJSON<EditJob>(`/api/edit/status/${encodeURIComponent(jobId)}`, { signal: controller.signal }); if (!controller.signal.aborted) { setJob(data); if (data.status === "failed" || data.status === "error") setError(data.error || "The edit did not finish. Review your clips and try again."); } }
      catch (error) { if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : "We couldn't check this edit."); setJob({ status: "error" }); } }
      finally { inFlight = false; }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 2500);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [jobId, job?.status]);
  function keepClips(next: string[]) { setClips(next); saveMultiClips(next); saveSingleClip(next[0] || ""); }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError("");
    try {
      const selected = Array.from(files);
      if (selected.some(file => file.size > MAX_UPLOAD_BYTES)) throw new Error("Choose a video under 4 MB. Larger footage uploads are not supported by this connection yet.");
      if (clips.length + selected.length > 30) throw new Error("An edit supports up to 30 clips.");
      const next = [...clips];
      for (const file of selected) {
        const body = new FormData(); body.append("file", file);
        const data = await readResponse<{ path: string }>(await fetch(`${API_BASE}/api/upload`, { method: "POST", body }));
        next.push(data.path); keepClips([...next]);
      }
    } catch (error) { setError(error instanceof Error && error.name !== "TypeError" ? error.message : "We couldn't upload your footage. Check your connection and try again."); }
    finally { setUploading(false); }
  }
  async function render() {
    setSubmitting(true); setError("");
    try {
      const data = await requestJSON<EditJob>("/api/edit/run-multi", { method: "POST", body: jsonBody({ clips: clips.map((ref, index) => ({ id: index + 1, ref })), mode: style, num_outputs: Math.min(3, Math.max(1, count)), prompt: notes }) });
      if (!data.job_id) throw new Error("We couldn't start this edit. Please try again.");
      setJob({ status: "queued", progress: 0 }); setJobId(data.job_id);
    } catch (error) { setError(error instanceof Error ? error.message : "We couldn't start this edit."); }
    finally { setSubmitting(false); }
  }
  const outputs = job ? dedupeVideoOutputs([...extractVideoOutputs(job.output_url, media), ...extractVideoOutputs(job.outputs, media)]) : [];
  const busy = active || uploading || submitting;
  const preview = outputs[0]?.url || media(clips[0]);
  return <main id="workspace" className="workspace-tool workspace-editor"><header className="workspace-page-heading"><p>MAKE THE FINAL CUT</p><h1>Footage editor</h1><div>Arrange your selected takes, choose an editing style, and export.</div></header><div className="workspace-edit-layout"><section className="workspace-edit-canvas"><div className="workspace-preview-heading"><h2>Preview</h2><span>{active ? "Rendering…" : outputs.length ? "Edit ready" : "Source footage"}</span></div>{preview ? <video controls className="workspace-main-video" src={preview} aria-label="Edit preview" /> : <div className="workspace-preview-empty"><span>▷</span><strong>Your next cut starts here.</strong><p>Import a short video or choose takes in Film studio.</p><Link href="/studio">Choose film takes</Link></div>}<div className="workspace-clips-heading"><h2>Your clips <span>({clips.length})</span></h2><label className="workspace-upload-button">{uploading ? "Uploading…" : "Import video"}<input type="file" accept="video/*" multiple disabled={busy} onChange={event => void upload(event.target.files)} /></label></div><p className="workspace-help">Up to 4 MB per file, 30 clips per edit. Clips play in the order shown.</p><div className="workspace-clip-list">{clips.map((url, index) => <div key={`${url}-${index}`}><span>Clip {index + 1}</span><button disabled={busy || index === 0} aria-label={`Move clip ${index + 1} earlier`} onClick={() => { const next = [...clips]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; keepClips(next); }}>↑</button><button disabled={busy || index === clips.length - 1} aria-label={`Move clip ${index + 1} later`} onClick={() => { const next = [...clips]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; keepClips(next); }}>↓</button><button disabled={busy} aria-label={`Remove clip ${index + 1}`} onClick={() => keepClips(clips.filter((_, position) => position !== index))}>Remove</button></div>)}</div></section><section className="workspace-edit-controls"><h2>Edit settings</h2><label htmlFor="edit-style">Starting style</label><select id="edit-style" value={style} onChange={event => setStyle(event.target.value)} disabled={busy}><option value="clean">Clean cuts</option><option value="crossfade">Soft crossfades</option><option value="punch-in">Subtle punch-ins</option></select><label htmlFor="edit-count">Number of versions</label><select id="edit-count" value={count} onChange={event => setCount(Number(event.target.value))} disabled={busy}><option value={1}>1 version</option><option value={2}>2 versions</option><option value={3}>3 versions</option></select><p className="workspace-help">Additional versions use the other available styles. This editor does not generate new scenes.</p><label htmlFor="edit-notes">Production notes (optional)</label><textarea id="edit-notes" rows={4} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Notes for your project record" /><p className="workspace-help">Notes are saved with the job. Editing style controls the actual cut.</p><button className="workspace-primary" disabled={busy || !clips.length} onClick={() => void render()}>{active ? "Rendering your edit…" : submitting ? "Starting edit…" : `Render ${count} ${count === 1 ? "version" : "versions"}`}</button>{active && <progress max={100} value={job?.progress || 0} aria-label="Editing progress" />}<Link className="workspace-download" href="/jobs">View render history</Link>{error && <p role="alert" className="workspace-error">{error}</p>}</section></div>{!!outputs.length && <section className="workspace-output-section"><h2>Your finished cuts</h2><div className="workspace-history-grid">{outputs.map((output, index) => <article className="workspace-history-card" key={output.url}><h3>Version {index + 1}</h3><video controls preload="metadata" src={output.url} aria-label={`Editing version ${index + 1}`} /><a className="workspace-download" href={output.url} download>Download version {index + 1}</a></article>)}</div></section>}</main>;
}
