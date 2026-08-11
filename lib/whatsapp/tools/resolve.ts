// `resolve` — what is this name?
//
// The bug this exists to end, from the live founder transcript:
//
//   "what classes did Aarav have today"
//   "I can't find a client named Aarav."
//
// Aarav is a PLAYER. The bot picked one table out of five, searched only there,
// and then reported the failure of its own guess as a fact about the academy.
// Every part of that is wrong: the guess, the single-table search, and above all
// the answer — "no such client" while a player of that name is on the books is
// not a miss, it is a confidently wrong statement.
//
// So: one lookup, every table a name can live in, ranked, typed, with enough
// context to tell two Aaravs apart. The model never has to choose a table
// before it knows what the word is, because choosing was the failure.
//
// Runs on the caller's RLS session like `find` does, so a client resolving a
// name sees their own household and nothing else. Coaches come from
// public_coach_roster() (SECURITY DEFINER) because `profiles` is owner-scoped
// and a coach's name is otherwise invisible to everyone but the founder.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Role } from "./find-registry";
import { fail, ok, type ToolContext, type WaTool } from "./types";

/** What a name can turn out to be. */
export type EntityKind = "player" | "client" | "coach" | "class" | "venue";

export type Candidate = {
  kind: EntityKind;
  id: string;
  label: string;
  /** What tells this one apart from a namesake — a parent, a level, a venue. */
  detail?: string;
};

/** Which kinds a role is even allowed to look in. */
const KINDS_FOR_ROLE: Record<Role, readonly EntityKind[]> = {
  // A client resolves their own household plus the public-facing catalogue.
  client: ["player", "coach", "class"],
  // A coach resolves the children on their rosters, their colleagues, the
  // classes they teach and the venues they drive to.
  coach: ["player", "coach", "class", "venue"],
  founder: ["player", "client", "coach", "class", "venue"],
};

const PER_KIND_LIMIT = 8;
const TOTAL_LIMIT = 12;

/**
 * Split a name into the words worth searching for.
 *
 * Every token is ANDed as its own `%token%`, which is what makes both halves of
 * a name work in either order: "Abhay Gupta", "Gupta Abhay" and bare "Abhay"
 * all reach the same row. A single `%abhay gupta%` matches only the exact
 * spelling with the exact spacing, and that is the search that answered nothing.
 */
export function tokenize(name: string): string[] {
  return name
    .normalize("NFKD")
    // Keep letters, digits and spaces; drop punctuation people sprinkle into
    // names ("O'Brien", "Smith-Jones") rather than searching for it literally.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 4);
}

/**
 * Exact beats prefix beats contains — so a search for "Sam" puts Sam above
 * Samir, and an exact hit is never buried under a longer namesake.
 */
export function rankOf(label: string, query: string): number {
  const l = label.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (l === q) return 100;
  // A whole word, wherever it sits: "Gupta" in "Abhay Gupta". This has to beat
  // a bare prefix, or "Guptara Rao" outranks the Gupta actually being asked for
  // purely because its first letters line up.
  if (l.split(/\s+/).some((w) => w === q)) return 75;
  if (l.startsWith(q)) return 50;
  if (l.includes(q)) return 40;
  return 20;
}

/**
 * AND one `%token%` per word onto a query.
 *
 * Generic over the builder so each caller keeps its own row typing — supabase-js
 * returns the same builder from `.ilike()`, so a plain reassigning loop needs no
 * casts at all.
 */
function applyTokens<T extends { ilike(col: string, pattern: string): T }>(
  query: T,
  col: string,
  tokens: readonly string[]
): T {
  let out = query;
  for (const token of tokens) out = out.ilike(col, `%${token}%`);
  return out;
}

async function findPlayers(
  supabase: SupabaseClient<Database>,
  tokens: string[]
): Promise<Candidate[]> {
  const { data, error } = await applyTokens(
    supabase
      .from("players")
      .select("id,full_name,skill_level,grade,profiles(full_name)")
      .limit(PER_KIND_LIMIT),
    "full_name",
    tokens
  );
  if (error) return [];
  return (data ?? []).map((row) => {
    const parent = row.profiles as { full_name?: string | null } | { full_name?: string | null }[] | null;
    const parentName = Array.isArray(parent) ? parent[0]?.full_name : parent?.full_name;
    const bits = [
      parentName ? `${parentName}'s child` : null,
      row.skill_level && row.skill_level !== "any" ? String(row.skill_level) : null,
      row.grade ? `grade ${row.grade}` : null,
    ].filter(Boolean);
    return {
      kind: "player" as const,
      id: row.id,
      label: row.full_name ?? "",
      detail: bits.join(", ") || undefined,
    };
  });
}

async function findClients(
  supabase: SupabaseClient<Database>,
  tokens: string[]
): Promise<Candidate[]> {
  const { data, error } = await applyTokens(
    supabase
      .from("profiles")
      .select("id,full_name,role,phone,deleted_at")
      .is("deleted_at", null)
      .limit(PER_KIND_LIMIT),
    "full_name",
    tokens
  );
  if (error) return [];
  return (data ?? []).map((row) => ({
    kind: "client" as const,
    id: row.id,
    label: row.full_name ?? "",
    // The role matters: a name that resolves to a coach's ACCOUNT is a
    // different thing from the same name as a coach record.
    detail: [row.role, row.phone ? `ends ${String(row.phone).slice(-4)}` : null]
      .filter(Boolean)
      .join(", "),
  }));
}

async function findCoaches(
  supabase: SupabaseClient<Database>,
  tokens: string[]
): Promise<Candidate[]> {
  // SECURITY DEFINER — the only way a client or a coach can read a colleague's
  // name at all. Active coaches only, which is the right list for "book X".
  const { data, error } = await supabase.rpc("public_coach_roster");
  if (error) return [];
  const lowered = tokens.map((t) => t.toLowerCase());
  return ((data ?? []) as { id: string; full_name: string | null }[])
    .filter((c) => {
      const name = (c.full_name ?? "").toLowerCase();
      return lowered.every((t) => name.includes(t));
    })
    .slice(0, PER_KIND_LIMIT)
    .map((c) => ({ kind: "coach" as const, id: c.id, label: c.full_name ?? "", detail: "coach" }));
}

async function findClasses(
  supabase: SupabaseClient<Database>,
  tokens: string[]
): Promise<Candidate[]> {
  const { data, error } = await applyTokens(
    supabase
      .from("classes")
      .select("id,title,class_type,skill_level,active,location_label")
      .limit(PER_KIND_LIMIT),
    "title",
    tokens
  );
  if (error) return [];
  return (data ?? []).map((row) => ({
    kind: "class" as const,
    id: row.id,
    label: row.title ?? "",
    detail: [
      row.class_type,
      row.location_label ?? null,
      row.active === false ? "ended" : null,
    ]
      .filter(Boolean)
      .join(", "),
  }));
}

async function findVenues(
  supabase: SupabaseClient<Database>,
  tokens: string[]
): Promise<Candidate[]> {
  const { data, error } = await applyTokens(
    supabase.from("venues").select("id,name,unit,is_public,is_school").limit(PER_KIND_LIMIT),
    "name",
    tokens
  );
  if (error) return [];
  return (data ?? []).map((row) => ({
    kind: "venue" as const,
    id: row.id,
    label: row.name ?? "",
    detail: [row.unit, row.is_school ? "school campus" : null].filter(Boolean).join(", "),
  }));
}

const LOOKUPS: Record<
  EntityKind,
  (supabase: SupabaseClient<Database>, tokens: string[]) => Promise<Candidate[]>
> = {
  player: findPlayers,
  client: findClients,
  coach: findCoaches,
  class: findClasses,
  venue: findVenues,
};

/**
 * Search every kind this role can see, at once. One failing lookup must not
 * take the others down — a table the caller can't read is a reason to return
 * fewer kinds, never a reason to answer nothing.
 */
export async function resolveName(
  supabase: SupabaseClient<Database>,
  role: Role,
  name: string,
  only?: readonly EntityKind[]
): Promise<Candidate[]> {
  const tokens = tokenize(name);
  if (tokens.length === 0) return [];

  const allowed = KINDS_FOR_ROLE[role].filter((k) => !only?.length || only.includes(k));
  const settled = await Promise.allSettled(
    allowed.map((kind) => LOOKUPS[kind](supabase, tokens))
  );

  const found: Candidate[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") found.push(...result.value);
    else console.warn("wa: resolve lookup failed", result.reason);
  }

  const ranked = found
    .map((c) => ({ candidate: c, rank: rankOf(c.label, name) }))
    .sort((a, b) => b.rank - a.rank || a.candidate.label.localeCompare(b.candidate.label))
    .slice(0, TOTAL_LIMIT);
  return ranked.map(({ candidate }) => candidate);
}

const KIND_VALUES: readonly EntityKind[] = ["player", "client", "coach", "class", "venue"];

export function resolveTool(role: Role): WaTool {
  const kinds = KINDS_FOR_ROLE[role];
  return {
    name: "resolve",
    description: `Work out WHAT a name is before you act on it. Searches ${kinds.join(", ")} in one call and returns typed, ranked candidates — so you never have to guess which sort of thing "Aarav" is.

USE IT WHENEVER a person, class or place is named and you don't already hold its id. A child, a parent, a coach and a class can all share a name, and picking a table by intuition is how "what did Aarav do today" became "I can't find a client named Aarav" about a boy who trains twice a week.

Partial names work, in any order: "abhay" and "gupta abhay" both reach Abhay Gupta.

WHAT TO DO WITH THE ANSWER
- Exactly one candidate: use its id and get on with the question.
- Several: ask which one, quoting the \`detail\` that tells them apart ("Aarav — Meera's child" vs "Aarav — Beginners"). Offer them as a short numbered list. Never pick for them, and never show the ids.
- None: say you searched every kind of record for that name and found nothing, and ask for a spelling or another detail. Do NOT report it as "no such client" — you did not search only clients.

NEVER answer a question with the failure of a guess. If this tool returns anything at all, the name exists and the honest reply is either the answer or a question about which one.`,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name, or part of it, as the person said it" },
        kinds: {
          type: "array",
          items: { type: "string", description: `One of: ${kinds.join(", ")}` },
          description:
            "Optional — narrow the search when you genuinely know the kind. Omit it by default; searching everything is the point.",
        },
      },
      required: ["name"],
    },
    run: async (input, ctx: ToolContext) => {
      const supabase = ctx.supabase;
      if (!supabase) return fail("You need to be signed in for that.");

      const name = String(input.name ?? "").trim();
      if (!name) return fail("Give me the name to look up.");

      const requested = (Array.isArray(input.kinds) ? input.kinds : input.kinds ? [input.kinds] : [])
        .map((k: unknown) => String(k).trim().toLowerCase())
        .filter((k: string): k is EntityKind => (KIND_VALUES as readonly string[]).includes(k));
      const bad = (Array.isArray(input.kinds) ? input.kinds : []).length && requested.length === 0;
      if (bad) return fail(`Unknown kind. Available to you: ${kinds.join(", ")}.`);

      const candidates = await resolveName(supabase, role, name, requested);

      if (candidates.length === 0) {
        // Spell out what was actually searched. "Nothing found" is only honest
        // when the reply also says where you looked — otherwise the model fills
        // that gap in itself, and it fills it with a table it never queried.
        return ok({
          searched_for: name,
          searched_kinds: kinds,
          count: 0,
          no_match: `Nothing named "${name}" in ${kinds.join(", ")}. This is not evidence it doesn't exist — check the spelling or ask for another detail.`,
        });
      }

      return ok({
        searched_for: name,
        count: candidates.length,
        // Named so the model can't miss it: more than one means ASK.
        ambiguous: candidates.length > 1,
        candidates,
      });
    },
  };
}
