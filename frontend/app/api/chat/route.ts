import { generateText, Output } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { GET as verifySession } from "../auth/session/route";
import { chatSchema, filmInstructions, filmPlanSchema } from "@/lib/film-assistant";
export const maxDuration = 60;
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ detail: "Reload the workspace and try again." }, { status: 403, headers });
  const session = await verifySession(request);
  if (!session.ok) return session;
  if (Number(request.headers.get("content-length") || 0) > 100000) return NextResponse.json({ detail: "Please shorten this conversation." }, { status: 413, headers });
  let input;
  try { input = chatSchema.parse(await request.json()); }
  catch { return NextResponse.json({ detail: "Please shorten your message or start a new conversation." }, { status: 400, headers }); }
  const model = process.env.AI_GATEWAY_MODEL || "openai/gpt-5.4-mini";
  try {
    const common = { model, instructions: filmInstructions + `\nCurrent focus: ${input.focus}.`, messages: input.messages, maxOutputTokens: 3500, maxRetries: 0, abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(50000)]) };
    if (input.mode === "plan") {
      const result = await generateText({ ...common, instructions: common.instructions + "\nConvert the agreed creative material into a proposed studio plan. Use character_names matching the cast exactly. No work is approved or generated yet.", output: Output.object({ schema: filmPlanSchema }) });
      return NextResponse.json({ plan: result.output, model, usage: result.usage }, { headers });
    }
    const result = await generateText(common);
    if (!result.text.trim()) throw new Error("empty response");
    return NextResponse.json({ text: result.text, model, usage: result.usage }, { headers });
  } catch (error) {
    // Do not log provider payloads, prompts, tokens or account credentials.
    const raw = error instanceof Error ? error.message : "";
    const setup = /credit|fund|payment|verification|budget|unauthorized|authentication|api.key|oidc/i.test(raw);
    return NextResponse.json({ detail: setup ? "The AI connection needs activation or available credits in Vercel AI Gateway. Your conversation is saved; no film generation was started." : "The assistant couldn't finish this reply. Your conversation is saved. Please try again in a moment." }, { status: setup ? 409 : 502, headers });
  }
}
