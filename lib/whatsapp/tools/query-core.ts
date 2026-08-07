// The filter/aggregate engine behind the generic `find` tool.
//
// Everything here is registry-agnostic: it knows how to turn a validated filter
// list into PostgREST calls and how to fold rows into groups, but it knows
// nothing about which entities or columns exist. The registry (find-registry.ts)
// supplies that, and validation happens there — so by the time a filter reaches
// this file its column has already been checked against an allow-list.
//
// Why an allow-list of operators rather than passing strings through: the model
// composes these, and PostgREST's `.or()` / raw filter syntax would let an
// invented string reach the query planner. A closed operator set means the worst
// a bad tool call can do is return the wrong rows — never a different shape of
// query than the one we intended.

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

function asArray(value: unknown): unknown[] {
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
