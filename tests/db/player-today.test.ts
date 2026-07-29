// notification-fix-plan, Bot changes — the parent live-status tool.
//
// "Where is he?" was asked for real during the audit and the bot had nothing to
// answer with: my_schedule knows what was BOOKED, not what is HAPPENING. These
// tests drive the tool the way the agent does — as the parent, through RLS —
// and check the three facts that make the difference: has the coach confirmed,
// have they arrived, and has attendance been marked.

import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  createClient,
  createCoach,
  createGroupSession,
  bookSession,
  coachMarkArrival,
  hoursFromNow,
} from "../../e2e/lib/scenario";
import { clientTools } from "../../lib/whatsapp/tools/client";
import type { ToolContext } from "../../lib/whatsapp/tools/types";

const tool = clientTools.find((t) => t.name === "get_player_today")!;

async function ctxFor(email: string, id: string): Promise<ToolContext> {
  return {
    phone: "+910000000000",
    profile: { id } as ToolContext["profile"],
    supabase: (await asUser(email)) as ToolContext["supabase"],
    admin: admin() as ToolContext["admin"],
  };
}

type Result = { ok: boolean; result?: { sessions: Record<string, unknown>[]; note?: string } };

/** A session earlier TODAY (already started), which is the interesting case. */
async function todaysSession() {
  const db = admin();
  const coach = await createCoach();
  const parent = await createClient({ children: 1 });
  const session = await createGroupSession({ startsAt: hoursFromNow(3), coachId: coach.id });
  const booking = await bookSession({
    email: parent.email,
    sessionId: session.sessionId,
    playerId: parent.playerIds[0],
  });

  // Pull it back to an hour ago — still today in IST for all but a one-hour
  // window after midnight, which the harness never runs in.
  const started = new Date(Date.now() - 60 * 60_000);
  await db
    .from("class_sessions")
    .update({
      starts_at: started.toISOString(),
      ends_at: new Date(started.getTime() + 60 * 60_000).toISOString(),
    })
    .eq("id", session.sessionId);

  return { coach, parent, session, booking };
}

describe("get_player_today", () => {
  it("finds a session that ALREADY STARTED today", async () => {
    // The whole point: a window beginning at "now" would return nothing here,
    // and the parent asking mid-class would be told there's nothing on.
    const { parent, session } = await todaysSession();
    const out = JSON.parse(await tool.run({}, await ctxFor(parent.email, parent.id))) as Result;

    expect(out.ok).toBe(true);
    expect(out.result!.sessions).toHaveLength(1);
    const row = out.result!.sessions[0] as Record<string, unknown>;
    expect(row.session_id).toBe(session.sessionId);
    expect(row.started).toBe(true);
  });

  it("reports the coach's arrival state, which is what 'where is he' means", async () => {
    const { coach, parent, session } = await todaysSession();

    let out = JSON.parse(await tool.run({}, await ctxFor(parent.email, parent.id))) as Result;
    expect((out.result!.sessions[0] as Record<string, unknown>).coach_arrived).toBe(false);

    await coachMarkArrival({
      coachEmail: coach.email,
      sessionId: session.sessionId,
      source: "tap",
    });

    out = JSON.parse(await tool.run({}, await ctxFor(parent.email, parent.id))) as Result;
    const row = out.result!.sessions[0] as Record<string, unknown>;
    expect(row.coach_arrived).toBe(true);
    expect(row.coach_confirmed).toBe(true); // arrived implies coming
    expect(row.coach).toBeTruthy();
  });

  it("distinguishes 'not marked yet' from 'absent'", async () => {
    const { coach, parent, booking } = await todaysSession();

    let out = JSON.parse(await tool.run({}, await ctxFor(parent.email, parent.id))) as Result;
    expect((out.result!.sessions[0] as Record<string, unknown>).attendance).toBe("not marked yet");

    const coachDb = await asUser(coach.email);
    await coachDb.from("bookings").update({ status: "no_show" }).eq("id", booking.id);

    out = JSON.parse(await tool.run({}, await ctxFor(parent.email, parent.id))) as Result;
    expect((out.result!.sessions[0] as Record<string, unknown>).attendance).toBe("marked absent");
  });

  it("says so plainly when there's nothing on today", async () => {
    const parent = await createClient({ children: 1 });
    const out = JSON.parse(await tool.run({}, await ctxFor(parent.email, parent.id))) as Result;
    expect(out.ok).toBe(true);
    expect(out.result!.sessions).toHaveLength(0);
    expect(out.result!.note).toContain("session today");
  });

  it("does not leak another household's sessions", async () => {
    const { parent: mine } = await todaysSession();
    await todaysSession(); // a second, unrelated family with a session today

    const out = JSON.parse(await tool.run({}, await ctxFor(mine.email, mine.id))) as Result;
    expect(out.result!.sessions).toHaveLength(1);
  });
});
