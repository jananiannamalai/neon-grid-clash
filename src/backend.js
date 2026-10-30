import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(supabaseUrl && supabaseKey);

export const supabase = configured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;

export async function ensureIdentity() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Check your .env.local file."
    );
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(
      `Could not read the login session: ${sessionError.message}`
    );
  }

  if (session?.user?.id) {
    return session.user.id;
  }

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) {
    throw new Error(
      `Anonymous sign-in failed: ${error.message}. Check whether anonymous sign-ins are enabled in Supabase.`
    );
  }

  if (!data?.user?.id) {
    throw new Error(
      "Supabase did not return a user ID. Please refresh and try again."
    );
  }

  return data.user.id;
}

export async function callGameRpc(functionName, args = {}) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const allowedFunctions = new Set([
    "create_match",
    "join_match",
    "start_match",
    "get_match",
    "claim_tile",
  ]);

  if (!allowedFunctions.has(functionName)) {
    throw new Error(`Unsupported game operation: ${functionName}`);
  }

  const { data, error } = await supabase.rpc(functionName, args);

  if (error) {
    console.error(
      `Supabase RPC "${functionName}" failed:`,
      error
    );

    throw new Error(
      error.message || `The operation "${functionName}" failed.`
    );
  }

  if (data == null) {
    throw new Error(
      `The "${functionName}" function returned no game data.`
    );
  }

  const result =
    Array.isArray(data) && data.length === 1
      ? data[0]
      : data;

  return result;
}