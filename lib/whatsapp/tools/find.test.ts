import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Profile } from "@/lib/auth";
import { findTool } from "./find";
import { ENTITIES } from "./find-registry";
import type { ToolContext } from "./types";

type Call = { table: string; select: string; head: boolean; ops: string[]; limit?: number };

/**
 * A stand-in for the PostgREST builder that records what was asked for. The
 * point of these tests is the QUERY we construct — the column allow-list, the
 * !inner promotion, the count mode — none of which needs a database to assert.
 */
function stubClient(rows: unknown[] = [], count = 0) {
  const calls: Call[] = [];
  const rpcCalls: string[] = [];

  const client = {
    from(table: string) {
      const call: Call = { table, select: "", head: false, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select(sel: string, opts?: { head?: boolean; count?: string }) {
          call.select = sel;
          call.head = Boolean(opts?.head);
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          call.ops.push(`order(${col},${opts?.ascending})`);
          return builder;
        },
        limit(n: number) {
          call.limit = n;
          return builder;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve({ data: call.head ? null : rows, error: null, count }).then(resolve);
        },
      };
      for (const op of ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "not"]) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push(`${op}(${args.map((a) => JSON.stringify(a)).join(",")})`);
          return builder;
        };
      }
      return builder;
    },
    async rpc(name: string) {
      rpcCalls.push(name);
      return { data: [], error: null };
    },
  };

  return { client: client as unknown as SupabaseClient<Database>, calls, rpcCalls };
}

function ctxFor(
  role: "client" | "coach" | "founder",
  supabase: SupabaseClient<Database>
): ToolContext {
  return {
    phone: "+919812345678",
    profile: { id: "user-1", role } as Profile,
    supabase,
    admin: supabase,
  };
}

async function run(
  role: "client" | "coach" | "founder",
  input: Record<string, unknown>,
  rows: unknown[] = [],
  count = 0
) {
  const { client, calls, rpcCalls } = stubClient(rows, count);
  const out = JSON.parse(await findTool(role).run(input, ctxFor(role, client)));
  return { out, calls, rpcCalls };
}

describe("find — access", () => {
  it("refuses an entity the role may not query, and says what it can", async () => {
    const { out } = await run("client", { entity: "subscriptions" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("subscriptions");
    expect(out.error).toContain("sessions");
  });

  it("refuses an entity that does not exist", async () => {
    const { out } = await run("founder", { entity: "wa_messages" });
    expect(out.ok).toBe(false);
  });

  it("lets the founder query founder-only entities", async () => {
    const { out, calls } = await run("founder", { entity: "subscriptions" });
    expect(out.ok).toBe(true);
    expect(calls[0].table).toBe("subscriptions");
  });
});

/**
 * Columns that must never reach a chat transcript. Several are readable by the
 * person asking — a parent CAN select coach_note on their own booking — so RLS
 * is not what withholds them; this allow-list is.
 */
const WITHHELD = [
  "coach_notes",
  "coach_arrival_source",
  "coach_arrival_distance_m",
  "coach_note",
  "base_address",
  "base_lat",
  "base_lng",
  "stripe_customer_id",
  "razorpay_customer_id",
  "stripe_subscription_id",
  "razorpay_subscription_id",
  "stripe_invoice_id",
  "razorpay_order_id",
  "razorpay_payment_id",
  "password_secret_id",
  "access_notes",
  "disputed",
];

describe("find — the column allow-list", () => {
  it("never selects a withheld column, for any entity, include or filter", async () => {
    for (const [entity, def] of Object.entries(ENTITIES)) {
      for (const role of def.roles) {
        // The worst case: ask for EVERY include and use EVERY filter, so each
        // one's `requires` fragment is merged into the select too.
        const { calls } = await run(role, {
          entity,
          include: Object.keys(def.includes),
          where: Object.entries(def.filters).map(([field, f]) => ({
            field,
            op: f.ops?.[0] ?? "eq",
            value: f.values?.[0] ?? "x",
          })),
        });
        expect(calls.length, `${entity} as ${role} was rejected`).toBeGreaterThan(0);
        const select = calls[0].select;
        for (const column of WITHHELD) {
          expect(select, `${entity} (${role}) leaked ${column}`).not.toContain(column);
        }
      }
    }
  });

  it("rejects an include the registry does not define", async () => {
    // Ignoring it would also have discarded the defaults, so a typo returned a
    // barer row than either the caller or the defaults asked for.
    const { out, calls } = await run("founder", { entity: "sessions", include: ["notes", "*"] });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Unknown include");
    expect(calls).toHaveLength(0);
  });

  it("selects only real tables — no views", () => {
    for (const def of Object.values(ENTITIES)) {
      expect(def.table).not.toBe("coach_client_view");
      expect(def.table).not.toBe("latest_skill_ratings");
    }
  });
});

describe("find — filters", () => {
  it("rejects an unknown field loudly instead of ignoring it", async () => {
    const { out } = await run("founder", {
      entity: "sessions",
      where: [{ field: "venue_naem", op: "ilike", value: "plaza" }],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Unknown field");
    expect(out.error).toContain("venue");
  });

  it("rejects an out-of-vocabulary enum rather than answering zero rows", async () => {
    const { out } = await run("founder", {
      entity: "sessions",
      where: [{ field: "status", op: "eq", value: "cancelled_by_academy" }],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("scheduled");
  });

  it("rejects an operator the field does not allow", async () => {
    const { out } = await run("founder", {
      entity: "sessions",
      where: [{ field: "unassigned", op: "eq", value: "x" }],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("is_null");
  });

  it("requires a value except for the null checks", async () => {
    const missing = await run("founder", {
      entity: "sessions",
      where: [{ field: "status", op: "eq" }],
    });
    expect(missing.out.ok).toBe(false);

    const nullCheck = await run("founder", {
      entity: "sessions",
      where: [{ field: "unassigned", op: "is_null" }],
    });
    expect(nullCheck.out.ok).toBe(true);
    expect(nullCheck.calls[0].ops).toContain('is("coach_id",null)');
  });

  it("applies filters to the mapped column path", async () => {
    const { calls } = await run("founder", {
      entity: "sessions",
      where: [
        { field: "from", op: "gte", value: "2026-08-10T00:00:00Z" },
        { field: "venue", op: "ilike", value: "plaza" },
      ],
    });
    expect(calls[0].ops).toContain('gte("starts_at","2026-08-10T00:00:00Z")');
    expect(calls[0].ops).toContain('ilike("classes.venues.name","%plaza%")');
  });
});

describe("find — select building", () => {
  it("promotes an embed to !inner when a filter needs it, keeping the include's columns", async () => {
    const { calls } = await run("founder", {
      entity: "sessions",
      where: [{ field: "venue", op: "ilike", value: "plaza" }],
    });
    const select = calls[0].select;
    // Without !inner the filter would not drop any parent rows.
    expect(select).toContain("classes!inner(");
    expect(select).toContain("venues!inner(");
    // …and the default include's own columns survive the promotion.
    expect(select).toContain("duration_minutes");
    // The embed appears once, not twice.
    expect(select.match(/classes!?(inner)?\(/g)?.length).toBe(1);
  });

  it("leaves embeds as outer joins when nothing filters on them", async () => {
    const { calls } = await run("founder", { entity: "sessions" });
    expect(calls[0].select).toContain("classes(");
    expect(calls[0].select).not.toContain("!inner");
  });
});

describe("find — counting and grouping", () => {
  it("count_only transfers no rows", async () => {
    const { out, calls } = await run("founder", { entity: "clients", count_only: true }, [], 412);
    expect(calls[0].head).toBe(true);
    expect(out.result).toEqual({ entity: "clients", count: 412 });
  });

  it("count_only keeps the embed its own filter needs", async () => {
    // Counting against a bare "id" while filtering on classes.venues.name is a
    // PGRST108 — "'classes' is not an embedded resource in this request" — so
    // every "how many X at Y" question would fail, which is exactly what the
    // tool description steers the model toward.
    const { calls } = await run("founder", {
      entity: "sessions",
      where: [{ field: "venue", op: "ilike", value: "plaza" }],
      count_only: true,
    });
    expect(calls[0].head).toBe(true);
    expect(calls[0].select).toContain("classes!inner(");
    expect(calls[0].select).toContain("venues!inner(");
  });

  it("refuses an aggregate with no group_by, and an unknown aggregate column", async () => {
    const noGroup = await run("founder", { entity: "credits", aggregate: ["sum:delta_minutes"] });
    expect(noGroup.out.ok).toBe(false);
    expect(noGroup.out.error).toContain("group_by");

    const badCol = await run("founder", {
      entity: "credits",
      group_by: ["reason"],
      aggregate: ["sum:not_a_column"],
    });
    expect(badCol.out.ok).toBe(false);
    expect(badCol.out.error).toContain("Can't aggregate");
  });

  it("brings every embed along when grouping, so a group path is never a null bucket", async () => {
    const { calls } = await run("founder", {
      entity: "sessions",
      group_by: ["classes.title"],
      include: ["coach"],
    });
    // The caller narrowed the include; grouping must still select the class.
    expect(calls[0].select).toContain("classes(");
  });

  it("groups and aggregates, biggest group first", async () => {
    const rows = [
      { status: "attended", id: "1" },
      { status: "attended", id: "2" },
      { status: "no_show", id: "3" },
    ];
    const { out } = await run("founder", { entity: "bookings", group_by: ["status"] }, rows);
    expect(out.result.groups).toEqual([
      { status: "attended", count: 2 },
      { status: "no_show", count: 1 },
    ]);
  });

  it("rejects a group_by the entity does not support", async () => {
    const { out } = await run("founder", { entity: "bookings", group_by: ["coach_note"] });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Can't group by");
  });

  it("caps the row limit", async () => {
    const { calls } = await run("founder", { entity: "sessions", limit: 100000 });
    expect(calls[0].limit).toBe(200);
  });

  it("reports truncation against the limit actually applied", async () => {
    // A nonsense limit clamps to 1; the flag must agree with that, not with the
    // number the caller sent.
    const one = await run("founder", { entity: "sessions", limit: -5 }, [{ id: "a" }]);
    expect(one.calls[0].limit).toBe(1);
    expect(one.out.result.truncated).toBe(true);

    const under = await run("founder", { entity: "sessions" }, [{ id: "a" }]);
    expect(under.out.result.truncated).toBe(false);
  });
});

describe("find — coach names", () => {
  it("falls back to the public roster when profiles is unreadable", async () => {
    const rows = [{ id: "s1", coach_id: "c1", coaches: { profiles: null } }];
    const { rpcCalls } = await run("coach", { entity: "sessions" }, rows);
    expect(rpcCalls).toContain("public_coach_roster");
  });

  it("does not call the roster when the name already came back", async () => {
    const rows = [{ id: "s1", coach_id: "c1", coaches: { profiles: { full_name: "Ravi" } } }];
    const { rpcCalls } = await run("founder", { entity: "sessions" }, rows);
    expect(rpcCalls).toEqual([]);
  });
});
