// The conversation must come back in the order it happened.
//
// wa_messages writes both halves of a turn in ONE insert, so Postgres stamps
// them with an identical created_at — now() is transaction-start time. The
// agent used to break that tie with `.order("id")`, and id is
// gen_random_uuid(): a coin toss on every single turn.
//
// Measured on live data before migration 0072: 139 of 314 tied pairs (44.3%)
// came back with the assistant's reply BEFORE the user message that prompted
// it. The agent merges consecutive same-role rows, so a displaced user row got
// welded onto the NEXT user message and handed to the model as one live
// instruction — which is how the message "Hi!" re-ran the previous turn's
// create_group_class and created two real recurring classes.
//
// These tests pin the fix at the layer that failed: ordering, on real rows,
// with real ties.

import { describe, it, expect } from "vitest";
import { admin } from "../../e2e/lib/supabase";

const phoneFor = () => `+9199${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;

describe("wa_messages ordering (migration 0072)", () => {
  it("keeps the user's message ahead of its reply when both share a timestamp", async () => {
    const db = admin();
    const phone = phoneFor();

    // Exactly how lib/whatsapp/agent.ts persists a turn.
    const { error } = await db.from("wa_messages").insert([
      { phone, role: "user", content: "create a group class Tuesdays 6pm" },
      { phone, role: "assistant", content: "Created it." },
    ]);
    expect(error).toBeNull();

    const { data } = await db
      .from("wa_messages")
      .select("role,content,seq,created_at")
      .eq("phone", phone)
      .order("seq", { ascending: true });

    expect(data).toHaveLength(2);
    // The tie the old ordering could not resolve.
    expect(data![0].created_at).toBe(data![1].created_at);
    // The ordering that resolves it.
    expect(data![0].role).toBe("user");
    expect(data![1].role).toBe("assistant");
    expect(data![0].seq).toBeLessThan(data![1].seq);
  });

  it("never scrambles a turn, over enough turns that chance would have", async () => {
    // At the old 50/50 per turn, 40 clean turns has probability ~1e-12.
    const db = admin();
    const phone = phoneFor();
    const TURNS = 40;

    for (let i = 0; i < TURNS; i++) {
      const { error } = await db.from("wa_messages").insert([
        { phone, role: "user", content: `question ${i}` },
        { phone, role: "assistant", content: `answer ${i}` },
      ]);
      expect(error).toBeNull();
    }

    const { data } = await db
      .from("wa_messages")
      .select("role,content,seq")
      .eq("phone", phone)
      .order("seq", { ascending: true });

    expect(data).toHaveLength(TURNS * 2);
    for (let i = 0; i < TURNS; i++) {
      const q = data![i * 2];
      const a = data![i * 2 + 1];
      expect(q.role).toBe("user");
      expect(q.content).toBe(`question ${i}`);
      expect(a.role).toBe("assistant");
      expect(a.content).toBe(`answer ${i}`);
    }
  });

  it("reads the tail newest-first the way loadHistory does, then reverses cleanly", async () => {
    // loadHistory takes the last N by seq DESC and reverses. The window must
    // never begin mid-turn in a way that strands a reply without its question.
    const db = admin();
    const phone = phoneFor();
    for (let i = 0; i < 6; i++) {
      await db.from("wa_messages").insert([
        { phone, role: "user", content: `q${i}` },
        { phone, role: "assistant", content: `a${i}` },
      ]);
    }

    const { data } = await db
      .from("wa_messages")
      .select("role,content,seq")
      .eq("phone", phone)
      .order("seq", { ascending: false })
      .limit(4);

    const rows = (data ?? []).reverse();
    expect(rows.map((r) => r.content)).toEqual(["q4", "a4", "q5", "a5"]);
    // Chronological history ALWAYS ends on the assistant. A trailing user turn
    // is the shape that let a stale instruction be replayed as if it were live.
    expect(rows[rows.length - 1].role).toBe("assistant");
  });

  it("assigns seq monotonically per phone, so two conversations cannot interleave", async () => {
    const db = admin();
    const a = phoneFor();
    const b = phoneFor();

    await db.from("wa_messages").insert([
      { phone: a, role: "user", content: "a1" },
      { phone: a, role: "assistant", content: "a1r" },
    ]);
    await db.from("wa_messages").insert([
      { phone: b, role: "user", content: "b1" },
      { phone: b, role: "assistant", content: "b1r" },
    ]);
    await db.from("wa_messages").insert([
      { phone: a, role: "user", content: "a2" },
      { phone: a, role: "assistant", content: "a2r" },
    ]);

    const { data } = await db
      .from("wa_messages")
      .select("content,seq")
      .eq("phone", a)
      .order("seq", { ascending: true });

    expect(data!.map((r) => r.content)).toEqual(["a1", "a1r", "a2", "a2r"]);
    const seqs = data!.map((r) => r.seq as number);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });
});
