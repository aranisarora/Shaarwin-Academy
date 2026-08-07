// `find` — one read tool over the whole domain.
//
// The bot used to be able to answer exactly the questions someone had written a
// list_* tool for: "what's on tomorrow" yes, "what's on at La Plazza this week"
// no, because list_sessions took `days` and nothing else. Selection was
// everything-or-one-id with no middle, and the middle is where the real
// questions live. This tool makes WHICH-ONES a parameter.
//
// Safety rests on three things, in this order:
//   1. It runs on the caller's own RLS-scoped session — never ctx.admin. A
//      client's `find` sees exactly what a client's SELECT sees.
//   2. The registry's column allow-list, because RLS has no column granularity
//      and a few tables carry one field that must not reach a chat transcript.
//   3. The registry's role allow-list, because a handful of read policies are
//      broader than the screens that rely on them.
//
// It is read-only: no insert, update, delete or RPC path exists here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  applyFilter,
  groupRows,
  mergeSelect,
  parseAggregates,
  pluck,
  OPERATORS,
  type Filter,
  type FilterTarget,
  type Operator,
} from "./query-core";
import { ENTITIES, describeEntities, type EntityDef, type Role } from "./find-registry";
import { fail, ok, type ToolContext, type WaTool } from "./types";

/** Rows fetched in one call. Tools run inside the webhook's after() budget. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/**
 * Rows scanned when grouping. Aggregates are folded in TypeScript (PostgREST
 * aggregate functions are a project-wide switch we don't want to flip for a
 * chat tool), so this is the honesty boundary: past it the answer is a sample
 * and the response says so.
 */
const GROUP_SCAN_LIMIT = 1000;

type ParsedFilter = Filter & { name: string };

function parseFilters(
  def: EntityDef,
  raw: unknown
): { filters: ParsedFilter[] } | { error: string } {
  if (raw == null) return { filters: [] };
  if (!Array.isArray(raw)) return { error: "`where` must be an array of {field, op, value}." };

  const filters: ParsedFilter[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { error: "Each `where` entry must be an object like {field, op, value}." };
    }
    const item = entry as Record<string, unknown>;
    const name = String(item.field ?? item.col ?? "").trim();
    // hasOwn, not truthiness: `filters["constructor"]` finds Object.prototype's
    // and sails through the allow-list with an undefined column path.
    const def_ = Object.hasOwn(def.filters, name) ? def.filters[name] : undefined;
    if (!def_) {
      // Loud, not silent. A dropped filter returns every row as though it had
      // applied, which reads to the founder as a confident wrong answer.
      return {
        error: `Unknown field "${name}". Available: ${Object.keys(def.filters).join(", ")}.`,
      };
    }

    const op = String(item.op ?? "eq").trim() as Operator;
    if (!(OPERATORS as readonly string[]).includes(op)) {
      return { error: `Unknown op "${op}". Available: ${OPERATORS.join(", ")}.` };
    }
    if (def_.ops && !def_.ops.includes(op)) {
      return { error: `Field "${name}" only supports: ${def_.ops.join(", ")}.` };
    }

    const needsValue = op !== "is_null" && op !== "not_null";
    if (needsValue && item.value == null) {
      return { error: `Field "${name}" with op "${op}" needs a value.` };
    }

    // An out-of-vocabulary enum matches nothing, which is indistinguishable
    // from "there are none" — say so instead of answering zero.
    if (def_.values && needsValue) {
      const supplied = Array.isArray(item.value) ? item.value : [item.value];
      const bad = supplied.map(String).filter((v) => !def_.values!.includes(v));
      if (bad.length) {
        return {
          error: `"${bad.join(", ")}" is not a valid ${name}. Valid: ${def_.values.join(", ")}.`,
        };
      }
    }

    filters.push({ name, col: def_.path, op, value: item.value });
  }
  return { filters };
}

function buildSelect(
  def: EntityDef,
  filters: readonly ParsedFilter[],
  rawIncludes: unknown,
  grouping: boolean
): { select: string } | { error: string } {
  const requested = Array.isArray(rawIncludes)
    ? rawIncludes.map(String)
    : rawIncludes == null
      ? [...def.defaultIncludes]
      : [String(rawIncludes)];

  const available = Object.keys(def.includes);
  const unknown = requested.filter((name) => !Object.hasOwn(def.includes, name));
  if (unknown.length) {
    // Silently ignoring it would ALSO have dropped the defaults, so a typo
    // returned a barer row than either the caller or the defaults asked for.
    return {
      error: `Unknown include "${unknown.join(", ")}". Available for ${def.table}: ${available.join(", ") || "none"}.`,
    };
  }

  const fragments = [def.columns];
  // Grouping folds over whatever the rows contain, so a group path that isn't
  // in the select reads as one big null bucket — a confident wrong answer.
  // Fetching every embed is the cheap way to guarantee the paths exist.
  const names = grouping ? available : requested;
  for (const name of names) {
    fragments.push(def.includes[name]);
  }
  // A filter on an embedded column only prunes parent rows through an !inner
  // join, so each used filter contributes its own spelling of the embed. The
  // merger reconciles that with whatever the include already asked for.
  for (const filter of filters) {
    const requires = def.filters[filter.name]?.requires;
    if (requires) fragments.push(requires);
  }
  return { select: mergeSelect(...fragments) };
}

/**
 * Fill in coach names the caller can't read directly.
 *
 * `profiles` is owner-scoped, so a coach or a client embedding
 * `coaches(profiles(full_name))` gets null and the assistant cheerfully reports
 * a session with no coach. `public_coach_roster()` is SECURITY DEFINER and
 * exists for exactly this — it returns active coaches' public details. The
 * founder can read profiles directly, so this only runs when it's needed and
 * only when the rows actually came back nameless.
 */
async function fillCoachNames(
  supabase: SupabaseClient<Database>,
  rows: Record<string, unknown>[]
): Promise<void> {
  const withCoach = rows.filter((r) => r.coach_id);
  if (withCoach.length === 0) return;

  // `coach_name` is set on EVERY row that has a coach, from the embed when it
  // resolved and from the roster when it didn't. One place to read the name
  // from means "group by coach" behaves the same for the founder (who can read
  // profiles) as for a coach (who can't) — otherwise that grouping is all-null
  // for exactly one of them, which is the kind of difference nobody notices.
  const embedded = new Map<Record<string, unknown>, unknown>();
  for (const row of withCoach) embedded.set(row, pluck(row, "coaches.profiles.full_name"));

  let names: Map<string, string | null> | null = null;
  if (withCoach.some((row) => !embedded.get(row))) {
    const { data } = await supabase.rpc("public_coach_roster");
    names = new Map(
      ((data ?? []) as { id: string; full_name: string | null }[]).map((c) => [c.id, c.full_name])
    );
  }

  for (const row of withCoach) {
    const fromEmbed = embedded.get(row);
    row.coach_name = fromEmbed ?? names?.get(String(row.coach_id)) ?? null;
  }
}

async function runFind(
  role: Role,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const supabase = ctx.supabase;
  if (!supabase) return fail("You need to be signed in for that.");

  const entityName = String(input.entity ?? "").trim();
  const def = Object.hasOwn(ENTITIES, entityName) ? ENTITIES[entityName] : undefined;
  if (!def || !def.roles.includes(role)) {
    const available = Object.entries(ENTITIES)
      .filter(([, d]) => d.roles.includes(role))
      .map(([n]) => n);
    return fail(`Unknown entity "${entityName}". Available: ${available.join(", ")}.`);
  }

  const parsed = parseFilters(def, input.where);
  if ("error" in parsed) return fail(parsed.error);
  const { filters } = parsed;

  const groupBy = (Array.isArray(input.group_by) ? input.group_by : input.group_by ? [input.group_by] : [])
    .map(String)
    .filter(Boolean);
  const badGroup = groupBy.filter((g) => !def.groupable.includes(g));
  if (badGroup.length) {
    return fail(
      `Can't group by "${badGroup.join(", ")}". Available: ${def.groupable.join(", ")}.`
    );
  }
  const aggregates = parseAggregates(input.aggregate);
  const grouping = groupBy.length > 0;
  if (aggregates.length && !grouping) {
    return fail("`aggregate` needs `group_by` — or use count_only for a plain total.");
  }
  // An aggregate over a column we never selected silently returns null for
  // every group, which reads as "zero" rather than "I didn't fetch that".
  const baseColumns = def.columns.split(",");
  const badAgg = aggregates
    .map((a) => a.col)
    .filter((c) => c !== undefined)
    .filter((c) => !baseColumns.includes(c));
  if (badAgg.length) {
    return fail(`Can't aggregate "${badAgg.join(", ")}". Available: ${baseColumns.join(", ")}.`);
  }
  const countOnly = Boolean(input.count_only) && !grouping;

  const built = buildSelect(def, filters, input.include, grouping);
  if ("error" in built) return fail(built.error);
  const { select } = built;

  // count_only transfers no rows (head:true) but keeps the FULL select: a
  // filter on an embedded path only exists because that embed is in the select,
  // so counting "sessions at La Plazza" against a bare "id" is a PGRST108.
  let query = supabase
    .from(def.table)
    .select(select, countOnly ? { count: "exact", head: true } : undefined);

  for (const filter of filters) {
    query = applyFilter(query as unknown as FilterTarget, filter) as typeof query;
  }

  // Computed once and reused for the `truncated` flag below — recomputing it
  // there let a nonsense limit (0, negative) disagree with the limit actually
  // applied and report every result as truncated.
  const rowLimit = grouping
    ? GROUP_SCAN_LIMIT
    : Math.min(Math.max(Number(input.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  if (!countOnly) {
    // order_desc is absolute, not a toggle: "newest first" means the same thing
    // whichever entity you ask, and four of them are naturally descending.
    const ascending = input.order_desc == null ? def.order.ascending : !input.order_desc;
    query = query.order(def.order.path, { ascending }).limit(rowLimit);
  }

  const { data, error, count } = await query;
  if (error) return fail(`That query didn't work: ${error.message}`);

  if (countOnly) return ok({ entity: entityName, count: count ?? 0 });

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (def.table === "class_sessions" || def.table === "coach_availability") {
    await fillCoachNames(supabase, rows);
  }

  if (grouping) {
    const groups = groupRows(rows, groupBy, aggregates);
    return ok({
      entity: entityName,
      grouped_by: groupBy,
      groups,
      rows_scanned: rows.length,
      // Say it rather than quietly answering from a slice.
      truncated: rows.length >= GROUP_SCAN_LIMIT,
    });
  }

  return ok({
    entity: entityName,
    count: rows.length,
    rows,
    truncated: rows.length >= rowLimit,
  });
}

/**
 * The tool differs per role in which entities it advertises AND which it will
 * serve. The role is closed over from toolsForRole rather than re-read from
 * ctx.profile inside run(), so the list the model was shown and the list the
 * query is checked against cannot drift apart.
 */
export function findTool(role: Role): WaTool {
  return {
    name: "find",
    description: `Look anything up. Instead of a fixed list per question, you choose the entity, the filters and (optionally) how to group — so you can answer questions nobody wrote a tool for: "sessions at La Plazza this week", "clients whose membership lapses in 7 days", "which coach took the most sessions last month".

HOW TO CALL IT
- entity: what to look at (below).
- where: array of {field, op, value}. op is one of ${OPERATORS.join(", ")} and defaults to eq. is_null / not_null take no value. ilike matches loosely — {field:"venue", op:"ilike", value:"plaza"} finds "La Plazza".
- include: extra related data by name; sensible defaults apply if you omit it.
- limit: rows back (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). order_desc: true to reverse the natural order.
- count_only: true returns just a number — use it for "how many", never fetch rows to count them.
- group_by + aggregate: for "most/least/per-X" questions. aggregate takes entries like "count", "sum:delta_minutes". Groups come back biggest first.

Timestamps are ISO 8601; the academy runs on IST. Ids in the result are what the action tools take. If a field name is rejected, the error lists the valid ones — read it and retry rather than guessing.

ENTITIES YOU CAN QUERY
${describeEntities(role)}`,
    input_schema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Which entity to query (see the list above)" },
        where: {
          type: "array",
          description: "Filters, ANDed together",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              op: { type: "string", description: `One of: ${OPERATORS.join(", ")}` },
              value: { description: "Value; omit for is_null / not_null; array for in / not_in" },
            },
            required: ["field"],
          },
        },
        include: {
          type: "array",
          items: { type: "string" },
          description: "Named related data to embed",
        },
        limit: { type: "number", description: `Rows to return (max ${MAX_LIMIT})` },
        order_desc: { type: "boolean", description: "Reverse the entity's natural order" },
        count_only: { type: "boolean", description: "Return only a count — no rows" },
        group_by: {
          type: "array",
          items: { type: "string" },
          description: "Group the results by these paths",
        },
        aggregate: {
          type: "array",
          items: { type: "string" },
          description: 'e.g. ["count","sum:delta_minutes"] — only with group_by',
        },
      },
      required: ["entity"],
    },
    run: (input, ctx) => runFind(role, input, ctx),
  };
}
