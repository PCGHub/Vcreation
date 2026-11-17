// Same-origin requests carry the private, HttpOnly workspace session cookie.
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
export function mediaUrl(path: string) { return path.startsWith("/") ? `${API_BASE}${path}` : path; }
export async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 413) throw new Error("This file is too large for this upload connection. Choose a video or image under 4 MB.");
  if (response.status === 401) throw new Error("Your session expired. Please sign in again to open your private workspace.");
  if (response.status === 403) throw new Error("This private pilot workspace is available to its owner only.");
  const unavailable = "We couldn't complete that request. Please try again shortly. Your saved projects haven't been changed.";
  if (response.status >= 500 || !response.headers.get("content-type")?.toLowerCase().includes("json")) throw new Error(unavailable);
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error(unavailable); }
  if (data === null || typeof data !== "object") throw new Error(unavailable);
  if (!response.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? "Some details need checking. Review the form and try again." : "That item could not be found. Refresh the workspace and try again.");
  }
  return data as T;
}
export async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init?.headers }, cache: "no-store" });
    return await readResponse<T>(response);
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name !== "TypeError")) throw error;
    throw new Error("We couldn't reach the workspace. Check your connection and try again.");
  }
}
export function api<T>(path: string, init?: RequestInit) { return requestJSON<T>(`/api/studio${path}`, init); }
export const jsonBody = (value: unknown) => JSON.stringify(value);
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
