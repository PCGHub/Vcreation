"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { API_BASE, api, jsonBody, mediaUrl, MAX_UPLOAD_BYTES } from "@/lib/api";
import { Capabilities, Job, money, Project, ProjectSummary, Quote, Shot } from "@/lib/studio";
import { useDraft } from "@/lib/use-draft";
import { saveMultiClips } from "@/lib/clipStore";

const emptyShot = { title: "", prompt: "", dialogue: "", duration: 5, character_ids: [] as string[] };
const field = "w-full rounded-xl border border-white/15 bg-slate-950/60 p-3 text-sm text-white outline-none focus:border-teal-300";
const button = "rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} border-teal-300/30 bg-teal-300 text-slate-950 hover:bg-teal-200`;
const isActive = (job: Job) => job.status === "queued" || job.status === "running";

export default function StudioPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState<"preview" | "replicate">("preview");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [title, setTitle] = useDraft("vcreation.new-film-title.v1", "");
  const [story, setStory] = useDraft("vcreation.new-film-story.v1", "");
  const [budget, setBudget] = useDraft("vcreation.new-film-budget.v1", "0");
  const [actor, setActor] = useDraft(`vcreation.actor-draft.${selectedId}`, { name: "", description: "", wardrobe: "", voice_notes: "" });
  const [reference, setReference] = useState<File | null>(null);
  const [shotForm, setShotForm] = useDraft(`vcreation.shot-draft.${selectedId}`, emptyShot);
  const [editingShot, setEditingShot] = useDraft<string | null>(`vcreation.shot-edit.${selectedId}`, null);
  const [showNewProject, setShowNewProject] = useState(false);
  const hasActiveJobs = project?.jobs.some(isActive) || false;

  useEffect(() => {
    let active = true;
    try {
      const brief = JSON.parse(sessionStorage.getItem("vcreation.studio-brief.v1") || "null");
      if (brief && typeof brief.title === "string" && typeof brief.story === "string") {
        setShowNewProject(true);
        setTitle(brief.title.slice(0, 120));
        setStory(brief.story.slice(0, 6000));
        sessionStorage.removeItem("vcreation.studio-brief.v1");
      }
    } catch { /* The studio remains available if browser storage is blocked. */ }
    Promise.all([api<ProjectSummary[]>("/projects"), api<Capabilities>("/capabilities")])
      .then(([list, caps]) => {
        if (!active) return;
        setProjects(list); setCapabilities(caps);
        let remembered = "";
        try { remembered = localStorage.getItem("vcreation.active-project.v1") || ""; } catch { /* Optional browser preference. */ }
        setSelectedId(list.some((item) => item.id === remembered) ? remembered : list[0]?.id || "");
      }).catch((err: Error) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [setStory, setTitle]);

  useEffect(() => {
    if (!selectedId) return;
    try { localStorage.setItem("vcreation.active-project.v1", selectedId); } catch { /* Selection still works without persistence. */ }
    let active = true;
    api<Project>(`/projects/${selectedId}`).then((value) => { if (active) setProject(value); })
      .catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !hasActiveJobs) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      try {
        const value = await api<Project>(`/projects/${selectedId}`, { signal: controller.signal });
        if (!controller.signal.aborted) setProject(value);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not refresh jobs");
      }
    }, 2000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [selectedId, hasActiveJobs]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Request failed"); }
    finally { setBusy(false); }
  }

  async function refresh(id = selectedId) {
    const value = await api<Project>(`/projects/${id}`);
    setProject(value);
  }

  async function createProject() {
    const value = await api<Project>("/projects", { method: "POST", body: jsonBody({ title, story, budget_usd: Number(budget) }) });
    setProjects(await api<ProjectSummary[]>("/projects"));
    setSelectedId(value.id); setProject(value); setShowNewProject(false); setTitle(""); setStory("");
    setQuotes({});
  }

  async function sampleProject() {
    const value = await api<Project>("/projects", { method: "POST", body: jsonBody({ title: "The last interview", story: "Two investigators discover that a witness knew about the missing letter before the crime was reported.", budget_usd: 0 }) });
    const cast = [];
    for (const character of [
      { name: "Mara", description: "Investigative partner, composed and observant", wardrobe: "Navy jacket, cream shirt", voice_notes: "Quiet, precise, deliberate pauses" },
      { name: "Elias", description: "Lead investigator, tired but attentive", wardrobe: "Charcoal coat, dark shirt", voice_notes: "Low, measured, controlled tension" },
    ]) cast.push(await api<{ id: string }>(`/projects/${value.id}/characters`, { method: "POST", body: jsonBody(character) }));
    for (const [index, beat] of [
      ["The room", "Wide establishing shot of a quiet interview room. Mara sits opposite Elias. Cold practical light, restrained camera.", "Mara: You said the letter was missing."],
      ["The question", "Close-up on Elias. Same room and wardrobe, camera remains on the same side of the table. He hesitates.", "Elias: That detail was never made public."],
      ["The reveal", "Reaction close-up on Mara. She lowers her eyes toward the evidence folder. Keep the lighting and eyeline consistent.", "Mara: Then how did the witness know?"],
    ].entries()) await api(`/projects/${value.id}/shots`, { method: "POST", body: jsonBody({ title: `${index + 1}. ${beat[0]}`, prompt: beat[1], dialogue: beat[2], duration: 5, character_ids: cast.map((c) => c.id) }) });
    setProjects(await api<ProjectSummary[]>("/projects")); setSelectedId(value.id); await refresh(value.id);
    setQuotes({});
  }

  async function addCharacter() {
    if (!project) return;
    let image_path: string | null = null;
    if (reference) {
      if (reference.size > MAX_UPLOAD_BYTES) throw new Error("Choose a reference image under 4 MB.");
      const form = new FormData(); form.append("file", reference);
      image_path = (await api<{ path: string }>("/references", { method: "POST", body: form })).path;
    }
    await api(`/projects/${project.id}/characters`, { method: "POST", body: jsonBody({ ...actor, image_path }) });
    setActor({ name: "", description: "", wardrobe: "", voice_notes: "" }); setReference(null);
    const input = document.getElementById("reference-image") as HTMLInputElement | null;
    if (input) input.value = "";
    await refresh();
  }

  async function saveShot() {
    if (!project) return;
    await api(editingShot ? `/shots/${editingShot}` : `/projects/${project.id}/shots`, { method: editingShot ? "PUT" : "POST", body: jsonBody(shotForm) });
    setShotForm(emptyShot); setEditingShot(null); setQuotes({}); await refresh();
  }

  async function quoteShot(shot: Shot) {
    const value = await api<Quote>(`/shots/${shot.id}/quote`, { method: "POST", body: jsonBody({ provider }) });
    setQuotes((previous) => ({ ...previous, [shot.id]: { ...value, requestId: crypto.randomUUID() } }));
  }

  async function generateTake(shot: Shot) {
    const quote = quotes[shot.id];
    await api(`/shots/${shot.id}/takes`, { method: "POST", body: jsonBody({ quote_id: quote.id, request_id: quote.requestId }) });
    setQuotes((previous) => { const copy = { ...previous }; delete copy[shot.id]; return copy; });
    await refresh();
  }

  async function moveShot(index: number, direction: number) {
    if (!project) return;
    const ids = project.shots.map((shot) => shot.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    await api(`/projects/${project.id}/order`, { method: "PUT", body: jsonBody({ shot_ids: ids }) });
    setQuotes({}); await refresh();
  }

  const readyForExport = !!project?.shots.length && project.shots.every((shot) => shot.approved && shot.selected_take_id);
  const exports = project?.jobs.filter((job) => job.kind === "export") || [];

  return (
    <main id="workspace" className="workspace-tool workspace-studio mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-8">
      <header className="workspace-page-heading">
        <p>DIRECT YOUR STORY</p><h1>Film studio</h1>
        <div>Keep your cast, storyboard, takes, and final cut together.</div>
      </header>
      <div className="workspace-notice">
        <span className="workspace-notice-dot" />Pilot workspace · Previews use still boards and silence. Paid AI generation is off until configured.
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-400/40 bg-red-950/40 p-4 text-red-200">{error}</div>}
      <section className="workspace-project-controls" aria-label="Film selection">
        <label htmlFor="current-film">Current film<select id="current-film" value={selectedId} disabled={busy || !loaded} onChange={event => { setProject(null); setSelectedId(event.target.value); setQuotes({}); }}><option value="" disabled>{loaded ? "Choose or create a film" : "Loading films…"}</option>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <button className={button} onClick={() => setShowNewProject(!showNewProject)}>{showNewProject ? "Close new film" : "New film"}</button>
        <button className={button} disabled={busy || !loaded} onClick={() => perform(sampleProject)}>Try sample storyboard</button>
      </section>
      {(showNewProject || (loaded && !projects.length)) && (
          <form className="glass-panel workspace-new-project space-y-4 rounded-2xl p-5" onSubmit={(event) => { event.preventDefault(); void perform(createProject); }}>
            <h2 className="text-lg font-semibold">New project</h2>
            <label className="block text-sm">Film title<input required maxLength={120} className={`${field} mt-2`} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="block text-sm">Story or outline<textarea className={`${field} mt-2`} rows={4} value={story} maxLength={20000} onChange={(e) => setStory(e.target.value)} /></label>
            <label className="block text-sm">Estimated generation budget (USD)<input type="number" min="0" max="10000" step="0.01" required className={`${field} mt-2`} value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
            <p className="text-xs leading-5 text-slate-400">A planning allowance, not a provider billing cap. A $0 project supports local previews.</p>
            <button className={`${primary} w-full`} disabled={busy || !loaded}>Create project</button>
          </form>
      )}
      <section className="workspace-studio-content">
        {!project ? <div className="glass-panel flex min-h-96 items-center justify-center rounded-3xl p-10 text-center text-slate-400">{selectedId ? "Loading project…" : "Create a project or try the detective storyboard to begin."}</div> : <div className="min-w-0 space-y-7">
          <section className="glass-panel rounded-3xl p-6">
            <p className="text-xs uppercase tracking-widest text-teal-300">Production workspace</p><h2 className="mt-2 text-3xl font-semibold">{project.title}</h2><p className="mt-3 whitespace-pre-wrap text-slate-300">{project.story}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">{[["Planned duration", `${project.shots.reduce((sum, s) => sum + s.duration, 0)} seconds`], ["Planning budget", money(project.budget_usd)], ["Reserved estimates", money(project.costs.reserved_usd)], ["Recorded provider charges", money(project.costs.actual_usd)]].map(([label, value]) => <div key={label} className="rounded-xl bg-black/20 p-3"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div>
            <p className="mt-3 text-xs text-slate-400">{project.costs.unreconciled_paid_jobs} paid take(s) awaiting billing reconciliation. Local preview/export provider charges are $0; local compute is not included.</p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-teal-200"><a href={`${API_BASE}/api/studio/projects/${project.id}/costs.csv`} download>Download cost ledger</a><a href={`${API_BASE}/api/studio/projects/${project.id}/manifest`} download>Download project manifest</a></div>
          </section>
          <section className="glass-panel rounded-3xl p-6"><h2 className="text-2xl font-semibold">01 / Keep your cast recognizable</h2><p className="mt-2 text-sm text-slate-400">Reuse the same references, appearance and voice direction. References help; they do not guarantee identity or acting quality.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">{project.characters.map((person) => <article key={person.id} className="flex gap-4 rounded-xl border border-white/10 p-4">{person.image_path && <Image unoptimized width={80} height={96} src={mediaUrl(person.image_path)} alt={`${person.name} reference`} className="h-24 w-20 rounded-lg object-cover" />}<div><h3 className="font-semibold">{person.name}</h3><p className="mt-1 text-sm text-slate-400">{person.description}</p><p className="mt-1 text-sm text-slate-400">{person.wardrobe}</p><p className="mt-1 text-xs text-teal-200">{person.voice_notes}</p></div></article>)}</div>
            <form onSubmit={(e) => { e.preventDefault(); void perform(addCharacter); }} className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Character name<input required maxLength={80} className={`${field} mt-1`} value={actor.name} onChange={(e) => setActor({ ...actor, name: e.target.value })} /></label>
              <label className="text-sm">Appearance<input maxLength={2000} className={`${field} mt-1`} value={actor.description} onChange={(e) => setActor({ ...actor, description: e.target.value })} /></label>
              <label className="text-sm">Wardrobe<input maxLength={1000} className={`${field} mt-1`} value={actor.wardrobe} onChange={(e) => setActor({ ...actor, wardrobe: e.target.value })} /></label>
              <label className="text-sm">Voice direction<input maxLength={1000} className={`${field} mt-1`} value={actor.voice_notes} onChange={(e) => setActor({ ...actor, voice_notes: e.target.value })} /></label>
              <label className="text-sm">Reference image (optional, up to 4 MB)<input id="reference-image" type="file" accept="image/png,image/jpeg,image/webp" className={`${field} mt-1`} onChange={(e) => setReference(e.target.files?.[0] || null)} /></label>
              <button className={`${button} self-end`} disabled={busy}>Save character</button>
            </form>
          </section>
          <section className="glass-panel rounded-3xl p-6"><h2 className="text-2xl font-semibold">02 / Plan the shot before rendering</h2>
            <form onSubmit={(e) => { e.preventDefault(); void perform(saveShot); }} className="mt-5 space-y-4">
              {editingShot && <p className="text-sm text-amber-200">Editing resets approval and take selection. Existing takes remain in history.</p>}
              <div className="grid gap-3 sm:grid-cols-[1fr_130px]"><label className="text-sm">Shot title<input required maxLength={120} className={`${field} mt-1`} value={shotForm.title} onChange={(e) => setShotForm({ ...shotForm, title: e.target.value })} /></label><label className="text-sm">Seconds<input required type="number" min="2" max="15" className={`${field} mt-1`} value={shotForm.duration} onChange={(e) => setShotForm({ ...shotForm, duration: Number(e.target.value) })} /></label></div>
              <label className="block text-sm">Action, framing, lighting and emotion<textarea required maxLength={6000} rows={3} className={`${field} mt-1`} value={shotForm.prompt} onChange={(e) => setShotForm({ ...shotForm, prompt: e.target.value })} /></label>
              <label className="block text-sm">Exact dialogue<textarea maxLength={3000} rows={2} className={`${field} mt-1`} value={shotForm.dialogue} onChange={(e) => setShotForm({ ...shotForm, dialogue: e.target.value })} /></label>
              <fieldset><legend className="text-sm">Cast in this shot (up to five)</legend><div className="mt-2 flex flex-wrap gap-4">{project.characters.map((person) => <label className="flex items-center gap-2 text-sm" key={person.id}><input type="checkbox" checked={shotForm.character_ids.includes(person.id)} onChange={(e) => setShotForm({ ...shotForm, character_ids: e.target.checked ? [...shotForm.character_ids, person.id] : shotForm.character_ids.filter((id) => id !== person.id) })} />{person.name}</label>)}</div></fieldset>
              <div className="flex gap-3"><button className={primary} disabled={busy}>{editingShot ? "Save revised shot" : "Add storyboard shot"}</button>{editingShot && <button className={button} type="button" onClick={() => { setEditingShot(null); setShotForm(emptyShot); }}>Cancel edit</button>}</div>
            </form>
          </section>
          <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-2xl font-semibold">03 / Review and choose your takes</h2><label className="text-sm">Render mode<select className={`${field} mt-1`} value={provider} onChange={(e) => { setProvider(e.target.value as "preview" | "replicate"); setQuotes({}); }}><option value="preview">Local animatic · $0 provider charge</option><option value="replicate" disabled={!capabilities?.replicate.ready}>Paid AI video{!capabilities?.replicate.ready ? " · not configured" : ""}</option></select></label></div>
            {!capabilities?.replicate.ready && <p className="text-xs leading-5 text-slate-400">{capabilities?.replicate.reason}</p>}
            {project.shots.map((shot, shotIndex) => <article key={shot.id} className="glass-panel rounded-3xl p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-teal-300">Shot {shot.position} · {shot.duration}s · {shot.approved ? "Approved" : "Needs review"}</p><h3 className="mt-2 text-xl font-semibold">{shot.title}</h3></div><div className="flex flex-wrap gap-2"><button aria-label={`Move ${shot.title} earlier`} className={button} disabled={busy || shotIndex === 0} onClick={() => perform(() => moveShot(shotIndex, -1))}>↑</button><button aria-label={`Move ${shot.title} later`} className={button} disabled={busy || shotIndex === project.shots.length - 1} onClick={() => perform(() => moveShot(shotIndex, 1))}>↓</button><button className={button} disabled={busy} onClick={() => { setEditingShot(shot.id); setShotForm({ title: shot.title, prompt: shot.prompt, dialogue: shot.dialogue, duration: shot.duration, character_ids: shot.character_ids }); }}>Edit plan</button></div></div><p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{shot.prompt}</p>{shot.dialogue && <blockquote className="mt-3 border-l-2 border-teal-300/50 pl-3 text-sm text-slate-400">{shot.dialogue}</blockquote>}
              <div className="mt-4 flex flex-wrap items-center gap-3"><button disabled={busy} className={button} onClick={() => perform(async () => { await api(`/shots/${shot.id}/approval`, { method: "PUT", body: jsonBody({ approved: !shot.approved }) }); setQuotes({}); await refresh(); })}>{shot.approved ? "Reopen review" : "Approve storyboard"}</button><button className={button} disabled={busy || !shot.approved || (provider === "preview" && !capabilities?.preview.ready)} onClick={() => perform(() => quoteShot(shot))}>Review render cost</button>{quotes[shot.id] && <button className={primary} disabled={busy} onClick={() => perform(() => generateTake(shot))}>{quotes[shot.id].provider === "preview" ? "Render animatic" : "Approve paid take"} · {money(quotes[shot.id].estimated_usd)}</button>}</div>
              {quotes[shot.id] && <p className="mt-2 text-xs text-slate-400">Estimate valid for 10 minutes. Paid retries require a new quote; actual charges are recorded separately.</p>}
              <div className="mt-4 grid gap-4 md:grid-cols-2">{project.jobs.filter((job) => job.shot_id === shot.id).map((job) => <div key={job.id} className={`rounded-2xl border p-4 ${shot.selected_take_id === job.id ? "border-teal-300/60" : "border-white/10"}`}><p className="text-sm font-medium">{job.provider === "preview" ? "Animatic" : "AI take"} · {job.status}</p>{job.output_url && <video aria-label={`${shot.title} take`} controls preload="metadata" className="mt-3 aspect-video w-full rounded-lg bg-black" src={mediaUrl(job.output_url)} />}{job.error && <p className="mt-2 break-words text-sm text-red-200">{job.error}</p>}<p className="mt-2 text-xs text-slate-400">Estimate {money(job.estimated_usd)} · Actual {job.actual_usd === null ? "not reconciled" : money(job.actual_usd)}</p>{job.status === "succeeded" && <button disabled={busy || !shot.approved} className={`${button} mt-3`} onClick={() => perform(async () => { await api(`/shots/${shot.id}/selection`, { method: "PUT", body: jsonBody({ take_id: job.id }) }); await refresh(); })}>{shot.selected_take_id === job.id ? "Selected for film ✓" : "Select this take"}</button>}</div>)}</div>
            </article>)}
          </section>
          <section className="glass-panel rounded-3xl p-6"><h2 className="text-2xl font-semibold">04 / Assemble and export</h2><p className="mt-2 text-sm leading-6 text-slate-400">Selected takes are assembled in storyboard order at 720p / 24 fps. Audio is preserved; dialogue also exports as a rough SRT sidecar, not word-aligned captions. Any animatic footage remains labelled.</p><div className="mt-4 flex flex-wrap gap-3"><button className={primary} disabled={busy || !readyForExport || hasActiveJobs} onClick={() => perform(async () => { await api(`/projects/${project.id}/exports`, { method: "POST", body: jsonBody({ request_id: crypto.randomUUID() }) }); await refresh(); })}>Export selected takes</button><Link className={button} href="/video" onClick={(event) => { if (!readyForExport) { event.preventDefault(); return; } saveMultiClips(project.shots.map((shot) => project.jobs.find((j) => j.id === shot.selected_take_id)?.output_url || "").filter(Boolean)); }}>Continue in footage editor →</Link></div>{!readyForExport && <p className="mt-3 text-xs text-amber-200">Approve every storyboard shot and select one completed take per shot.</p>}
            {exports.map((job) => <article className="mt-5 rounded-2xl border border-white/10 p-4" key={job.id}><p className="font-medium">{job.snapshot.contains_animatic ? "Animatic assembly" : "Film assembly"} · {job.status}</p>{job.error && <p className="mt-2 text-red-200">{job.error}</p>}{job.output_url && <><video aria-label="Assembled film" controls className="mt-3 aspect-video w-full rounded-xl bg-black" src={mediaUrl(job.output_url)} /><div className="mt-3 flex flex-wrap gap-5 text-sm text-teal-200"><a href={mediaUrl(job.output_url)} download>Download MP4</a><a href={mediaUrl(`/static/studio/${job.id}_dialogue.srt`)} download>Download dialogue SRT</a></div></>}</article>)}
          </section>
        </div>}
      </section>
      <footer className="border-t border-white/10 py-5 text-xs leading-6 text-slate-500">Owner-only pilot workspace. Projects and media require verified owner access. Draft forms save in this browser; customer workspaces and payments are not enabled.</footer>
    </main>
  );
}
