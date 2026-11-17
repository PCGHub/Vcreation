import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const cookie = "vcreation_session";
function allowed(email?: string) {
  const owners = (process.env.VCREATION_OWNER_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  return !!email && owners.includes(email.toLowerCase());
}
function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}
function failure(message: string, status: number) {
  return NextResponse.json({ detail: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}
function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return failure("This request could not be verified.", 403);
  const supabase = client();
  if (!supabase) return failure("Sign-in is not configured yet.", 503);
  let token: unknown;
  try { token = (await request.json()).access_token; } catch { return failure("Please sign in again.", 400); }
  if (typeof token !== "string" || !token || token.length > 12000) return failure("Please sign in again.", 401);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || !data.user.email_confirmed_at || data.user.is_anonymous) return failure("Your session expired. Please sign in again.", 401);
  if (!allowed(data.user.email)) return failure("This pilot is currently open to its owner only.", 403);
  const response = NextResponse.json({ email: data.user.email }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(cookie, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 3600 });
  return response;
}
export async function GET(request: NextRequest) {
  const token = request.cookies.get(cookie)?.value;
  if (!token) return failure("Please sign in to open your private workspace.", 401);
  const supabase = client();
  if (!supabase) return failure("Sign-in is not configured yet.", 503);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email_confirmed_at || data.user.is_anonymous) return failure("Please sign in again.", 401);
  if (!allowed(data.user.email)) return failure("This pilot is currently open to its owner only.", 403);
  return NextResponse.json({ email: data.user.email }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return failure("This request could not be verified.", 403);
  const response = NextResponse.json({ signedOut: true }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(cookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
