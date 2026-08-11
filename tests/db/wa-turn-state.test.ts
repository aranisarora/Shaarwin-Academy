// The two pieces of state the bot's brain upgrade rests on, against real
// Postgres: the per-chat run lock (0086) and the working memory (0085).
//
// Both exist because of failures that only appear under concurrency or across
// turns, which is exactly where a mock proves nothing:
//
//   * The lock is INSERT .. ON CONFLICT DO UPDATE .. WHERE, chosen because it
//     resolves the race inside the engine. A read-then-write in application
//     code would let two webhooks arriving in the same millisecond both believe
//     they had won — and that is the whole bug. Only a real database can show
//     that the second caller is refused.
//
//   * The memory is what survives lintReply stripping every uuid out of the
//     visible transcript. Its primary key is what makes re-mentioning an entity
//     an update rather than a duplicate row.

import { describe, it, expect } from "vitest";
import { admin } from "../../e2e/lib/supabase";

const phoneFor = () => `+9199${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
const RUN_A = "aaaaaaaa-1111-4222-8333-444455556666";
const RUN_B = "bbbbbbbb-1111-4222-8333-444455556666";

describe("wa_claim_chat / wa_release_chat (migration 0086)", () => {
  it("gives the chat to exactly one caller", async () => {
    const db = admin();
    const phone = phoneFor();

    const first = await db.rpc("wa_claim_chat", { p_phone: phone, p_run: RUN_A });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);

    // The second webhook of a burst. Its message is already queued; it must be
    // told to stand down rather than start a parallel run on the same thread.
    const second = await db.rpc("wa_claim_chat", { p_phone: phone, p_run: RUN_B });
    expect(second.error).toBeNull();
    expect(second.data).toBe(false);

    await db.rpc("wa_release_chat", { p_phone: phone, p_run: RUN_A });
  });

  /**
   * The race the single statement exists to win. Fired together rather than in
   * sequence, because a read-then-write implementation passes the test above
   * and fails this one.
   */
  it("still gives it to exactly one when the claims are simultaneous", async () => {
    const db = admin();
    const phone = phoneFor();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        db.rpc("wa_claim_chat", {
          p_phone: phone,
          p_run: `cccccccc-1111-4222-8333-44445555${String(i).padStart(4, "0")}`,
        })
      )
    );
    for (const r of results) expect(r.error).toBeNull();
    expect(results.filter((r) => r.data === true)).toHaveLength(1);

    await db.rpc("wa_release_chat", { p_phone: phone });
  });

  it("frees the chat on release, so the next message doesn't wait out the TTL", async () => {
    const db = admin();
    const phone = phoneFor();

    await db.rpc("wa_claim_chat", { p_phone: phone, p_run: RUN_A });
    await db.rpc("wa_release_chat", { p_phone: phone, p_run: RUN_A });

    const again = await db.rpc("wa_claim_chat", { p_phone: phone, p_run: RUN_B });
    expect(again.data).toBe(true);
    await db.rpc("wa_release_chat", { p_phone: phone, p_run: RUN_B });
  });

  /**
   * A serverless run can die holding the lock. If the lease could not be taken
   * over, that chat would be silent forever — the one outcome worse than a
   * double reply.
   */
  it("lets a later run take over an expired lease", async () => {
    const db = admin();
    const phone = phoneFor();

    // A lease that expired the moment it was taken.
    const held = await db.rpc("wa_claim_chat", {
      p_phone: phone,
      p_run: RUN_A,
      p_ttl_seconds: -1,
    });
    expect(held.data).toBe(true);

    const stolen = await db.rpc("wa_claim_chat", { p_phone: phone, p_run: RUN_B });
    expect(stolen.data).toBe(true);

    await db.rpc("wa_release_chat", { p_phone: phone, p_run: RUN_B });
  });

  /**
   * A run whose lease expired and was taken over must not release the NEW
   * holder's lock as it unwinds — that would hand the chat to a third run while
   * the second is still mid-answer.
   */
  it("will not let a stale run release the lock it no longer holds", async () => {
    const db = admin();
    const phone = phoneFor();

    await db.rpc("wa_claim_chat", { p_phone: phone, p_run: RUN_A, p_ttl_seconds: -1 });
    await db.rpc("wa_claim_chat", { p_phone: phone, p_run: RUN_B });

    // RUN_A, finishing late, tries to clean up after itself.
    await db.rpc("wa_release_chat", { p_phone: phone, p_run: RUN_A });

    // RUN_B must still hold it.
    const third = await db.rpc("wa_claim_chat", { p_phone: phone, p_run: RUN_A });
    expect(third.data).toBe(false);

    await db.rpc("wa_release_chat", { p_phone: phone, p_run: RUN_B });
  });
});

describe("wa_inbound_seen as the burst queue (migration 0086)", () => {
  it("claims a sid exactly once and carries the text with it", async () => {
    const db = admin();
    const phone = phoneFor();
    const sid = `SM${Math.random().toString(36).slice(2, 12)}`;

    const first = await db
      .from("wa_inbound_seen")
      .insert({ message_sid: sid, phone, body: "cancel tomorrow" });
    expect(first.error).toBeNull();

    // Twilio retrying the same message must lose.
    const retry = await db
      .from("wa_inbound_seen")
      .insert({ message_sid: sid, phone, body: "cancel tomorrow" });
    expect(retry.error?.code).toBe("23505");

    const { data } = await db
      .from("wa_inbound_seen")
      .select("body,handled_at")
      .eq("message_sid", sid)
      .single();
    expect(data?.body).toBe("cancel tomorrow");
    // Claimed on arrival is NOT answered — that distinction is the queue.
    expect(data?.handled_at).toBeNull();
  });

  it("reads a chat's unanswered fragments oldest first, and stops after they're handled", async () => {
    const db = admin();
    const phone = phoneFor();
    const sids = ["a", "b", "c"].map((s) => `SM${s}${Math.random().toString(36).slice(2, 10)}`);

    for (const [i, sid] of sids.entries()) {
      await db.from("wa_inbound_seen").insert({
        message_sid: sid,
        phone,
        body: ["cancel tomorrow", "actually just move it", "to 5pm"][i],
        created_at: new Date(Date.now() + i * 1000).toISOString(),
      });
    }

    const pending = await db
      .from("wa_inbound_seen")
      .select("body")
      .eq("phone", phone)
      .is("handled_at", null)
      .order("created_at", { ascending: true });
    expect(pending.data?.map((r) => r.body)).toEqual([
      "cancel tomorrow",
      "actually just move it",
      "to 5pm",
    ]);

    await db
      .from("wa_inbound_seen")
      .update({ handled_at: new Date().toISOString() })
      .in("message_sid", sids);

    const after = await db
      .from("wa_inbound_seen")
      .select("message_sid")
      .eq("phone", phone)
      .is("handled_at", null);
    expect(after.data).toHaveLength(0);
  });
});

describe("wa_entity_memory (migration 0085)", () => {
  it("remembers an entity once, however often it is mentioned", async () => {
    const db = admin();
    const phone = phoneFor();
    const player = "3f2a1b4c-5d6e-4f70-8123-456789abcdef";

    await db.from("wa_entity_memory").upsert(
      { phone, kind: "player", entity_id: player, label: "Aarav Sharma", detail: "Meera's child" },
      { onConflict: "phone,kind,entity_id" }
    );
    // Mentioned again a turn later, with a better description.
    await db.from("wa_entity_memory").upsert(
      {
        phone,
        kind: "player",
        entity_id: player,
        label: "Aarav Sharma",
        detail: "Beginners, Saturdays",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "phone,kind,entity_id" }
    );

    const { data } = await db
      .from("wa_entity_memory")
      .select("label,detail")
      .eq("phone", phone)
      .eq("entity_id", player);
    expect(data).toHaveLength(1);
    expect(data![0].detail).toBe("Beginners, Saturdays");
  });

  /**
   * The same id can legitimately be two things — a coach's `coaches` row and
   * their `profiles` row share a uuid — so the key is (phone, kind, id), not
   * (phone, id).
   */
  it("keeps the same id under two different kinds", async () => {
    const db = admin();
    const phone = phoneFor();
    const id = "7c8d9e0f-1a2b-4c3d-9e4f-56789abcdef0";

    await db.from("wa_entity_memory").insert([
      { phone, kind: "coach", entity_id: id, label: "Augustine Rao" },
      { phone, kind: "client", entity_id: id, label: "Augustine Rao" },
    ]);

    const { data } = await db.from("wa_entity_memory").select("kind").eq("phone", phone);
    expect(data?.map((r) => r.kind).sort()).toEqual(["client", "coach"]);
  });

  it("is scoped to one chat — a referent never leaks between conversations", async () => {
    const db = admin();
    const mine = phoneFor();
    const theirs = phoneFor();
    const player = "11112222-3333-4444-8555-666677778888";

    await db
      .from("wa_entity_memory")
      .insert({ phone: mine, kind: "player", entity_id: player, label: "Myrah Rao" });

    const { data } = await db.from("wa_entity_memory").select("label").eq("phone", theirs);
    expect(data).toHaveLength(0);
  });

  it("prunes what has gone cold and leaves what hasn't", async () => {
    const db = admin();
    const phone = phoneFor();
    const stale = "aaaa1111-2222-4333-8444-555566667777";
    const fresh = "bbbb1111-2222-4333-8444-555566667777";

    // Both rows spell last_seen_at out. A bulk insert takes the union of the
    // objects' keys, so a row that simply omitted it would be sent an explicit
    // null rather than falling back to the column default — and the row under
    // test would vanish for a reason that has nothing to do with pruning.
    const { error: insertError } = await db.from("wa_entity_memory").insert([
      {
        phone,
        kind: "player",
        entity_id: stale,
        label: "Long Forgotten",
        last_seen_at: new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString(),
      },
      {
        phone,
        kind: "player",
        entity_id: fresh,
        label: "Still Talking About Them",
        last_seen_at: new Date().toISOString(),
      },
    ]);
    expect(insertError).toBeNull();

    const { error } = await db.rpc("prune_wa_entity_memory");
    expect(error).toBeNull();

    const { data } = await db.from("wa_entity_memory").select("entity_id").eq("phone", phone);
    expect(data?.map((r) => r.entity_id)).toEqual([fresh]);
  });
});
