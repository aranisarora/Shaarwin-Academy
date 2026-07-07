// Shared shapes for the WhatsApp bot's tool layer.
//
// Tools are the ONLY way the LLM touches the system. Each role gets a fixed
// list; everything runs on the user-scoped Supabase client so RLS decides
// what's actually allowed — tool availability is UX, RLS is security.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/auth";

export type ToolContext = {
  /** E.164 phone of the sender, e.g. "+919812345678". */
  phone: string;
  /** Linked profile, or null for unknown numbers (guest mode). */
  profile: Profile | null;
  /** User-scoped client (RLS applies). Null for guests. */
  supabase: SupabaseClient | null;
  /** Service-role client. Identity/link operations and public reads only. */
  admin: SupabaseClient;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolInput = Record<string, any>;

export type WaTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  run: (input: ToolInput, ctx: ToolContext) => Promise<string>;
};

export function ok(payload: unknown): string {
  return JSON.stringify({ ok: true, result: payload });
}

export function fail(error: string, detail?: unknown): string {
  return JSON.stringify({ ok: false, error, detail });
}

/** "Sat 12 Jul, 18:30" in academy time — what users should always see. */
export function fmtIST(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Mirrors lib/data.ts formatPrice. `pence` holds paise (minor unit of INR).
export function formatPricePence(pence: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(pence / 100);
}
