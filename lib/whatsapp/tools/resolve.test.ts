import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Profile } from "@/lib/auth";
import { rankOf, resolveTool, tokenize } from "./resolve";
import type { Role } from "./find-registry";
import type { ToolContext } from "./types";

type Call = { table: string; ops: string[] };

/**
 * Rows keyed by table, so one stub can answer for players, profiles, classes
 * and venues in the single fan-out the resolver performs.
 */
function stubClient(byTable: Record<string, unknown[]>, roster: unknown[] = []) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => builder,
        limit: () => builder,
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve({ data: byTable[table] ?? [], error: null }).then(resolve);
        },
      };
      for (const op of ["eq", "ilike", "is", "not", "in"]) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push(`${op}(${args.map((a) => JSON.stringify(a)).join(",")})`);
          return builder;
        };
      }
      return builder;
    },
    async rpc(name: string) {
      calls.push({ table: `rpc:${name}`, ops: [] });
      return { data: roster, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

async function run(
  role: Role,
  input: Record<string, unknown>,
  byTable: Record<string, unknown[]> = {},
  roster: unknown[] = []
) {
  const { client, calls } = stubClient(byTable, roster);
  const ctx: ToolContext = {
    phone: "+919812345678",
    profile: { id: "user-1", role } as Profile,
    supabase: client,
    admin: client,
  };
  // Tools answer through ok(), which wraps the payload in {ok, result} — assert
  // against the same shape the agent loop actually receives.
  const envelope = JSON.parse(await resolveTool(role).run(input, ctx));
  return { out: { ok: envelope.ok, error: envelope.error, ...(envelope.result ?? {}) }, envelope, calls };
}

const AARAV_PLAYER = {
  id: "3f2a1b4c-5d6e-4f70-8123-456789abcdef",
  full_name: "Aarav Sharma",
  skill_level: "beginner",
  grade: null,
  profiles: { full_name: "Meera Sharma" },
};

describe("tokenize", () => {
  it("splits a name into words so either half finds the row", () => {
    expect(tokenize("Abhay Gupta")).toEqual(["Abhay", "Gupta"]);
    expect(tokenize("  abhay  ")).toEqual(["abhay"]);
  });

  it("drops punctuation rather than searching for it literally", () => {
    expect(tokenize("O'Brien-Smith")).toEqual(["O", "Brien", "Smith"]);
  });

  it("is empty for a name made only of punctuation, so nothing is queried", () => {
    expect(tokenize("???")).toEqual([]);
  });
});

describe("rankOf", () => {
  it("puts an exact match above a longer namesake", () => {
    expect(rankOf("Sam", "Sam")).toBeGreaterThan(rankOf("Samir Khan", "Sam"));
  });

  it("ranks a whole-word match above a mid-word one", () => {
    expect(rankOf("Abhay Gupta", "Gupta")).toBeGreaterThan(rankOf("Guptara Rao", "Gupta"));
  });
});

describe("resolve — one lookup, every kind", () => {
  /**
   * The 11 August failure, in one test. "Aarav" is a player; the bot searched
   * clients, found none, and reported that as fact. The resolver must return
   * the player without anyone having chosen a table first.
   */
  it("finds a player when the name was assumed to be a client", async () => {
    const { out } = await run("founder", { name: "Aarav" }, { players: [AARAV_PLAYER] });
    expect(out.ok).toBe(true);
    expect(out.count).toBe(1);
    expect(out.candidates[0]).toMatchObject({ kind: "player", label: "Aarav Sharma" });
    // The context that lets the bot say which Aarav it means.
    expect(out.candidates[0].detail).toContain("Meera Sharma");
  });

  it("searches every kind the role can see, in one call", async () => {
    const { calls } = await run("founder", { name: "Aarav" });
    const tables = calls.map((c) => c.table);
    expect(tables).toContain("players");
    expect(tables).toContain("profiles");
    expect(tables).toContain("classes");
    expect(tables).toContain("venues");
    expect(tables).toContain("rpc:public_coach_roster");
  });

  it("ANDs one pattern per word, so a partial name in any order still lands", async () => {
    const { calls } = await run("founder", { name: "gupta abhay" }, { players: [] });
    const players = calls.find((c) => c.table === "players");
    expect(players?.ops).toContain('ilike("full_name","%gupta%")');
    expect(players?.ops).toContain('ilike("full_name","%abhay%")');
  });

  it("flags more than one match as ambiguous rather than picking", async () => {
    const { out } = await run(
      "founder",
      { name: "Aarav" },
      {
        players: [
          AARAV_PLAYER,
          { ...AARAV_PLAYER, id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", full_name: "Aarav Menon" },
        ],
      }
    );
    expect(out.count).toBe(2);
    expect(out.ambiguous).toBe(true);
  });

  it("does not call a lookup the role has no business making", async () => {
    // A client resolves their own household and the catalogue — not the
    // academy's whole address book.
    const { calls } = await run("client", { name: "Meera" });
    expect(calls.map((c) => c.table)).not.toContain("profiles");
    expect(calls.map((c) => c.table)).not.toContain("venues");
  });

  /**
   * The whole point of the tool: a miss must say where it looked, or the model
   * fills that gap itself — and it fills it with a table it never queried.
   */
  it("reports a miss as a search that came back empty, naming what was searched", async () => {
    const { out } = await run("founder", { name: "Zephyr" });
    expect(out.ok).toBe(true);
    expect(out.count).toBe(0);
    expect(out.searched_kinds).toEqual(expect.arrayContaining(["player", "client", "coach"]));
    expect(out.no_match).toContain("not evidence it doesn't exist");
  });

  it("refuses an empty name instead of listing the whole academy", async () => {
    const { out, calls } = await run("founder", { name: "   " });
    expect(out.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  /**
   * One unreadable table must cost that kind, not the answer. RLS makes this a
   * live case: a coach's `profiles` read returns an error, and the player they
   * asked about is still on their roster.
   */
  it("still answers when one of the lookups fails", async () => {
    const { client } = (() => {
      const inner = stubClient({ players: [AARAV_PLAYER] });
      const original = inner.client.from.bind(inner.client);
      inner.client.from = ((table: string) => {
        if (table === "classes") throw new Error("permission denied");
        return original(table);
      }) as typeof inner.client.from;
      return inner;
    })();

    const ctx: ToolContext = {
      phone: "+919812345678",
      profile: { id: "user-1", role: "founder" } as Profile,
      supabase: client,
      admin: client,
    };
    const envelope = JSON.parse(await resolveTool("founder").run({ name: "Aarav" }, ctx));
    expect(envelope.ok).toBe(true);
    expect(envelope.result.count).toBe(1);
  });

  it("filters coaches by name in memory, since the roster RPC takes no argument", async () => {
    const { out } = await run(
      "coach",
      { name: "Augustine" },
      {},
      [
        { id: "aaaa1111-2222-4333-8444-555566667777", full_name: "Augustine Rao" },
        { id: "bbbb1111-2222-4333-8444-555566667777", full_name: "Priya Nair" },
      ]
    );
    expect(out.count).toBe(1);
    expect(out.candidates[0]).toMatchObject({ kind: "coach", label: "Augustine Rao" });
  });
});

describe("resolve — what the model is told", () => {
  it("tells it that reporting a failed guess is banned", () => {
    const description = resolveTool("founder").description;
    expect(description).toContain("NEVER answer a question with the failure of a guess");
    expect(description).toContain("I can't find a client named Aarav");
  });

  it("advertises only the kinds the role can search", () => {
    expect(resolveTool("client").description).not.toContain("venue");
    expect(resolveTool("founder").description).toContain("venue");
  });
});
