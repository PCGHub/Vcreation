"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import styles from "./workspace.module.css";
import { Icon } from "@/components/workspace-icon";
import { useDraft } from "@/lib/use-draft";
import { useWorkspace } from "@/components/workspace-shell";
import { STORAGE_KEY, subscribeBriefs, readBriefs, parseBriefs, type Brief } from "@/lib/briefs";

const starters = [
  { title: "A story worth telling", label: "SHORT DRAMA", icon: "film", prompt: "Two estranged siblings meet at their childhood home. A letter changes everything.", tone: "violet", format: "Short film" },
  { title: "Make your product the hero", label: "PRODUCT FILM", icon: "spark", prompt: "A cinematic product film for a handcrafted coffee brand. Warm morning light, thoughtful details, and a quiet moment.", tone: "cyan", format: "Product film" },
  { title: "A moment of discovery", label: "VISUAL STORY", icon: "compass", prompt: "A traveler finds a hidden garden in the middle of a busy city. Tell the story through atmosphere and small details.", tone: "amber", format: "Visual story" },
];

export default function HomePage() {
  const [draft, setDraft] = useDraft("vcreation.idea-draft.v1", "");
  const [format, setFormat] = useDraft("vcreation.idea-format.v1", "Short film");
  const storedBriefs = useSyncExternalStore(subscribeBriefs, readBriefs, () => "[]");
  const briefs = parseBriefs(storedBriefs);
  const { selected, setSelected } = useWorkspace();
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState<Brief | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    function reset() { setSelected(null); setDraft(""); setError(""); input.current?.focus(); }
    window.addEventListener("vcreation:new-brief", reset);
    return () => window.removeEventListener("vcreation:new-brief", reset);
  }, [setSelected, setDraft]);

  function saveBrief(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    const story = draft.trim();
    const brief: Brief = { id: crypto.randomUUID(), title: story.split(/[.!?\n]/)[0].slice(0, 60) || "Untitled film", story, format };
    const next = [brief, ...briefs].slice(0, 20);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { setError("Your browser could not save this brief. Copy your idea before leaving this page."); return; }
    window.dispatchEvent(new Event("vcreation:briefs")); setSelected(brief); setDraft(""); setError("");
  }

  function removeBrief() {
    if (!selected) return;
    const next = briefs.filter((brief) => brief.id !== selected.id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { setError("Could not remove the saved brief. Please try again."); return; }
    setDeleted(selected); window.dispatchEvent(new Event("vcreation:briefs")); setSelected(null); setError("");
  }

  function continueToStudio(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!selected) return;
    try { sessionStorage.setItem("vcreation.studio-brief.v1", JSON.stringify(selected)); }
    catch { event.preventDefault(); setError("Could not transfer your brief. Copy it and open Film studio from the sidebar."); }
  }

  return (
        <main id="workspace" className={styles.main}>
          {!selected ? <section className={styles.welcome}>
            <div className={styles.eyebrow}><span />FROM FIRST IDEA TO FINAL FRAME</div>
            <div className={styles.heroMark}><Icon name="spark" size={31} /></div>
            <h1>What story will you <span>tell today?</span></h1>
            <p className={styles.subtitle}>Plan a film brief, then shape the cast and storyboard.<br />This workspace saves your ideas; it does not generate AI replies or images.</p>
          </section> : <section className={styles.briefView} aria-live="polite">
            <div className={styles.briefMeta}><span className={styles.savedBadge}><Icon name="check" size={14} />Saved in this browser</span><span>{selected.format}</span></div>
            <h1>Your film brief</h1>
            <div className={styles.storyBubble}>{selected.story}</div>
            <div className={styles.nextStep}><span className={styles.nextIcon}><Icon name="film" size={24} /></span><div><h2>Your brief is saved.</h2><p>Open your brief in Film studio to define the cast, plan your shots, and review each take before export.</p><Link href="/studio" onClick={continueToStudio} className={styles.primaryLink}>Continue to Film studio<Icon name="chevron" size={17} /></Link></div></div>
            <div className={styles.briefActions}><button onClick={() => { setDraft(selected.story); setSelected(null); input.current?.focus(); }}>Edit as a new brief</button><button onClick={removeBrief}>Delete brief</button></div>
          </section>}
          {deleted && <div className={styles.undo} role="status">Brief deleted.<button onClick={() => { const next = [deleted, ...briefs.filter(brief => brief.id !== deleted.id)].slice(0, 20); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); window.dispatchEvent(new Event("vcreation:briefs")); setSelected(deleted); setDeleted(null); } catch { setError("Couldn't restore the brief. Please check browser storage."); } }}>Undo</button></div>}
          <section className={styles.composerSection} aria-label="Film brief">
            <form className={styles.composer} onSubmit={saveBrief}>
              <label htmlFor="film-idea" className={styles.visuallyHidden}>Describe your film idea</label>
              <textarea ref={input} id="film-idea" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={6000} placeholder={selected ? "Plan another film brief…" : "Describe the story, characters, and mood for your film…"} rows={3} />
              <div className={styles.composerToolbar}><div className={styles.composerTools}><Link href="/video" className={styles.attach} aria-label="Import footage in the editor"><Icon name="plus" size={20} /></Link><span className={styles.toolbarDivider} /><label className={styles.formatLabel}><Icon name="film" size={16} /><span className={styles.visuallyHidden}>Project format</span><select value={format} onChange={(e) => setFormat(e.target.value)}><option>Short film</option><option>Product film</option><option>Visual story</option></select></label></div><button type="submit" className={styles.send} disabled={!draft.trim()} aria-label="Save film brief"><span>Save brief</span><Icon name="arrow" size={18} /></button></div>
            </form>
            <p className={styles.composerNote}>Film planning only · Drafts save in this browser · No generation credits used.</p>
            {error && <p role="alert" className={styles.error}>{error}</p>}
          </section>
          {!selected && <section className={styles.inspiration} aria-label="Ideas to get started"><div className={styles.sectionHeading}><h2>A little inspiration</h2><span>MAKE IT YOUR OWN</span></div><div className={styles.starterGrid}>{starters.map((starter) => <button key={starter.label} className={`${styles.starter} ${styles[starter.tone] || ""}`} onClick={() => { setDraft(starter.prompt); setFormat(starter.format); input.current?.focus(); }}><span className={styles.starterTop}><span className={styles.starterIcon}><Icon name={starter.icon} size={22} /></span><span className={styles.cardArrow}><Icon name="diagonal" size={15} /></span></span><span className={styles.starterLabel}>{starter.label}</span><strong>{starter.title}</strong><span className={styles.starterDescription}>{starter.prompt}</span></button>)}</div></section>}
          <div className={styles.workflow}><span><b>01</b> Shape the story</span><i /><span><b>02</b> Direct every shot</span><i /><span><b>03</b> Make the final cut</span></div>
          <footer className={styles.footer}><span>YOUR VISION. YOUR DIRECTION.</span><Link href="/studio">Explore the studio<Icon name="chevron" size={13} /></Link></footer>
        </main>
  );
}
