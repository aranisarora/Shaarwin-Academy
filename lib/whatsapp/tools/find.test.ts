import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Profile } from "@/lib/auth";
import { findTool } from "./find";
import { ENTITIES, type FilterDef, type Role } from "./find-registry";
import type { Operator } from "./query-core";
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

describe("find — the questions that had no entity", () => {
  const ROLES: Role[] = ["client", "coach", "founder"];

  /**
   * Written out rather than read off `def.roles`, which would only prove the
   * registry agrees with itself. Each line is a claim about the RLS policies in
   * supabase/schema.sql: a role listed here can actually read the table, and a
   * role missing from it would get an empty list, which reads as "there are
   * none" and is the failure this whole tool exists to stop.
   */
  const READABLE_BY: Record<string, Role[]> = {
    // clients read own, coaches read series on classes they teach, founder all.
    group_series: ["client", "coach", "founder"],
    // clients read own and founder all — there is no coach policy at all.
    private_series: ["client", "founder"],
    audit_log: ["founder"],
  };

  it("reaches each new entity for exactly the roles that can read it", async () => {
    for (const [entity, allowed] of Object.entries(READABLE_BY)) {
      for (const role of ROLES) {
        const { out } = await run(role, { entity });
        expect(out.ok, `${entity} as ${role}`).toBe(allowed.includes(role));
      }
    }
  });

  it("names the series that is still generating sessions", async () => {
    // 2 August: the bot cancelled occurrences, the generator refilled them, and
    // it concluded the client would have to stop it. It had no word for this.
    const group = await run("founder", {
      entity: "group_series",
      where: [{ field: "active", op: "eq", value: true }],
    });
    expect(group.calls[0].table).toBe("booking_series");
    expect(group.calls[0].ops).toContain('eq("active",true)');

    const priv = await run("founder", {
      entity: "private_series",
      where: [{ field: "active", op: "eq", value: true }],
    });
    expect(priv.calls[0].table).toBe("private_booking_series");
    expect(priv.calls[0].ops).toContain('eq("active",true)');
  });

  it("gives the audit trail a person rather than an actor_id", async () => {
    const { calls } = await run("founder", {
      entity: "audit_log",
      where: [{ field: "entity_id", value: "sess-1" }],
    });
    expect(calls[0].table).toBe("audit_log");
    expect(calls[0].select).toContain("profiles(id,full_name");
    expect(calls[0].ops).toContain('eq("entity_id","sess-1")');
  });

  it("answers which coaches are on WhatsApp, which used to be a refusal", async () => {
    // This used to read a wa_links entity. The link table is gone: the number
    // on the profile IS the WhatsApp binding, for inbound identity and outbound
    // delivery alike, so the question is now a has_phone filter over profiles.
    // The capability has to survive the table it was built on.
    const { calls } = await run("founder", {
      entity: "clients",
      where: [
        { field: "role", value: "coach" },
        { field: "has_phone", op: "not_null" },
      ],
    });
    expect(calls[0].table).toBe("profiles");
    expect(calls[0].ops).toContain('eq("role","coach")');
    expect(calls[0].ops).toContain('not("phone","is",null)');
  });

  it("names the coaches it CANNOT reach on WhatsApp", async () => {
    // The inverse is the one the founder actually needs — the silent failure
    // was people with no number being served email while every report read
    // green. Answering it must not require a table join any more.
    const { calls } = await run("founder", {
      entity: "clients",
      where: [
        { field: "role", value: "coach" },
        { field: "has_phone", op: "is_null" },
      ],
    });
    expect(calls[0].table).toBe("profiles");
    expect(calls[0].ops).toContain('is("phone",null)');
  });

  it("reads a number the way the founder says it", async () => {
    const { calls } = await run("founder", {
      entity: "clients",
      where: [{ field: "phone", value: "07708688495" }],
    });
    expect(calls[0].ops).toContain('eq("phone","+917708688495")');
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
  // The same address as structured components — it doubles a row to repeat
  // what the flat columns already say, so nothing carries it.
  "address_details",
  "disputed",
];

/**
 * The address block, banned everywhere EXCEPT the one entity that exists to
 * carry it. A coach has to drive to a private class, and the coach app already
 * shows them the address; `private_class_details` RLS is `client_id =
 * auth.uid() OR is_founder() OR coach_teaches_class(class_id)`, so there the
 * policy is the gate and it scopes per row. A series definition has no such
 * reason, which is why the list still applies to everything else.
 */
const ADDRESS_BLOCK = ["access_notes", "venue_label", "unit_label"];
const CARRIES_ADDRESS = "private_locations";

/**
 * A value the filter will accept. "x" is fine until the field canonicalizes its
 * input — a normalizer rejects nonsense loudly, which is the point of it, and
 * would abort a sweep that is really about the SELECT.
 */
/** An op the filter actually allows — several now refuse the `eq` default. */
function sampleOp(f: FilterDef): Operator {
  return (f.ops?.[0] ?? "eq") as Operator;
}

function sampleValue(f: FilterDef): unknown {
  if (f.values) return f.values[0];
  if (!f.normalize) return "x";
  const normalize = f.normalize;
  // The op picks which edge a date normalizer takes, and it refuses eq — so
  // ask with the filter's own first allowed op, not a hardcoded one.
  const op = sampleOp(f);
  return ["+91 77086 88495", "2026-06-01", "1500"].find((v) => normalize(v, op) != null) ?? "x";
}

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
            value: sampleValue(f),
          })),
        });
        expect(calls.length, `${entity} as ${role} was rejected`).toBeGreaterThan(0);
        const select = calls[0].select;
        const banned =
          entity === CARRIES_ADDRESS ? WITHHELD : [...WITHHELD, ...ADDRESS_BLOCK];
        for (const column of banned) {
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

  it("never selects the home a private series is taught at", async () => {
    // address / postcode / lat / lng can't go in WITHHELD above: the venues
    // entity exposes all four, and an academy venue is a public fact. On a
    // private series they are a child's front door, so this one is checked
    // against that entity's own worst-case select.
    const def = ENTITIES.private_series;
    const { calls } = await run("founder", {
      entity: "private_series",
      include: Object.keys(def.includes),
    });
    for (const column of ["address", "postcode", "lat", "lng"]) {
      expect(calls[0].select, `private_series leaked ${column}`).not.toContain(column);
    }
  });

  it("selects only real tables — no views", () => {
    for (const def of Object.values(ENTITIES)) {
      expect(def.table).not.toBe("coach_client_view");
      expect(def.table).not.toBe("latest_skill_ratings");
    }
  });

  it("leaves the chat transcript unregistered", async () => {
    // The transcript stays unreadable by the LLM. That is a design line rather
    // than an omission someone can tidy up.
    for (const def of Object.values(ENTITIES)) {
      expect(def.table).not.toBe("wa_messages");
      expect(def.table).not.toBe("wa_inbound_seen");
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

describe("find — normalizing the value before it queries", () => {
  it("finds the one client however the number was written", async () => {
    // The write paths and the identity handshake all store E.164; nothing ran on
    // the read side, so each of these spellings queried itself and found nobody.
    for (const value of [
      "+91 77086 88495",
      "+91-77086-88495",
      "07708688495",
      "7708688495",
      "+917708688495",
    ]) {
      const { calls } = await run("founder", {
        entity: "clients",
        where: [{ field: "phone", value }],
      });
      expect(calls[0].ops, value).toContain('eq("phone","+917708688495")');
    }
  });

  it("normalizes every member of an in list", async () => {
    const { calls } = await run("founder", {
      entity: "clients",
      where: [{ field: "phone", op: "in", value: ["07708688495", "+91 98123 45678"] }],
    });
    expect(calls[0].ops).toContain('in("phone",["+917708688495","+919812345678"])');
  });

  it("refuses a phone it can't read instead of querying the string it was handed", async () => {
    const { out, calls } = await run("founder", {
      entity: "clients",
      where: [{ field: "phone", value: "88495" }],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("phone");
    expect(out.error).toContain("country code");
    expect(calls).toHaveLength(0);
  });

  it("still lets a pattern hunt for part of a number", async () => {
    const { calls } = await run("founder", {
      entity: "clients",
      where: [{ field: "phone", op: "ilike", value: "88495" }],
    });
    expect(calls[0].ops).toContain('ilike("phone","%88495%")');
  });

  it("reads a money filter as rupees, not as the unit the column stores", async () => {
    // "plans under 5000" used to mean plans under ₹50 — of which there are none.
    const { calls } = await run("founder", {
      entity: "plans",
      where: [{ field: "price_inr", op: "lt", value: 5000 }],
    });
    expect(calls[0].ops).toContain('lt("price_pence",500000)');
  });

  it("anchors a bare day and a bare month to the academy's clock", async () => {
    const day = await run("founder", {
      entity: "sessions",
      where: [{ field: "from", op: "gte", value: "2026-06-14" }],
    });
    // 00:00 IST on 14 June, not 05:30 IST as UTC midnight would have been.
    expect(day.calls[0].ops).toContain('gte("starts_at","2026-06-13T18:30:00.000Z")');

    const month = await run("founder", {
      entity: "orders",
      where: [
        { field: "from", op: "gte", value: "2026-06" },
        { field: "to", op: "lte", value: "2026-06" },
      ],
    });
    expect(month.calls[0].ops).toContain('gte("created_at","2026-05-31T18:30:00.000Z")');
    // …and the upper bound covers the whole of 30 June rather than its midnight.
    expect(month.calls[0].ops).toContain('lte("created_at","2026-06-30T18:29:59.999Z")');
  });

  it("leaves an instant that already carries an offset exactly as given", async () => {
    const { calls } = await run("founder", {
      entity: "sessions",
      where: [{ field: "from", op: "gte", value: "2026-08-10T04:30:00+05:30" }],
    });
    expect(calls[0].ops).toContain('gte("starts_at","2026-08-10T04:30:00+05:30")');
  });

  it("refuses a date it can't read", async () => {
    const { out, calls } = await run("founder", {
      entity: "sessions",
      where: [{ field: "from", op: "gte", value: "next Tuesday" }],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("2026-06");
    expect(calls).toHaveLength(0);
  });

  it("matches loose text loosely when no op was given, and obeys one that was", async () => {
    const implied = await run("founder", {
      entity: "sessions",
      where: [{ field: "venue", value: "plaza" }],
    });
    expect(implied.calls[0].ops).toContain('ilike("classes.venues.name","%plaza%")');

    const explicit = await run("founder", {
      entity: "plans",
      where: [{ field: "name", op: "eq", value: "Group — 1x/week" }],
    });
    expect(explicit.calls[0].ops).toContain('eq("name","Group — 1x/week")');
  });
});

describe("find — money on the way out", () => {
  const plan = () => [{ id: "p1", name: "Group — 1x/week", price_pence: 159900 }];
  const invoices = () => [
    { status: "paid", amount_pence: 159900 },
    { status: "paid", amount_pence: 40100 },
  ];

  it("hands back rupees under a name that says so", async () => {
    const { out } = await run("founder", { entity: "plans" }, plan());
    expect(out.result.rows[0]).toEqual({ id: "p1", name: "Group — 1x/week", price_inr: 1599 });
  });

  it("converts money inside an embed too", async () => {
    const rows = [{ id: "s1", plans: { name: "Group", price_pence: 159900 } }];
    const { out } = await run("founder", { entity: "subscriptions" }, rows);
    expect(out.result.rows[0].plans).toEqual({ name: "Group", price_inr: 1599 });
  });

  it("aggregates in rupees, whichever name the model used for the column", async () => {
    // sum:amount_pence answered 200000, and "₹200,000" is what got said out loud.
    const minor = await run(
      "founder",
      { entity: "invoices", group_by: ["status"], aggregate: ["sum:amount_pence"] },
      invoices()
    );
    expect(minor.out.result.groups[0]).toMatchObject({ status: "paid", sum_amount_inr: 2000 });

    const rupees = await run(
      "founder",
      { entity: "invoices", group_by: ["status"], aggregate: ["sum:amount_inr"] },
      invoices()
    );
    expect(rupees.out.result.groups[0]).toMatchObject({ sum_amount_inr: 2000 });
  });
});

describe("find — values that used to slip through", () => {
  // The dangerous one. `not_in` with an empty list excludes nothing, so the
  // query returns every row as though the filter applied — and these ids feed
  // the _ids bulk tools, which is how "cancel the ones I didn't list" becomes
  // cancelling all of them.
  it.each([
    ["not_in", []],
    ["in", []],
    ["not_in", ""],
    ["in", ","],
  ])("refuses %s with an empty list rather than matching everything", async (op, value) => {
    const { out } = await run("founder", {
      entity: "sessions",
      where: [{ field: "id", op, value }],
    });
    expect(out.ok).toBe(false);
    expect(String(out.error)).toContain("at least one value");
  });

  it("reads a comma-formatted amount as one price, not two", async () => {
    const { out } = await run("founder", {
      entity: "plans",
      where: [{ field: "price_inr", op: "in", value: "1,599" }],
    });
    expect(out.ok).toBe(true);
    expect(out.result.no_match_for?.[0]).toMatchObject({ value: ["1,599"] });
  });

  it("refuses a month that isn't one instead of answering for another year", async () => {
    for (const month of ["2026-13", "2026-00"]) {
      const { out } = await run("founder", {
        entity: "clients",
        where: [{ field: "created_at", op: "gte", value: month }],
      });
      expect(out.ok).toBe(false);
    }
  });

  // The edge follows the op: "before the 15th" must stop where the 15th
  // starts, not where it ends, or a whole extra day comes back.
  it("gives lt the start of the day and lte the end of it", async () => {
    const lt = await run("founder", {
      entity: "sessions",
      where: [{ field: "to", op: "lt", value: "2026-06-15" }],
    });
    const lte = await run("founder", {
      entity: "sessions",
      where: [{ field: "to", op: "lte", value: "2026-06-15" }],
    });
    // IST is +05:30, so the 15th begins at 18:30Z on the 14th and ends at
    // 18:29:59.999Z on the 15th.
    expect(lt.calls[0].ops.join("|")).toContain("2026-06-14T18:30:00.000Z");
    expect(lte.calls[0].ops.join("|")).toContain("2026-06-15T18:29:59.999Z");
  });
});

describe("find — zero rows", () => {
  it("says what it looked for rather than implying the thing doesn't exist", async () => {
    const { out } = await run("founder", {
      entity: "clients",
      where: [{ field: "phone", value: "07708688495" }],
    });
    expect(out.result.count).toBe(0);
    // What was ASKED, not what the query ran on. Echoing the normalized value
    // reads fine for a phone but lies about money: a miss on price_inr 5000
    // came back as 500000 under a name that says rupees, which is the same
    // 100x wrong number the conversion exists to prevent, moved onto the miss
    // path. One rule for every field, and it is the caller's own units.
    expect(out.result.no_match_for).toEqual([{ field: "phone", op: "eq", value: "07708688495" }]);
  });

  it("echoes a money miss in rupees, never in paise", async () => {
    const { out } = await run("founder", {
      entity: "plans",
      where: [{ field: "price_inr", op: "lte", value: 5000 }],
    });
    expect(out.result.no_match_for).toEqual([{ field: "price_inr", op: "lte", value: 5000 }]);
  });

  it("keeps quiet when nothing was filtered — an empty table is just empty", async () => {
    const { out } = await run("founder", { entity: "clients" });
    expect(out.result.no_match_for).toBeUndefined();
  });

  it("says it for a count of zero and for an empty grouping too", async () => {
    const counted = await run(
      "founder",
      { entity: "sessions", where: [{ field: "title", value: "yoga" }], count_only: true },
      [],
      0
    );
    expect(counted.out.result.no_match_for).toEqual([
      { field: "title", op: "ilike", value: "yoga" },
    ]);

    const grouped = await run("founder", {
      entity: "sessions",
      where: [{ field: "title", value: "yoga" }],
      group_by: ["status"],
    });
    expect(grouped.out.result.no_match_for).toHaveLength(1);
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
