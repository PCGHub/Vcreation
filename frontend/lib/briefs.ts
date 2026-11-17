export type Brief = { id: string; title: string; story: string; format: string };
export const STORAGE_KEY = "vcreation.briefs.v1";
export function subscribeBriefs(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener("vcreation:briefs", notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener("vcreation:briefs", notify);
  };
}
export function readBriefs() {
  try { return localStorage.getItem(STORAGE_KEY) || "[]"; }
  catch { return "[]"; }
}
export function parseBriefs(raw: string): Brief[] {
  try {
    const saved: unknown = JSON.parse(raw);
    return Array.isArray(saved) ? saved.filter((item): item is Brief => !!item && typeof item.id === "string" && typeof item.title === "string" && typeof item.story === "string" && typeof item.format === "string").slice(0, 20) : [];
  } catch { return []; }
}

