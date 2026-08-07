import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { deleteCoachCore } from "./admin-ops-coaches";

/**
 * Removing a coach deletes their auth user, and everything hanging off their
 * profile cascades with it. There is no undo, so what is worth pinning down
 * here is not the happy path — it is the refusals, and above all that every
 * refusal happens *before* a single session is handed over. A guard that fires
 * after the handover would leave the roster rearranged around a coach who is
 * still on it.
 *
 * `deleteCoachCore` takes its Supabase client as an argument, so the refusal
 * paths need a stub and nothing else. The success path is deliberately absent:
 * past the guards the function reaches for a real service-role client and a
 * real `auth.admin.deleteUser`, which belongs in tests/db against a live local
 * Supabase, not here.
 */

type TableResult = { count?: number | null; error?: { message: string } | null };

/** Records what was asked of it, so a test can assert the guard ran at all. */
function stubClient(perTable: Record<string, TableResult> = {}) {
  const queried: { table: string; column: string; value: unknown }[] = [];
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              queried.push({ table, column, value });
              const r = perTable[table] ?? {};
              return Promise.resolve({ count: r.count ?? 0, error: r.error ?? null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, queried };
}

const COACH = "11111111-1111-1111-1111-111111111111";
const FOUNDER = "22222222-2222-2222-2222-222222222222";

const KEY = "SUPABASE_SERVICE_ROLE_KEY";
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env[KEY];
  // Shape-checked by hasServiceRoleKey (a real key is a JWT or sb_secret_…),
  // never dialled — every test here returns before the admin client is built.
  process.env[KEY] = "eyJfake.test.key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY];
  else process.env[KEY] = savedKey;
});

describe("deleteCoachCore refusals", () => {
  it("refuses to hand a coach's sessions to themselves", async () => {
    const { client, queried } = stubClient();
    const res = await deleteCoachCore(client, FOUNDER, COACH, COACH);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/different coach/i);
    expect(queried).toHaveLength(0);
  });

  it("refuses without a service-role key, before touching the database", async () => {
    delete process.env[KEY];
    const { client, queried } = stubClient();
    const res = await deleteCoachCore(client, FOUNDER, COACH);

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Coaches can't be removed from this deployment.");
    // The point of the guard: no fallback to the old demote, and no work done.
    expect(queried).toHaveLength(0);
  });

  it("treats a placeholder service-role key as no key at all", async () => {
    process.env[KEY] = "your-service-role-key-here";
    const { client } = stubClient();
    const res = await deleteCoachCore(client, FOUNDER, COACH);

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Coaches can't be removed from this deployment.");
  });

  it("refuses, and names what is there, when the coach is also a family", async () => {
    const { client } = stubClient({
      bookings: { count: 12 },
      players: { count: 1 },
      invoices: { count: 3 },
    });
    const res = await deleteCoachCore(client, FOUNDER, COACH, "33333333-3333-3333-3333-333333333333");

    expect(res.ok).toBe(false);
    // Named, so the founder can go and look rather than guess.
    expect(res.error).toContain("12 bookings");
    expect(res.error).toContain("1 players");
    expect(res.error).toContain("3 invoices");
    expect(res.error).toMatch(/pause them instead/i);
  });

  it("checks every client-side table before deciding", async () => {
    // One non-zero count still lets the loop finish, so this asserts the whole
    // footprint is covered — a table missing here is a table that gets deleted
    // without anyone being asked.
    const { client, queried } = stubClient({ bookings: { count: 1 } });
    await deleteCoachCore(client, FOUNDER, COACH);

    expect(queried.map((q) => q.table)).toEqual([
      "bookings",
      "players",
      "subscriptions",
      "orders",
      "invoices",
      "class_credits",
      "private_credit_ledger",
    ]);
    // Every one of them scoped to the coach, not to the founder or to nobody.
    expect(queried.every((q) => q.value === COACH)).toBe(true);
  });

  it("fails closed when the footprint check itself errors", async () => {
    // An errored count comes back null, which is falsy — the trap this guards.
    const { client } = stubClient({ invoices: { count: null, error: { message: "boom" } } });
    const res = await deleteCoachCore(client, FOUNDER, COACH);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/couldn't check what this account holds/i);
  });
});
