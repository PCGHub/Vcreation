"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./workspace.module.css";
import { useDraft } from "@/lib/use-draft";
import { useWorkspace } from "@/components/workspace-shell";
import { api, jsonBody, requestJSON } from "@/lib/api";
import { filmPlanSchema, type FilmPlan } from "@/lib/film-assistant";
import { FilmPlanEditor } from "@/components/film-plan-editor";
import { downloadText, reviewPlan } from "@/lib/plan-review";
import { STORAGE_KEY, parseBriefs, readBriefs, type Brief } from "@/lib/briefs";
type Message = { role: "user" | "assistant"; content: string };
type Conversation = { messages: Message[]; plan: FilmPlan | null; importId: string; model: string };
const empty: Conversation = { messages: [], plan: null, importId: "", model: "" };
const focuses = ["Writing", "Direction", "Production", "Casting", "Music"] as const;
const starters = ["Develop a two-minute drama about estranged siblings.", "Help me direct a tense dialogue scene on a small budget.", "Build a casting brief and character relationships.", "Plan music cues and sound design for my story."];
export default function HomePage() {
  const router = useRouter(); const { selected, setSelected } = useWorkspace();
  const [chat, setChat] = useDraft<Conversation>("vcreation.film-chat.v1", empty);
  const [draft, setDraft] = useDraft("vcreation.chat-draft.v1", "");
  const [focus, setFocus] = useDraft<string>("vcreation.chat-focus.v1", "Writing");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null); const end = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [chat.messages.length, busy]);
  useEffect(() => {
    function reset() { if (busy) return; setChat(empty); setSelected(null); setDraft(""); setError(""); setNotice(""); }
    window.addEventListener("vcreation:new-brief", reset); return () => window.removeEventListener("vcreation:new-brief", reset);
  }, [busy, setChat, setDraft, setSelected]);
  async function generate(mode: "chat" | "plan", event?: FormEvent) {
    event?.preventDefault(); if (busy || (mode === "chat" && !draft.trim())) return;
    const messages: Message[] = mode === "chat" ? [...chat.messages, { role: "user", content: draft.trim() }] : chat.messages;
    if (!messages.length) return;
    setBusy(true); setError(""); setNotice(""); controller.current = new AbortController();
    // Preserve the user's text until a complete response succeeds.
    try {
      const result = await requestJSON<{ text?: string; plan?: FilmPlan; model: string }>("/api/chat", { method: "POST", signal: controller.current.signal, body: jsonBody({ mode, focus, messages: messages.slice(-24) }) });
      if (mode === "plan") setChat({ ...chat, plan: filmPlanSchema.parse(result.plan), importId: crypto.randomUUID().replaceAll("-", ""), model: result.model });
      else { if (!result.text) throw new Error("The assistant returned an empty reply. Please try again."); setChat({ messages: [...messages, { role: "assistant" as const, content: result.text }].slice(-40), plan: null, importId: "", model: result.model }); setDraft(""); setSelected(null); }
    } catch (e) { if (e instanceof Error && e.name !== "AbortError") setError(e.message); }
    finally { setBusy(false); controller.current = null; }
  }
  async function importPlan() {
    if (!chat.plan || busy) return; setBusy(true); setError("");
    try { const plan = reviewPlan(chat.plan); const id = chat.importId || crypto.randomUUID().replaceAll("-", ""); setChat({ ...chat, importId: id }); const project = await api<{ id: string }>("/import-plan", { method: "POST", body: jsonBody({ ...plan, project_id: id }) }); localStorage.setItem("vcreation.active-project.v1", project.id); router.push("/studio"); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't send this plan to the studio."); }
    finally { setBusy(false); }
  }
  function saveScript(content: string) {
    try { const brief: Brief = { id: crypto.randomUUID(), title: content.split(/[\n.!?]/)[0].replace(/^#+\s*/, "").slice(0, 60) || "Film draft", story: content.slice(0, 20000), format: "Short film" }; localStorage.setItem(STORAGE_KEY, JSON.stringify([brief, ...parseBriefs(readBriefs())].slice(0, 20))); window.dispatchEvent(new Event("vcreation:briefs")); setNotice("Saved to Your briefs in this browser."); }
    catch { setError("Browser storage is unavailable. Copy your script before leaving."); }
  }
  return <main id="workspace" className={`${styles.main} ${styles.chatMain}`}>
    <section className={styles.chatIntro}><div className={styles.eyebrow}>YOUR FILMMAKING COLLABORATOR</div><h1>Let’s make your story <span>screen-ready.</span></h1><p>Develop the script, direct each scene, shape the cast, and plan production and music.</p></section>
    {selected && <section className={styles.savedContext}><h2>{selected.title}</h2><p>{selected.story}</p><button onClick={() => { setDraft(`Develop this film brief:\n${selected.story}`); setSelected(null); }}>Discuss this brief</button></section>}
    <div className={styles.focusTabs} aria-label="Assistant focus">{focuses.map(item => <button key={item} disabled={busy} aria-pressed={focus === item} onClick={() => setFocus(item)}>{item}</button>)}</div>
    {!chat.messages.length && <section className={styles.chatStarters} aria-label="Conversation starters">{starters.map(text => <button key={text} onClick={() => setDraft(text)}>{text}</button>)}</section>}
    <section className={styles.messages} aria-label="Filmmaking conversation">{chat.messages.map((message, i) => <article key={i} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}><h2>{message.role === "user" ? "You" : "Vcreation · Film assistant"}</h2><div>{message.content}</div>{message.role === "assistant" && <div className={styles.reviewActions}><button onClick={() => saveScript(message.content)}>Save as a brief</button><button onClick={() => downloadText("vcreation-script.txt", message.content)}>Download script</button><button onClick={() => { try { localStorage.setItem("vcreation.writing-script.v1", JSON.stringify(message.content.slice(0, 20000))); router.push("/write"); } catch { setError("Couldn't open a working copy. Download the script before continuing."); } }}>Revise in Writing Desk</button></div>}</article>)}<div ref={end} /></section>
    {chat.messages.some(m => m.role === "assistant") && <div className={styles.chatActions}><button disabled={busy} onClick={() => void generate("plan")}>Prepare studio plan</button><span>Creates a proposed cast and up to 12 shots for your review.</span></div>}
    {chat.plan && <section className={styles.planReview} aria-label="Review studio plan"><div className={styles.eyebrow}>REVISE BEFORE PRODUCTION</div><FilmPlanEditor plan={chat.plan} disabled={busy} onChange={plan => { setChat({ ...chat, plan, importId: crypto.randomUUID().replaceAll("-", "") }); setError(""); }} /><p>Sending creates a film with a $0 planning budget. Shots stay unapproved. No rendering starts automatically.</p><button disabled={busy} onClick={() => void importPlan()}>Approve handoff to Film Studio</button><button disabled={busy} onClick={() => downloadText("vcreation-production-plan.json", JSON.stringify(chat.plan, null, 2), "application/json")}>Download plan</button><button disabled={busy} onClick={() => setChat({ ...chat, plan: null, importId: "" })}>Discard proposal</button></section>}
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.chatNotice}>{notice}</p>}
    {busy && <p role="status" className={styles.chatNotice}>Working on your film… <button onClick={() => controller.current?.abort()}>Stop reply</button></p>}
    <form className={styles.composer} onSubmit={event => void generate("chat", event)}><label htmlFor="film-chat" className={styles.visuallyHidden}>Message the filmmaking assistant</label><textarea id="film-chat" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Tell me about your film, or ask about writing, directing, casting, production or music…" maxLength={12000} rows={3} /><div className={styles.composerToolbar}><span>{focus} collaborator</span><button className={styles.send} disabled={busy || !draft.trim()} type="submit">Send message ↑</button></div></form>
    <p className={styles.composerNote}>AI replies use model credits. Chats and drafts save in this browser. Video and music generation are separate; nothing starts automatically.</p><p className={styles.composerNote}>Review AI suggestions. {chat.model && `Model: ${chat.model}. `}<Link href="/auth">Workspace account</Link></p>
  </main>;
}
