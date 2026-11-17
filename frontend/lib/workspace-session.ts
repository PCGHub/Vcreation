import { supabase } from "./supabase";
export type AccessResult = { state: "ready" | "signed-out" | "denied" | "unavailable"; code: string; detail: string };
async function decode(response: Response): Promise<AccessResult> {
  let data: { code?: string; detail?: string } = {};
  try { data = await response.json(); } catch { /* Detect hosting protection/HTML without treating it as a login failure. */ }
  return { state: response.ok ? "ready" : response.status === 401 ? "signed-out" : response.status === 403 ? "denied" : "unavailable", code: data.code || (response.status === 401 ? "SESSION_MISSING" : "SESSION_RESPONSE_" + response.status), detail: data.detail || "" };
}
export async function restoreWorkspaceSession(): Promise<AccessResult> {
  // The server cookie is authoritative. A stale browser token must not replace it.
  const current = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
  if (current.ok || (current.status !== 401 && current.status !== 403)) return decode(current);
  const original = await decode(current);
  if (!supabase) return original;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) return original;
  const repaired = await fetch("/api/auth/session", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: data.session.access_token }) });
  if (!repaired.ok) return decode(repaired);
  // Verify actual browser persistence, not only a successful Set-Cookie response.
  const retained = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
  if (retained.status === 401) return { state: "unavailable", code: "COOKIE_NOT_RETAINED", detail: "This browser did not retain the Vcreation session cookie. Allow cookies for vcreation.vercel.app and sign in again." };
  return decode(retained);
}
