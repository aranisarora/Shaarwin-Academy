// Shared types for the admin-ops domain cores. This is a LEAF module: it must
// never import from (or be re-exported in a cycle with) @/lib/admin-ops. The
// barrel re-exports these, but the domain files import them from HERE, so the
// domain files never point back at the barrel — which previously created an
// import cycle that made Turbopack emit a runtime reference to erased types
// (e.g. "ReferenceError: VenueInput is not defined").

import type { Database } from "@/lib/database.types";

export type OpResult = { ok: boolean; error?: string; code?: string };

// Postgres enums, named once so inputs that end up in a column are typed the
// same as the column instead of widening to `string` at the boundary.
type Enums = Database["public"]["Enums"];
export type SkillLevel = Enums["skill_level"];

/** Update payload for a table, so patch objects are checked column by column. */
export type TableUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

const SKILL_LEVELS: readonly SkillLevel[] = [
  "beginner",
  "intermediate",
  "advanced",
  "elite",
  "any",
];

/**
 * Narrow a free-form skill level to the Postgres enum, defaulting to "any".
 *
 * The value reaches here as a plain string from two places that can't promise
 * more: an admin form field, and the WhatsApp bot, where it is whatever the
 * model put in a tool argument. Normalising once means an unrecognised value
 * lands a class on "any" rather than failing the insert at the database.
 */
export function toSkillLevel(value: string | null | undefined): SkillLevel {
  const v = (value ?? "").trim().toLowerCase();
  return (SKILL_LEVELS as readonly string[]).includes(v) ? (v as SkillLevel) : "any";
}
