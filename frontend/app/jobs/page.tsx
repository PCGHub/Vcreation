"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { money } from "@/lib/studio";
type Entry = { id: string; kind: string; project_id: string | null; project_title: string; title: string; status: string; progress: number | null; created_at: string; error: string | null; output_urls: string[]; estimated_usd: number | null; actual_usd: number | null };
const running = (status: string) => ["queued", "processing", "pending", "running"].includes(status);
export default function JobsPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setEntries(await api<Entry[]>("/history")); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "We couldn't load render history."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const active = entries.some(entry => running(entry.status));
  useEffect(() => { if (!active) return; const timer = window.setInterval(() => void load(), 4000); return () => window.clearInterval(timer); }, [active, load]);
  const visible = entries.filter(entry => (filter === "All" || (filter === "In progress" ? running(entry.status) : filter === "Ready" ? ["succeeded", "completed"].includes(entry.status) : ["failed", "error", "interrupted", "canceled"].includes(entry.status))) && `${entry.title} ${entry.project_title}`.toLowerCase().includes(search.toLowerCase()));
  return <main id="workspace" className="workspace-tool workspace-history"><header className="workspace-page-heading"><p>YOUR PRODUCTION RECORD</p><h1>Render history</h1><div>Previews, film exports, and editing versions together. History is saved with your workspace.</div></header><div className="workspace-history-toolbar"><div role="group" aria-label="Filter renders">{["All", "In progress", "Ready", "Needs attention"].map(item => <button key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div><label>Find a render<input type="search" placeholder="Search films or shots" value={search} onChange={event => setSearch(event.target.value)} /></label><button onClick={() => { setLoading(true); void load(); }} disabled={loading}>Refresh</button></div>{error && <p role="alert" className="workspace-error">{error}</p>}{loading && !entries.length ? <p role="status">Loading your renders…</p> : !visible.length ? <section className="workspace-empty"><h2>{entries.length ? "No matching renders." : "Your first render starts with a shot."}</h2><p>{entries.length ? "Try a different filter or search." : "Create a storyboard in Film studio. Your previews and exports will appear here automatically."}</p><Link href="/studio" className="workspace-primary">Open Film studio</Link></section> : <div className="workspace-history-grid">{visible.map(entry => <article key={`${entry.kind}-${entry.id}`} className="workspace-history-card"><div className="workspace-history-meta"><span>{entry.kind === "take" ? "Shot preview / take" : entry.kind === "export" ? "Film export" : "Footage edit"}</span><span className={`workspace-status status-${entry.status}`}>{running(entry.status) ? "In progress" : entry.status === "succeeded" || entry.status === "completed" ? "Ready" : entry.status === "interrupted" ? "Interrupted" : entry.status}</span></div><h2>{entry.title}</h2><p>{entry.project_title} · {new Date(entry.created_at).toLocaleString()}</p>{running(entry.status) && <progress max={100} {...(entry.progress === null ? {} : { value: entry.progress })} aria-label="Render progress" />}{entry.error && <p className="workspace-error">{entry.error}</p>}{entry.output_urls.map((url, index) => <div key={url}><video controls preload="none" src={mediaUrl(url)} aria-label={`${entry.title} output ${index + 1}`} /><a className="workspace-download" href={mediaUrl(url)} download>Download {entry.output_urls.length > 1 ? `version ${index + 1}` : "video"}</a></div>)}{entry.project_id && <Link href="/studio" className="workspace-download" onClick={() => { try { localStorage.setItem("vcreation.active-project.v1", entry.project_id || ""); } catch {} }}>Open film</Link>}<details><summary>Technical details</summary><p>Job ID: <code>{entry.id}</code></p>{entry.estimated_usd !== null && <p>Provider estimate: {money(entry.estimated_usd)} · Recorded charge: {entry.actual_usd === null ? "not reconciled" : money(entry.actual_usd)}</p>}</details></article>)}</div>}</main>;
}
