import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

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
  !supabaseConfigured ? null : typeof window === "undefined"
    ? createSupabaseBrowserClient()
    : (window.__claymeSupabase ??= createSupabaseBrowserClient());

export async function getSessionUser() {
  if (!supabase) return null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ?? null;
  } catch {
    return null;
  }
}
