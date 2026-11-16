import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = "https://cmzsrbmchgepukuxoxsv.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtenNyYm1jaGdlcHVrdXhveHN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MDA2NzEsImV4cCI6MjA5MDE3NjY3MX0.3Qmf4Udtdj_jncmuh3GEeVtkhrNQu7BfdmDBeXKLaiQ";

declare global {
  interface Window {
    __claymeSupabase?: SupabaseClient;
  }
}

function createSupabaseBrowserClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase =
  typeof window === "undefined"
    ? createSupabaseBrowserClient()
    : (window.__claymeSupabase ??= createSupabaseBrowserClient());

export async function getSessionUser() {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user ?? null;
  } catch {
    return null;
  }
}
