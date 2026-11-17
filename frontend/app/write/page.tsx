"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDraft } from "@/lib/use-draft";
import { FilmPlanEditor } from "@/components/film-plan-editor";
import { downloadText, newFilmPlan, reviewPlan } from "@/lib/plan-review";
import { api, jsonBody } from "@/lib/api";
import styles from "@/app/workspace.module.css";
import type { FilmPlan } from "@/lib/film-assistant";
export default function WritingDesk() {
  const router = useRouter();
  const [script, setScript] = useDraft("vcreation.writing-script.v1", "");
  const [plan, setPlan] = useDraft<FilmPlan>("vcreation.writing-plan.v1", newFilmPlan());
  const [importId, setImportId] = useDraft("vcreation.writing-import-id.v1", "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  function editPlan(next: FilmPlan) { setPlan(next); setImportId(""); setError(""); }
  async function send() {
    if (busy) return; setError(""); setNotice("");
    try {
      const reviewed = reviewPlan(plan); const id = importId || crypto.randomUUID().replaceAll("-", ""); setImportId(id); setBusy(true);
      const result = await api<{ id: string }>("/import-plan", { method: "POST", body: jsonBody({ ...reviewed, project_id: id }) });
      try { localStorage.setItem("vcreation.active-project.v1", result.id); } catch { /* The project is still saved on the server. */ }
      router.push("/studio");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't send the plan. Your local draft is still here."); }
    finally { setBusy(false); }
  }
  return <main id="workspace" className="workspace-tool"><div className="workspace-page-heading"><p>WRITE · REVISE · PLAN</p><h1>Writing desk</h1><div>Draft your film at your own pace. No sign-in or AI credits needed for local writing.</div></div><p className="workspace-notice">Drafts save in this browser when browser storage is available. Download a copy to keep your work across devices. AI assistance and private studio access require sign-in.</p>
    <section className={styles.writingSection} aria-label="Script editor"><h2>Your screenplay</h2><label htmlFor="screenplay">Script draft</label><textarea id="screenplay" value={script} onChange={e => setScript(e.target.value)} maxLength={20000} rows={16} placeholder={'INT. FAMILY HOME — NIGHT\n\nDescribe the action, then add character names and dialogue…'} /><div className={styles.reviewActions}><button disabled={!script.trim()} onClick={() => downloadText("vcreation-screenplay.txt", script)}>Download script</button><button disabled={!script.trim()} onClick={() => { editPlan({ ...plan, story: script }); setNotice("Your script is now in the production plan. Add the cast and visual direction below."); }}>Use script in plan</button><button disabled={!script.trim()} onClick={() => { try { localStorage.setItem("vcreation.chat-draft.v1", JSON.stringify(`Help develop this script:\n${script.slice(0, 11500)}`)); router.push("/"); } catch { setError("Couldn't transfer the script. Download it before continuing."); } }}>Develop with AI</button></div><p className="workspace-help">Develop with AI opens the private Film Assistant and uses model credits only when you send a message.</p></section>
    <section className={styles.planReview} aria-label="Production plan"><FilmPlanEditor plan={plan} onChange={editPlan} disabled={busy} /><div className={styles.reviewActions}><button disabled={busy} onClick={() => downloadText("vcreation-production-plan.json", JSON.stringify(plan, null, 2), "application/json")}>Download plan</button><button disabled={busy} onClick={() => void send()}>Approve handoff to Film Studio</button></div><p>Handoff requires sign-in. It creates an unapproved cast and shot sequence with a $0 planning budget; no video or music generation starts.</p><Link href="/auth">Sign in for private studio access</Link></section>{error && <p className="workspace-error" role="alert">{error}</p>}{notice && <p className={styles.chatNotice} role="status">{notice}</p>}</main>;
}
