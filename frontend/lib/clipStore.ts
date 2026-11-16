export const SINGLE_CLIP_KEY = "clayme_single_clip";
export const MULTI_CLIPS_KEY = "clayme_multi_clips";

export function saveSingleClip(path: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SINGLE_CLIP_KEY, path);
}

export function getSingleClip() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(SINGLE_CLIP_KEY) || "";
}

export function saveMultiClips(paths: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(MULTI_CLIPS_KEY, JSON.stringify(paths));
}

export function getMultiClips(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MULTI_CLIPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}