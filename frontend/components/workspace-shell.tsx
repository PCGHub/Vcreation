"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { PrivateWorkspace } from "./private-workspace";
import { supabase } from "@/lib/supabase";
import { Icon } from "./workspace-icon";
import { subscribeBriefs, readBriefs, parseBriefs, type Brief } from "@/lib/briefs";
import styles from "@/app/workspace.module.css";

type WorkspaceState = { selected: Brief | null; setSelected: Dispatch<SetStateAction<Brief | null>> };
const Context = createContext<WorkspaceState | null>(null);
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error("Workspace layout is missing");
  return context;
}
const tools = [
  { path: "/", label: "Plan a film", title: "Film planning", icon: "spark" },
  { path: "/studio", label: "Film studio", title: "Film studio", icon: "film" },
  { path: "/video", label: "Footage editor", title: "Footage editor", icon: "edit" },
  { path: "/jobs", label: "Render history", title: "Render history", icon: "clock" },
];

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [selected, setSelected] = useState<Brief | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const stored = useSyncExternalStore(subscribeBriefs, readBriefs, () => "[]");
  const briefs = parseBriefs(stored);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const aside = useRef<HTMLElement>(null);
  const tool = tools.find((item) => item.path === pathname) || (pathname === "/auth" ? { title: "Your account" } : pathname === "/image" ? { title: "Image generation" } : null);
  async function signOut() {
    await fetch("/api/auth/session", { method: "DELETE" });
    await supabase?.auth.signOut();
    window.location.assign("/auth");
  }

  useEffect(() => {
    if (!sidebar) return;
    closeButton.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") { setSidebar(false); menuButton.current?.focus(); }
      if (event.key === "Tab") {
        const targets = [...(aside.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') || [])].filter((element) => element.getClientRects().length);
        const first = targets[0], last = targets[targets.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", keyboard); };
  }, [sidebar]);

  function newCreation() {
    setSelected(null); setSidebar(false);
    if (pathname === "/") window.dispatchEvent(new Event("vcreation:new-brief"));
    else router.push("/");
  }

  if (!tool) return <>{children}</>;
  return (
    <Context.Provider value={{ selected, setSelected }}>
      <div className={styles.workspace}>
        <a href="#workspace" className={styles.skip}>Skip to workspace</a>
        {sidebar && <button className={styles.backdrop} aria-label="Close navigation" onClick={() => { setSidebar(false); menuButton.current?.focus(); }} />}
        <aside ref={aside} id="workspace-navigation" className={`${styles.sidebar} ${sidebar ? styles.sidebarOpen : ""}`} aria-label="Main navigation">
          <div className={styles.brandRow}>
            <Link href="/" className={styles.brand} aria-label="Vcreation home" onClick={() => setSidebar(false)}><span className={styles.logo}>v<span>.</span></span>Vcreation</Link>
            <button ref={closeButton} className={`${styles.iconButton} ${styles.mobileOnly}`} aria-label="Close navigation" onClick={() => { setSidebar(false); menuButton.current?.focus(); }}><Icon name="close" /></button>
          </div>
          <button className={styles.newButton} onClick={newCreation}><Icon name="plus" size={18} />New brief<span><Icon name="diagonal" size={14} /></span></button>
          <nav className={styles.navigation} aria-label="Creation tools">
            {tools.map((item) => <Link key={item.path} href={item.path} className={pathname === item.path ? styles.activeNav : ""} aria-current={pathname === item.path ? "page" : undefined} onClick={() => setSidebar(false)}><Icon name={item.icon} />{item.label}</Link>)}
          </nav>
          <div className={styles.libraryHeading}><span>YOUR BRIEFS</span><span>{briefs.length}</span></div>
          <div className={styles.recents}>{briefs.length ? briefs.map((brief) => <button key={brief.id} className={selected?.id === brief.id ? styles.selectedBrief : ""} title={brief.title} onClick={() => { setSelected(brief); setSidebar(false); router.push("/"); }}><Icon name="folder" size={16} /><span>{brief.title}</span></button>) : <p>Your next story starts here.<br />Saved briefs will appear here.</p>}</div>
          <div className={styles.sidebarBottom}>
            <div className={styles.tip}><span className={styles.tipIcon}><Icon name="spark" size={17} /></span><strong>Your story. One workspace.</strong><p>Shape your idea, direct each shot, and make the final cut.</p></div>
            <Link href="/auth" className={styles.account} onClick={() => setSidebar(false)}><span className={styles.avatar}>V</span><span><strong>Your workspace</strong><small>Private pilot access</small></span><Icon name="chevron" size={16} /></Link>
            {pathname !== "/" && pathname !== "/auth" && <button className={styles.signOut} onClick={() => void signOut()}>Sign out</button>}
          </div>
        </aside>
        <div className={styles.mainColumn}>
          <header className={styles.header}>
            <div className={styles.headerTitle}><button ref={menuButton} className={`${styles.iconButton} ${styles.mobileOnly}`} aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={sidebar} onClick={() => setSidebar(true)}><Icon name="menu" /></button><span>{tool.title}</span><span className={styles.beta}>PILOT</span></div>
            <Link href={pathname === "/video" ? "/studio" : "/video"} className={styles.headerLink} onClick={() => setSidebar(false)}><Icon name={pathname === "/video" ? "film" : "plus"} size={16} />{pathname === "/video" ? "Back to film" : "Import footage"}</Link>
          </header>
          <div className={pathname === "/" ? "" : styles.toolSurface}>{["/studio", "/video", "/jobs"].includes(pathname) ? <PrivateWorkspace>{children}</PrivateWorkspace> : children}</div>
        </div>
      </div>
    </Context.Provider>
  );
}
