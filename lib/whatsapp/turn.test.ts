import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  hasUnread,
  isReadOnlyTool,
  joinFragments,
  markHandled,
  pendingFor,
  runCoalescedTurn,
  type Pending,
  type TurnVerdict,
} from "./turn";

/**
 * A stand-in for the queue in Postgres. Fragments live in an array; the stub
 * answers pendingFor/markHandled against it and lets a test push new arrivals
 * mid-turn, which is the whole scenario under test.
 */
function stubQueue(initial: Pending[] = []) {
  const rows = initial.map((r) => ({ ...r, handled_at: null as string | null }));
  const locks = new Map<string, string>();
  const released: string[] = [];

  const client = {
    from(table: string) {
      if (table !== "wa_inbound_seen") throw new Error(`unexpected table ${table}`);
      let updating: { handled_at: string } | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        update(values: { handled_at: string }) {
          updating = values;
          return builder;
        },
        in(_col: string, sids: string[]) {
          for (const row of rows) {
            if (sids.includes(row.message_sid) && updating) row.handled_at = updating.handled_at;
          }
          return Promise.resolve({ error: null });
        },
        then(resolve: (v: unknown) => unknown) {
          const pending = rows.filter((r) => r.handled_at === null);
          return Promise.resolve({ data: pending, error: null }).then(resolve);
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const phone = String(args.p_phone);
      if (name === "wa_claim_chat") {
        if (locks.has(phone)) return { data: false, error: null };
        locks.set(phone, String(args.p_run));
        return { data: true, error: null };
      }
      if (name === "wa_release_chat") {
        released.push(phone);
        locks.delete(phone);
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };

  const arrive = (sid: string, body: string) =>
    rows.push({ message_sid: sid, body, created_at: new Date().toISOString(), handled_at: null });

  return { admin: client as unknown as SupabaseClient<Database>, rows, arrive, locks, released };
}

const frag = (sid: string, body: string): Pending => ({
  message_sid: sid,
  body,
  created_at: new Date().toISOString(),
});

describe("isReadOnlyTool", () => {
  it("knows the readers", () => {
    for (const name of [
      "find",
      "resolve",
      "get_academy_info",
      "list_clients",
      "my_coach_sessions",
      "browse_group_sessions",
      "academy_overview",
      "membership_status",
    ]) {
      expect(isReadOnlyTool(name), name).toBe(true);
    }
  });

  it("treats every writer as a writer", () => {
    for (const name of [
      "cancel_session",
      "book_group_session",
      "move_session",
      "notify_clients",
      "update_class",
      "grant_comp_membership",
    ]) {
      expect(isReadOnlyTool(name), name).toBe(false);
    }
  });

  /**
   * The direction that matters. A tool nobody has classified must be treated as
   * dangerous: mistaking a write for a read cancels a session that was just
   * retracted, and mistaking a read for a write costs one indexed query.
   */
  it("defaults an unknown tool to write", () => {
    expect(isReadOnlyTool("frobnicate_the_thing")).toBe(false);
    expect(isReadOnlyTool("")).toBe(false);
  });
});

describe("joinFragments", () => {
  it("joins a burst into one utterance", () => {
    expect(
      joinFragments([frag("a", "cancel tomorrow"), frag("b", "actually just move it"), frag("c", "to 5pm")])
    ).toBe("cancel tomorrow\nactually just move it\nto 5pm");
  });

  it("drops the empties rather than emitting blank lines", () => {
    expect(joinFragments([frag("a", "hi"), frag("b", "   ")])).toBe("hi");
  });
});

describe("the queue", () => {
  it("reads only what is still unanswered", async () => {
    const { admin, rows } = stubQueue([frag("a", "one"), frag("b", "two")]);
    rows[0].handled_at = new Date().toISOString();
    const pending = await pendingFor(admin, "+9198");
    expect(pending.map((p) => p.message_sid)).toEqual(["b"]);
  });

  it("marks a set answered", async () => {
    const { admin, rows } = stubQueue([frag("a", "one"), frag("b", "two")]);
    await markHandled(admin, ["a"]);
    expect(rows[0].handled_at).not.toBeNull();
    expect(rows[1].handled_at).toBeNull();
  });

  it("spots input the run has not read", async () => {
    const { admin, arrive } = stubQueue([frag("a", "one")]);
    const known = new Set(["a"]);
    expect(await hasUnread(admin, "+9198", known)).toBe(false);
    arrive("b", "wait, no");
    expect(await hasUnread(admin, "+9198", known)).toBe(true);
  });
});

describe("runCoalescedTurn", () => {
  const opts = (admin: SupabaseClient<Database>, handle: Parameters<typeof runCoalescedTurn>[0]["handle"]) => ({
    admin,
    phone: "+919812345678",
    runId: "11112222-3333-4444-8555-666677778888",
    immediate: true,
    handle,
  });

  it("answers a whole burst once, not each fragment", async () => {
    const { admin } = stubQueue([
      frag("a", "cancel tomorrow"),
      frag("b", "actually just move it"),
      frag("c", "to 5pm"),
    ]);
    const seen: string[] = [];
    await runCoalescedTurn(
      opts(admin, async ({ text }) => {
        seen.push(text);
        return "answered" as TurnVerdict;
      })
    );
    expect(seen).toEqual(["cancel tomorrow\nactually just move it\nto 5pm"]);
  });

  it("marks the burst answered so it is never replayed", async () => {
    const { admin, rows } = stubQueue([frag("a", "one"), frag("b", "two")]);
    await runCoalescedTurn(opts(admin, async () => "answered"));
    expect(rows.every((r) => r.handled_at !== null)).toBe(true);
  });

  it("stands down when another run holds the chat", async () => {
    const { admin, locks } = stubQueue([frag("a", "hello")]);
    locks.set("+919812345678", "someone-else");
    const handle = vi.fn(async () => "answered" as TurnVerdict);
    await runCoalescedTurn(opts(admin, handle));
    expect(handle).not.toHaveBeenCalled();
  });

  it("releases the lock even when the handler throws", async () => {
    const { admin, locks } = stubQueue([frag("a", "hello")]);
    await expect(
      runCoalescedTurn(
        opts(admin, async () => {
          throw new Error("gemini exploded");
        })
      )
    ).rejects.toThrow("gemini exploded");
    expect(locks.has("+919812345678")).toBe(false);
  });

  /**
   * The correction case, end to end. "cancel tomorrow" must NOT be marked
   * answered when the run stands down — otherwise the next pass sees only
   * "actually just move it to 5pm" and has lost what is being moved.
   */
  it("keeps a superseded burst queued and re-reads it with the correction", async () => {
    const { admin, arrive } = stubQueue([frag("a", "cancel tomorrow")]);
    const seen: string[] = [];
    let pass = 0;

    await runCoalescedTurn(
      opts(admin, async ({ text }) => {
        seen.push(text);
        if (pass++ === 0) {
          // What the agent does when stillCurrent() goes false mid-turn.
          arrive("b", "actually just move it to 5pm");
          return "superseded";
        }
        return "answered";
      })
    );

    expect(seen).toEqual([
      "cancel tomorrow",
      "cancel tomorrow\nactually just move it to 5pm",
    ]);
  });

  it("goes round again when input lands after an answer", async () => {
    const { admin, arrive } = stubQueue([frag("a", "what's on tomorrow")]);
    const seen: string[] = [];
    let pass = 0;
    await runCoalescedTurn(
      opts(admin, async ({ text }) => {
        seen.push(text);
        if (pass++ === 0) arrive("b", "and on Saturday?");
        return "answered";
      })
    );
    expect(seen).toEqual(["what's on tomorrow", "and on Saturday?"]);
  });

  /**
   * A fast typist must not be able to starve themselves of a reply. The final
   * pass is handed a null stillCurrent, which is the signal to answer rather
   * than keep yielding.
   */
  it("stops yielding on the last pass and answers", async () => {
    const { admin, arrive } = stubQueue([frag("a", "one")]);
    const yieldable: boolean[] = [];
    let n = 0;
    await runCoalescedTurn(
      opts(admin, async (_input, stillCurrent) => {
        yieldable.push(stillCurrent !== null);
        if (n++ < 5) {
          arrive(`x${n}`, `more ${n}`);
          return "superseded";
        }
        return "answered";
      })
    );
    expect(yieldable).toEqual([true, true, false]);
  });

  it("does nothing when the queue is already empty", async () => {
    const { admin } = stubQueue([]);
    const handle = vi.fn(async () => "answered" as TurnVerdict);
    await runCoalescedTurn(opts(admin, handle));
    expect(handle).not.toHaveBeenCalled();
  });
});
