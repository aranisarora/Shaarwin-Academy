// The filter/aggregate engine behind the generic `find` tool.
//
// Everything here is registry-agnostic: it knows how to turn a validated filter
// list into PostgREST calls, how to canonicalize the values that go into them,
// and how to fold rows into groups, but it knows nothing about which entities or
// columns exist. The registry (find-registry.ts) supplies that, and validation
// happens there — so by the time a filter reaches this file its column has
// already been checked against an allow-list.
//
// Why an allow-list of operators rather than passing strings through: the model
// composes these, and PostgREST's `.or()` / raw filter syntax would let an
// invented string reach the query planner. A closed operator set means the worst
// a bad tool call can do is return the wrong rows — never a different shape of
// query than the one we intended.

import { academyWallToUtc, shiftWallDate } from "@/lib/academy-time";
import { normalizePhoneInput } from "../phone";

export const OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "in",
  "not_in",
  "is_null",
  "not_null",
] as const;

export type Operator = (typeof OPERATORS)[number];

export type Filter = {
  /** Column, or a dotted path into a declared embed (e.g. "classes.title"). */
  col: string;
  op: Operator;
  value?: unknown;
};

export const AGGREGATES = ["count", "sum", "avg", "min", "max"] as const;
export type AggregateFn = (typeof AGGREGATES)[number];

export type Aggregate = { fn: AggregateFn; col?: string };

/**
 * Minimal shape of the PostgREST builder we use. Typing it structurally instead
 * of importing PostgrestFilterBuilder keeps this file free of supabase-js
 * generics, which fight hard when the table is only known at runtime.
 */
export type FilterTarget = {
  eq(col: string, value: unknown): FilterTarget;
  neq(col: string, value: unknown): FilterTarget;
  gt(col: string, value: unknown): FilterTarget;
  gte(col: string, value: unknown): FilterTarget;
  lt(col: string, value: unknown): FilterTarget;
  lte(col: string, value: unknown): FilterTarget;
  like(col: string, pattern: string): FilterTarget;
  ilike(col: string, pattern: string): FilterTarget;
  in(col: string, values: readonly unknown[]): FilterTarget;
  is(col: string, value: null | boolean): FilterTarget;
  not(col: string, op: string, value: unknown): FilterTarget;
};

/** Wildcards are implicit: the model says "plaza", we search "*plaza*". */
function pattern(value: unknown): string {
  const raw = String(value ?? "");
  return raw.includes("*") || raw.includes("%") ? raw.replaceAll("*", "%") : `%${raw}%`;
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  // The model sometimes sends "a,b" where the schema asked for an array.
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function applyFilter<T extends FilterTarget>(query: T, filter: Filter): T {
  const { col, op, value } = filter;
  switch (op) {
    case "eq":
      return query.eq(col, value) as T;
    case "neq":
      return query.neq(col, value) as T;
    case "gt":
      return query.gt(col, value) as T;
    case "gte":
      return query.gte(col, value) as T;
    case "lt":
      return query.lt(col, value) as T;
    case "lte":
      return query.lte(col, value) as T;
    case "like":
      return query.like(col, pattern(value)) as T;
    case "ilike":
      return query.ilike(col, pattern(value)) as T;
    case "in":
      return query.in(col, asArray(value)) as T;
    case "not_in":
      // PostgREST spells NOT IN as not.in with a parenthesised list, and unlike
      // .in() the value is a raw string we assemble ourselves — so the quoting
      // supabase-js would have done is ours to do. Without it a venue called
      // "Smith, John's" splits into two bogus terms.
      return query.not(
        col,
        "in",
        `(${asArray(value)
          .map((v) => `"${String(v).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
          .join(",")})`
      ) as T;
    case "is_null":
      return query.is(col, null) as T;
    case "not_null":
      return query.not(col, "is", null) as T;
  }
}

// ── Value normalization ─────────────────────────────────────────────────────
//
// Writes canonicalize and reads did not. normalizePhone runs on every write path
// and on the identity handshake; nothing at all ran on the way INTO a query, so
// a value spelled the way a person spells it was compared verbatim against the
// canonical one the column holds, matched nothing, and came back as "I couldn't
// find a client with that number" — followed by an invented explanation. These
// are the read-side counterpart; the registry hangs one on each filter that
// needs it.

/** Rupees as anyone would say them ("5000", "₹1,599") → the paise stored. */
export function fromRupees(value: unknown): number | null {
  const raw = String(value ?? "")
    .trim()
    .replace(/^(?:₹|rs\.?|inr)\s*/i, "")
    .replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  return Math.round(Number(raw) * 100);
}

/** The name a minor-unit column takes on the way out… */
export function rupeeField(col: string): string {
  return col.endsWith("_pence") ? `${col.slice(0, -"_pence".length)}_inr` : col;
}

/** …and the way back, because the model asks for the name it was shown. */
export function minorField(col: string): string {
  return col.endsWith("_inr") ? `${col.slice(0, -"_inr".length)}_pence` : col;
}

/**
 * Rewrite every *_pence field in a result to whole rupees named *_inr, in place
 * and through embeds.
 *
 * The column is paise: the ₹1,599 plan is 159900, and handed back under a name
 * the model reads as pence it was reported as "₹159,900" — the one failure here
 * that produces a confident wrong NUMBER rather than nothing. The raw field is
 * replaced rather than supplemented, because leaving both is an invitation to
 * quote the wrong one. The rounding is client_payments', so the two tools can
 * never name a different figure for the same invoice.
 */
export function toRupees(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) toRupees(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const row = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(row)) {
    if (!key.endsWith("_pence")) {
      toRupees(value);
      continue;
    }
    delete row[key];
    row[rupeeField(key)] = typeof value === "number" ? Math.round(value / 100) : value;
  }
}

/**
 * A phone the way it was said → the E.164 the column holds.
 *
 * The national trunk "0" is dropped here rather than in normalizePhoneInput:
 * that one guards a WRITE, where a leading zero is likelier a typo worth
 * rejecting than a number worth guessing at. A read only risks looking in the
 * wrong place.
 */
export function phoneNumber(value: unknown): string | null {
  const digits = String(value ?? "").replace(/[^\d+]/g, "");
  return normalizePhoneInput(/^0[6-9]\d{9}$/.test(digits) ? digits.slice(1) : digits);
}

// Dates. Every timestamp in the database is UTC and the academy lives at +05:30,
// so "June" sent as 2026-06-01T00:00:00Z is really 05:30 on 1 June: the window
// is short at one end and long at the other. Only the tool description ever said
// "IST", and a description is a request, not an enforcement. It bites hardest on
// created_at / booked_at / paid_at, the columns that fill up at all hours.

const MONTH = /^(\d{4})-(\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function firstOfMonth(year: number, month: number): string {
  const at = new Date(Date.UTC(year, month - 1, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The instant just before an academy day begins — an inclusive upper bound. */
function lastInstantBefore(start: Date): string {
  return new Date(start.getTime() - 1).toISOString();
}

function istInstant(value: unknown, edge: "start" | "end"): string | null {
  const raw = String(value ?? "").trim();

  const month = MONTH.exec(raw);
  if (month) {
    const year = Number(month[1]);
    const mo = Number(month[2]);
    // Date.UTC rolls a bad month over silently — "2026-13" would answer for
    // January 2027 and "2026-00" for December 2025, both without complaint.
    // Every other unreadable value returns null and is refused out loud.
    if (mo < 1 || mo > 12) return null;
    return edge === "start"
      ? academyWallToUtc(firstOfMonth(year, mo), "00:00").toISOString()
      : lastInstantBefore(academyWallToUtc(firstOfMonth(year, mo + 1), "00:00"));
  }
  if (DAY.test(raw)) {
    return edge === "start"
      ? academyWallToUtc(raw, "00:00").toISOString()
      : lastInstantBefore(academyWallToUtc(shiftWallDate(raw, 1), "00:00"));
  }
  const wall = WALL_CLOCK.exec(raw);
  if (wall) {
    const at = academyWallToUtc(wall[1], wall[2]);
    return new Date(at.getTime() + Number(wall[3] ?? 0) * 1000).toISOString();
  }
  // It already carries an offset: the model was explicit, and second-guessing an
  // explicit instant is how a window ends up shifted twice.
  return OFFSET.test(raw) && Number.isFinite(Date.parse(raw)) ? raw : null;
}

/** Lower bound: the first instant of an academy day or month. */
export function istStart(value: unknown): string | null {
  return istInstant(value, "start");
}

/** Upper bound: the LAST instant of one, so "to June" doesn't drop June. */
export function istEnd(value: unknown): string | null {
  return istInstant(value, "end");
}

/** Read a dotted path, tolerating PostgREST's one-row embeds arriving as arrays. */
export function pluck(row: unknown, path: string): unknown {
  let cursor: unknown = row;
  for (const key of path.split(".")) {
    if (Array.isArray(cursor)) cursor = cursor[0];
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return Array.isArray(cursor) ? cursor[0] : cursor;
}

function numeric(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export type GroupedRow = Record<string, unknown> & { count: number };

/**
 * Fold rows into groups in TypeScript rather than SQL.
 *
 * PostgREST aggregate functions are off by default on Supabase, and turning
 * them on is a project-wide switch we don't want to flip for a chat tool. At
 * academy scale the row counts here are hundreds, not millions, so folding in
 * memory over a capped fetch gives the same answers. `truncated` on the caller's
 * side is what keeps that honest when the cap bites.
 */
export function groupRows(
  rows: readonly unknown[],
  groupBy: readonly string[],
  aggregates: readonly Aggregate[]
): GroupedRow[] {
  const buckets = new Map<string, { keys: Record<string, unknown>; rows: unknown[] }>();

  for (const row of rows) {
    const keys: Record<string, unknown> = {};
    for (const path of groupBy) keys[path] = pluck(row, path) ?? null;
    const id = JSON.stringify(groupBy.map((p) => keys[p]));
    const bucket = buckets.get(id);
    if (bucket) bucket.rows.push(row);
    else buckets.set(id, { keys, rows: [row] });
  }

  const out: GroupedRow[] = [];
  for (const { keys, rows: members } of buckets.values()) {
    const entry: GroupedRow = { ...keys, count: members.length };
    for (const agg of aggregates) {
      if (agg.fn === "count") continue; // always present
      if (!agg.col) continue;
      const values = members
        .map((r) => numeric(pluck(r, agg.col as string)))
        .filter((v): v is number => v !== null);
      const label = `${agg.fn}_${agg.col.replaceAll(".", "_")}`;
      if (values.length === 0) {
        entry[label] = null;
        continue;
      }
      switch (agg.fn) {
        case "sum":
          entry[label] = values.reduce((a, b) => a + b, 0);
          break;
        case "avg":
          entry[label] = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
          break;
        case "min":
          entry[label] = Math.min(...values);
          break;
        case "max":
          entry[label] = Math.max(...values);
          break;
      }
    }
    out.push(entry);
  }

  // Biggest group first — "who has the most X" is the common question.
  return out.sort((a, b) => b.count - a.count);
}

// ── PostgREST select fragments ──────────────────────────────────────────────
//
// Two things want to describe the same embed and they have to be reconciled:
// the caller's chosen `include` ("give me the class with its venue") and the
// filter's requirement ("…and it must be !inner, or filtering on the class
// title won't actually drop any sessions"). Emitting both produces a duplicate
// embed; picking one silently loses whatever the other asked for. So parse both
// into trees, merge, and print once.

export type SelectNode = { name: string; inner: boolean; children: SelectNode[] };

/** Split on commas that sit at paren depth zero. */
function splitTop(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function parseSelect(fragment: string): SelectNode[] {
  return splitTop(fragment).map((part) => {
    const open = part.indexOf("(");
    if (open === -1) return { name: part, inner: false, children: [] };
    const head = part.slice(0, open);
    const body = part.slice(open + 1, part.lastIndexOf(")"));
    const inner = head.endsWith("!inner");
    return {
      name: inner ? head.slice(0, -"!inner".length) : head,
      inner,
      children: parseSelect(body),
    };
  });
}

function mergeNodes(into: SelectNode[], from: readonly SelectNode[]): SelectNode[] {
  const out = into.map((n) => ({ ...n, children: [...n.children] }));
  for (const node of from) {
    const existing = out.find((n) => n.name === node.name);
    if (!existing) {
      out.push({ ...node, children: [...node.children] });
      continue;
    }
    // !inner is contagious upward: if any contributor needs the join to filter
    // the parent, the merged embed must be inner or the filter silently no-ops.
    existing.inner = existing.inner || node.inner;
    existing.children = mergeNodes(existing.children, node.children);
  }
  return out;
}

export function printSelect(nodes: readonly SelectNode[]): string {
  return nodes
    .map((n) =>
      n.children.length === 0
        ? n.name
        : `${n.name}${n.inner ? "!inner" : ""}(${printSelect(n.children)})`
    )
    .join(",");
}

/** Merge any number of select fragments into one, deduping embeds by name. */
export function mergeSelect(...fragments: readonly (string | undefined)[]): string {
  let nodes: SelectNode[] = [];
  for (const fragment of fragments) {
    if (!fragment) continue;
    nodes = mergeNodes(nodes, parseSelect(fragment));
  }
  return printSelect(nodes);
}

/** Parse the model's loose aggregate spec ("sum:duration_minutes") into a shape. */
export function parseAggregates(input: unknown): Aggregate[] {
  const specs = Array.isArray(input) ? input : input == null ? [] : [input];
  const out: Aggregate[] = [];
  for (const spec of specs) {
    const [fnRaw, colRaw] = String(spec).split(":");
    const fn = fnRaw?.trim() as AggregateFn;
    if (!(AGGREGATES as readonly string[]).includes(fn)) continue;
    const col = colRaw?.trim();
    if (fn !== "count" && !col) continue;
    out.push(col ? { fn, col } : { fn });
  }
  return out;
}
