// Working memory — the referents the bot resolved, kept somewhere lint can't
// reach.
//
// THE FAILURE THIS FIXES
// ----------------------
// Two correct rules compose into amnesia:
//
//   1. lintReply rewrites every uuid in the reply to "that one", because a
//      founder must never be shown one.
//   2. loadHistory rebuilds the model's entire context from that stored text.
//      Tool calls and their results are never persisted.
//
// So the only memory the bot has is its own laundered prose. An id it resolved
// in turn 1 does not exist in turn 2. On 11 August the founder asked about a
// player, then followed up with "she had a class today" — and the bot queried
// bookings with no usable player id, found nothing, and said so, while the
// child had sat a private session that afternoon.
//
// Neither rule should change. What changes is where the ids live: harvested
// from tool RESULTS (which are structured, and never shown to anyone) into
// wa_entity_memory, and injected back into the model's context each turn.
//
// WHY A HARVESTER AND NOT A CONVENTION
// ------------------------------------
// There are 68 tools. Asking each to declare what it resolved is 68 chances to
// forget, and the ones that forget are silently the ones that break. Walking
// the JSON instead means a tool added next month is remembered without anybody
// wiring it up.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** How many referents ride in the context. Enough for a real conversation,
 *  small enough that it never crowds out the transcript. */
const RECALL_LIMIT = 25;

/** Cap per turn, so one 200-row `find` can't flood the store. */
const HARVEST_LIMIT = 40;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type Remembered = {
  kind: string;
  id: string;
  label: string;
  detail?: string;
};

/**
 * Container name → what the thing IS.
 *
 * Both the table names PostgREST embeds under (`players`, `class_sessions`) and
 * the singular names the hand-written tools use (`player`, `session`).
 */
const KIND_BY_KEY: Record<string, string> = {
  players: "player",
  player: "player",
  profiles: "client",
  client: "client",
  clients: "client",
  coaches: "coach",
  coach: "coach",
  classes: "class",
  class: "class",
  class_sessions: "session",
  sessions: "session",
  session: "session",
  venues: "venue",
  venue: "venue",
  bookings: "booking",
  booking: "booking",
  subscriptions: "subscription",
  orders: "order",
};

/** `find`'s own entity names, which are neither table nor singular. */
const KIND_BY_ENTITY: Record<string, string> = {
  sessions: "session",
  classes: "class",
  bookings: "booking",
  players: "player",
  clients: "client",
  coaches: "coach",
  venues: "venue",
  group_series: "series",
  private_series: "series",
  subscriptions: "subscription",
  orders: "order",
};

/** The first of these present on a row is its human name. */
const LABEL_KEYS = ["full_name", "title", "name", "label", "player_name", "coach_name"] as const;

function labelOf(row: Record<string, unknown>): string | null {
  for (const key of LABEL_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * A short phrase that tells one row from a namesake. Deliberately cheap: a
 * start time, a status, a level — whatever the row already carries.
 */
function detailOf(row: Record<string, unknown>): string | undefined {
  const bits: string[] = [];
  const starts = row.starts_at;
  if (typeof starts === "string") {
    const at = new Date(starts);
    if (!Number.isNaN(at.getTime())) bits.push(at.toISOString());
  }
  for (const key of ["status", "skill_level", "class_type", "weekday"]) {
    const value = row[key];
    if (typeof value === "string" && value && value !== "any") bits.push(value);
  }
  const nested = row.classes ?? row.class;
  const nestedRow = Array.isArray(nested) ? nested[0] : nested;
  if (nestedRow && typeof nestedRow === "object") {
    const title = (nestedRow as Record<string, unknown>).title;
    if (typeof title === "string" && title) bits.unshift(title);
  }
  return bits.length ? bits.slice(0, 3).join(", ") : undefined;
}

/**
 * `<kind>_id` scalars — how the hand-written tools report what they just acted
 * on ({ok:true, session_id, booking_id}). No label comes with them, so the id
 * is remembered under its own kind and labelled from a sibling name if the
 * result carries one.
 */
const ID_SUFFIX = /^(.*)_id$/;

const KIND_BY_ID_KEY: Record<string, string> = {
  player: "player",
  client: "client",
  coach: "coach",
  class: "class",
  session: "session",
  venue: "venue",
  booking: "booking",
  series: "series",
  subscription: "subscription",
  order: "order",
};

/**
 * Walk a tool result and pull out everything that has an id and a name.
 *
 * Depth-limited and breadth-limited on purpose — this runs inside the webhook's
 * after() budget on every tool call, and a pathological result must cost
 * bounded time rather than proportional time.
 */
export function harvest(value: unknown, hint?: string): Remembered[] {
  const out: Remembered[] = [];
  const seen = new Set<string>();

  const push = (entry: Remembered) => {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key) || out.length >= HARVEST_LIMIT) return;
    seen.add(key);
    out.push(entry);
  };

  const walk = (node: unknown, kind: string | undefined, depth: number) => {
    if (depth > 6 || out.length >= HARVEST_LIMIT) return;

    if (Array.isArray(node)) {
      for (const item of node.slice(0, HARVEST_LIMIT)) walk(item, kind, depth + 1);
      return;
    }
    if (!node || typeof node !== "object") return;
    const row = node as Record<string, unknown>;

    // `find` names its own entity in the envelope; everything under `rows`
    // inherits it. Without this a row of players is indistinguishable from a
    // row of anything else, because the table name never appears.
    const entity = typeof row.entity === "string" ? KIND_BY_ENTITY[row.entity] : undefined;

    if (isUuid(row.id)) {
      const label = labelOf(row);
      // No name means nothing worth recalling: an id with no way to say it back
      // to a person is exactly what must never re-enter the conversation.
      if (label && kind) push({ kind, id: row.id, label, detail: detailOf(row) });
    }

    // Scalar *_id fields, labelled from a sibling name where one exists.
    for (const [key, value] of Object.entries(row)) {
      if (!isUuid(value)) continue;
      const match = ID_SUFFIX.exec(key);
      const idKind = match ? KIND_BY_ID_KEY[match[1]] : undefined;
      if (!idKind) continue;
      // players(full_name) sitting next to player_id is the common shape.
      const sibling = row[match![1]] ?? row[`${match![1]}s`];
      const siblingRow = Array.isArray(sibling) ? sibling[0] : sibling;
      const label =
        (siblingRow && typeof siblingRow === "object"
          ? labelOf(siblingRow as Record<string, unknown>)
          : null) ??
        (typeof row[`${match![1]}_name`] === "string" ? String(row[`${match![1]}_name`]) : null);
      if (label) push({ kind: idKind, id: value, label, detail: detailOf(row) });
    }

    for (const [key, child] of Object.entries(row)) {
      if (!child || typeof child !== "object") continue;
      const childKind = KIND_BY_KEY[key] ?? (key === "rows" || key === "candidates" ? entity ?? kind ?? hint : undefined);
      walk(child, childKind, depth + 1);
    }
  };

  walk(value, hint, 0);
  return out;
}

/**
 * `resolve` already knows exactly what it found — take it at its word rather
 * than re-deriving it from the envelope.
 */
export function harvestResolved(value: unknown): Remembered[] {
  if (!value || typeof value !== "object") return [];
  // Tools answer through ok(), which wraps the payload in {ok, result} — so the
  // candidates arrive one level down from where the tool put them.
  const payload = (value as { result?: unknown }).result ?? value;
  if (!payload || typeof payload !== "object") return [];
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return [];
  const out: Remembered[] = [];
  for (const raw of candidates.slice(0, HARVEST_LIMIT)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (!isUuid(c.id) || typeof c.kind !== "string" || typeof c.label !== "string") continue;
    out.push({
      kind: c.kind,
      id: c.id,
      label: c.label,
      detail: typeof c.detail === "string" ? c.detail : undefined,
    });
  }
  return out;
}

/**
 * Write what this turn resolved. Best-effort by design: a memory that fails to
 * save must never take a working reply down with it.
 */
export async function remember(
  admin: SupabaseClient<Database>,
  phone: string,
  entries: readonly Remembered[]
): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  const rows = entries.slice(0, HARVEST_LIMIT).map((e) => ({
    phone,
    kind: e.kind,
    entity_id: e.id,
    label: e.label.slice(0, 200),
    detail: e.detail?.slice(0, 200) ?? null,
    last_seen_at: now,
  }));
  const { error } = await admin
    .from("wa_entity_memory")
    .upsert(rows, { onConflict: "phone,kind,entity_id" });
  if (error) console.warn("wa: entity memory write failed", error.message);
}

/** Read this chat's referents, most recently used first. */
export async function recall(
  admin: SupabaseClient<Database>,
  phone: string
): Promise<Remembered[]> {
  const { data, error } = await admin
    .from("wa_entity_memory")
    .select("kind,entity_id,label,detail")
    .eq("phone", phone)
    .order("last_seen_at", { ascending: false })
    .limit(RECALL_LIMIT);
  if (error) {
    console.warn("wa: entity memory read failed", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    kind: r.kind,
    id: r.entity_id,
    label: r.label,
    detail: r.detail ?? undefined,
  }));
}

/**
 * Render the referents into the block the model reads.
 *
 * The ids ARE the point, so they appear in full. They only ever travel to the
 * model: this string is appended to the request, never to a reply, and lint
 * still scrubs anything that tries to come back out in the visible text.
 */
export function renderMemory(entries: readonly Remembered[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map(
    (e) => `- ${e.kind} "${e.label}"${e.detail ? ` (${e.detail})` : ""} = ${e.id}`
  );
  return `(Working memory — things already identified in this conversation. These ids are usable directly, so when the person says "her", "that one" or "cancel it", resolve it from this list instead of looking it up again or asking who they mean. Never show an id to the person.)
${lines.join("\n")}`;
}
