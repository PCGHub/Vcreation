import { NextRequest, NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
const cookie = "vcreation_session";
const headers = { "Cache-Control": "private, no-store" };
function audit(code: string, status: number, providerCode?: string) {
  // Never record tokens, cookies, passwords, email addresses or provider payloads.
  console.info(JSON.stringify({ scope: "vcreation-auth", code, status, ...(providerCode ? { providerCode } : {}) }));
}
function failure(detail: string, status: number, code: string, providerCode?: string) {
  audit(code, status, providerCode);
  return NextResponse.json({ detail, code }, { status, headers });
}
function sameOrigin(request: NextRequest) { return request.headers.get("origin") === new URL(request.url).origin; }
async function verify(token?: string): Promise<User | NextResponse> {
  if (!token) return failure("Sign in to open Vcreation.", 401, "SESSION_MISSING");
  if (token.length > 12000) return failure("Please sign in again.", 401, "TOKEN_INVALID");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const owners = (process.env.VCREATION_OWNER_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!url || !key || !owners.length) return failure("Workspace authentication needs configuration. Your account hasn't been changed.", 503, "AUTH_CONFIGURATION");
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(10000) }) } });
    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      const unavailable = !error.status || error.status >= 500 || /api.?key|fetch|network/i.test(error.message);
      return failure(unavailable ? "The account verification service is unavailable. Try again shortly; your saved projects are safe." : "Your saved sign-in is no longer valid. Sign in again.", unavailable ? 503 : 401, unavailable ? "AUTH_SERVICE_UNAVAILABLE" : "TOKEN_REJECTED", error.code || "provider_error");
    }
    if (!data.user || data.user.is_anonymous) return failure("Please sign in with your owner account.", 401, "USER_UNVERIFIED");
    if (!data.user.email_confirmed_at) return failure("Your email is not confirmed in this Vcreation authentication project. Open the latest confirmation email first.", 401, "EMAIL_UNCONFIRMED");
    if (!data.user.email || !owners.includes(data.user.email.trim().toLowerCase())) return failure("This verified account is not the configured workspace owner. Use the owner's email.", 403, "OWNER_MISMATCH");
    return data.user;
  } catch { return failure("The account verification service is unavailable. Try again shortly.", 503, "AUTH_SERVICE_UNAVAILABLE"); }
}
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return failure("Open vcreation.vercel.app directly, then sign in.", 403, "ORIGIN_REJECTED");
  let token: unknown;
  try { token = (await request.json()).access_token; } catch { return failure("Please sign in again.", 400, "REQUEST_INVALID"); }
  if (typeof token !== "string") return failure("Please sign in again.", 401, "TOKEN_INVALID");
  const user = await verify(token); if (user instanceof NextResponse) return user;
  // Browsers silently reject oversize cookies; report this explicitly instead of looping.
  if (token.length > 3800) return failure("The sign-in token is too large for the session cookie. Workspace authentication needs adjustment.", 503, "COOKIE_TOO_LARGE");
  audit("SESSION_CREATED", 200);
  const response = NextResponse.json({ email: user.email, code: "SESSION_CREATED" }, { headers });
  response.cookies.set(cookie, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 3600 });
  return response;
}
export async function GET(request: NextRequest) {
  const user = await verify(request.cookies.get(cookie)?.value); if (user instanceof NextResponse) return user;
  audit("SESSION_VERIFIED", 200);
  return NextResponse.json({ email: user.email, code: "SESSION_VERIFIED" }, { headers });
}
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return failure("Reload Vcreation before signing out.", 403, "ORIGIN_REJECTED");
  const response = NextResponse.json({ signedOut: true }, { headers });
  response.cookies.set(cookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
