import { describe, it, expect } from "vitest";
import { admin, asUser } from "../../e2e/lib/supabase";
import {
  createClient,
  createCoach,
  createGroupSession,
  bookSession,
  hoursFromNow,
} from "../../e2e/lib/scenario";

/**
 * Migration 0077 — the end-of-class paperwork a coach can finish and correct.
 *
 * Two behaviours are pinned here because both were previously impossible, and
 * both fail silently rather than loudly if they regress: an assessment that
 * cannot be amended looks like a saved assessment with the wrong number in it,
 * and a backlog that cannot see unmarked attendance looks like an empty
 * backlog.
 */

/** One category with two skills, so "amend one, leave the other" is testable. */
async function makeSkills() {
  const db = admin();
  const { data: cat, error: catErr } = await db
    .from("skill_categories")
    .insert({ name: `Test category ${crypto.randomUUID().slice(0, 8)}` })
    .select("id")
    .single();
  if (catErr || !cat) throw new Error(`makeSkills category: ${catErr?.message}`);

  const { data: skills, error: skErr } = await db
    .from("skills")
    .insert([
      { category_id: cat.id, name: "Forehand drive", sort_order: 1 },
      { category_id: cat.id, name: "Backhand push", sort_order: 2 },
    ])
    .select("id,name");
  if (skErr || !skills) throw new Error(`makeSkills skills: ${skErr?.message}`);

  return { categoryId: cat.id as string, skillA: skills[0].id as string, skillB: skills[1].id as string };
}

/**
 * A coach, a parent, and a class that finished two hours ago.
 *
 * Booked while the session is still in the future and only then moved back —
 * `book_session` refuses a session that has already started
 * (`session_not_bookable`), which is correct, and the same order every other
 * ended-session spec here uses.
 */
async function endedSession() {
  const db = admin();
  const coach = await createCoach();
  const parent = await createClient({ children: 1 });
  const session = await createGroupSession({ startsAt: hoursFromNow(3), coachId: coach.id });
  const booking = await bookSession({
    email: parent.email,
    sessionId: session.sessionId,
    playerId: parent.playerIds[0],
  });

  const started = new Date(Date.now() - 3 * 3_600_000);
  await db
    .from("class_sessions")
    .update({
      starts_at: started.toISOString(),
      ends_at: new Date(started.getTime() + 3_600_000).toISOString(),
    })
    .eq("id", session.sessionId);

  return { coach, parent, session, booking, playerId: parent.playerIds[0] };
}

/** Mark attendance AS THE COACH, so triggers and RLS see a real auth.uid(). */
async function mark(coachEmail: string, bookingId: string, status: "attended" | "no_show") {
  const coachDb = await asUser(coachEmail);
  const { error } = await coachDb.from("bookings").update({ status }).eq("id", bookingId);
  if (error) throw new Error(`mark(${status}): ${error.message}`);
}

async function ratingsFor(assessmentId: string) {
  const { data } = await admin()
    .from("skill_ratings")
    .select("skill_id,rating")
    .eq("assessment_id", assessmentId);
  return new Map((data ?? []).map((r) => [r.skill_id as string, r.rating as number]));
}

describe("save_session_assessment (migration 0077)", () => {
  it("files an assessment, then AMENDS it on a second save rather than failing", async () => {
    const db = admin();
    const { coach, session, playerId } = await endedSession();
    const { skillA, skillB } = await makeSkills();
    const asCoach = await asUser(coach.email);

    const { data: firstId, error: firstErr } = await asCoach.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [
        { skill_id: skillA, rating: 2 },
        { skill_id: skillB, rating: 3 },
      ],
    });
    expect(firstErr).toBeNull();
    expect(firstId).toBeTruthy();

    // The regression this exists for: the old code INSERTed straight at
    // skill_assessments, so this second call hit
    // skill_assessments_once_per_session and came back 23505 — surfaced to the
    // coach as "Already assessed for that session." with no way round it,
    // because neither table carries an UPDATE policy.
    const { data: secondId, error: secondErr } = await asCoach.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [{ skill_id: skillA, rating: 4 }],
    });
    expect(secondErr).toBeNull();
    expect(secondId).toBe(firstId);

    // Same row, corrected value — and the skill the coach did not touch on the
    // second pass keeps what it had rather than being wiped.
    const ratings = await ratingsFor(firstId as string);
    expect(ratings.get(skillA)).toBe(4);
    expect(ratings.get(skillB)).toBe(3);

    const { count } = await db
      .from("skill_assessments")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .eq("session_id", session.sessionId)
      .eq("coach_id", coach.id);
    expect(count).toBe(1);
  });

  it("files with no ratings at all — 'no change today' is a real assessment", async () => {
    const { coach, session, playerId } = await endedSession();
    const asCoach = await asUser(coach.email);

    const { data: id, error } = await asCoach.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [],
    });
    expect(error).toBeNull();
    expect(id).toBeTruthy();
    expect((await ratingsFor(id as string)).size).toBe(0);
  });

  it("refuses a session the caller does not coach", async () => {
    const { session, playerId } = await endedSession();
    const stranger = await createCoach();
    const asStranger = await asUser(stranger.email);

    const { error } = await asStranger.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [],
    });
    expect(error?.message ?? "").toContain("not_your_session");
  });

  it("drops out-of-range ratings without refusing the whole save", async () => {
    const { coach, session, playerId } = await endedSession();
    const { skillA, skillB } = await makeSkills();
    const asCoach = await asUser(coach.email);

    const { data: id, error } = await asCoach.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [
        { skill_id: skillA, rating: 9 },
        { skill_id: skillB, rating: 3 },
      ],
    });
    expect(error).toBeNull();

    const ratings = await ratingsFor(id as string);
    expect(ratings.has(skillA)).toBe(false);
    expect(ratings.get(skillB)).toBe(3);
  });
});

/**
 * Migration 0078 — who a correction made in "view as coach" belongs to.
 *
 * The founder's preview is the only route to fix a coach's paperwork (there is
 * no assessment editor under /admin), and crediting that fix to the founder
 * failed twice over without erroring once: the coach's wrong rating stayed
 * where it was, and the coach's backlog never cleared because both queue
 * functions match on `a.coach_id = p_coach`. Every assertion here passes
 * trivially against a function that ignores p_coach EXCEPT the coach_id and
 * queue ones, which are the point.
 */
describe("save_session_assessment — author attribution (migration 0078)", () => {
  it("credits a founder's preview save to the COACH, and clears that coach's backlog", async () => {
    const { coach, session, playerId, booking } = await endedSession();
    const { skillA } = await makeSkills();
    await mark(coach.email, booking.id, "attended");

    // The coach owes this assessment before the founder steps in.
    const asCoach = await asUser(coach.email);
    const { data: before } = await asCoach.rpc("get_coach_wrapup_queue", {});
    expect(
      ((before ?? []) as { kind: string; player_id: string | null }[]).filter(
        (r) => r.kind === "assessment" && r.player_id === playerId
      )
    ).toHaveLength(1);

    // Founder files it from the preview, naming the coach.
    const asFounder = await asUser("founder@sharwin.example");
    const { data: id, error } = await asFounder.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [{ skill_id: skillA, rating: 4 }],
      p_coach: coach.id,
    });
    expect(error).toBeNull();

    // Authored by the coach, not by the founder who typed it.
    const { data: row } = await admin()
      .from("skill_assessments")
      .select("coach_id")
      .eq("id", id as string)
      .single();
    expect(row?.coach_id).toBe(coach.id);

    // …which is what makes the coach's own backlog go quiet about this child.
    const { data: after } = await asCoach.rpc("get_coach_wrapup_queue", {});
    expect(
      ((after ?? []) as { kind: string; player_id: string | null }[]).filter(
        (r) => r.kind === "assessment" && r.player_id === playerId
      )
    ).toHaveLength(0);
  });

  it("AMENDS the coach's existing assessment rather than opening a second one", async () => {
    const { coach, session, playerId } = await endedSession();
    const { skillA } = await makeSkills();

    const asCoach = await asUser(coach.email);
    const { data: coachFiled } = await asCoach.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [{ skill_id: skillA, rating: 1 }],
    });

    // The mis-tapped 1 is exactly what the founder is here to correct.
    const asFounder = await asUser("founder@sharwin.example");
    const { data: founderFiled, error } = await asFounder.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [{ skill_id: skillA, rating: 4 }],
      p_coach: coach.id,
    });
    expect(error).toBeNull();
    expect(founderFiled).toBe(coachFiled);
    expect((await ratingsFor(coachFiled as string)).get(skillA)).toBe(4);

    const { count } = await admin()
      .from("skill_assessments")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .eq("session_id", session.sessionId);
    expect(count).toBe(1);
  });

  it("refuses a coach who tries to file under another coach's name", async () => {
    const { coach, session, playerId } = await endedSession();
    const stranger = await createCoach();
    const asStranger = await asUser(stranger.email);

    const { error } = await asStranger.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [],
      p_coach: coach.id,
    });
    expect(error?.message ?? "").toContain("not_authorised");
  });

  it("still defaults to the caller when p_coach is omitted", async () => {
    const { coach, session, playerId } = await endedSession();
    const asCoach = await asUser(coach.email);

    const { data: id, error } = await asCoach.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [],
    });
    expect(error).toBeNull();

    const { data: row } = await admin()
      .from("skill_assessments")
      .select("coach_id")
      .eq("id", id as string)
      .single();
    expect(row?.coach_id).toBe(coach.id);
  });
});

describe("get_coach_wrapup_queue (migration 0077)", () => {
  type Row = {
    kind: string;
    session_id: string;
    player_id: string | null;
    pending_count: number;
  };

  const forSession = (rows: Row[] | null, sessionId: string) =>
    (rows ?? []).filter((r) => r.session_id === sessionId);

  it("sees an unmarked roster — the half get_pending_assessments is blind to", async () => {
    const { coach, session } = await endedSession();
    const asCoach = await asUser(coach.email);

    const { data: queue, error } = await asCoach.rpc("get_coach_wrapup_queue", {});
    expect(error).toBeNull();

    const mine = forSession(queue as Row[], session.sessionId);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("attendance");
    expect(mine[0].pending_count).toBe(1);

    // The old queue could not: it filters on status = 'attended', and nobody
    // has said whether this child turned up, so it returns nothing — the prompt
    // went quiet about exactly the class that had been skipped.
    const { data: old } = await asCoach.rpc("get_pending_assessments", {});
    expect(
      (old as { session_id: string }[] | null ?? []).filter(
        (r) => r.session_id === session.sessionId
      )
    ).toHaveLength(0);
  });

  it("swaps the attendance row for an assessment row once the roster is marked", async () => {
    const { coach, session, booking, playerId } = await endedSession();
    const asCoach = await asUser(coach.email);

    await mark(coach.email, booking.id, "attended");

    let mine = forSession((await asCoach.rpc("get_coach_wrapup_queue", {})).data as Row[], session.sessionId);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("assessment");
    expect(mine[0].player_id).toBe(playerId);

    // …and clears entirely once the assessment is filed.
    await asCoach.rpc("save_session_assessment", {
      p_player: playerId,
      p_session: session.sessionId,
      p_ratings: [],
    });

    mine = forSession((await asCoach.rpc("get_coach_wrapup_queue", {})).data as Row[], session.sessionId);
    expect(mine).toHaveLength(0);
  });

  it("an absent child needs no assessment, so marking them clears the class", async () => {
    const { coach, session, booking } = await endedSession();
    const asCoach = await asUser(coach.email);

    await mark(coach.email, booking.id, "no_show");

    const mine = forSession(
      (await asCoach.rpc("get_coach_wrapup_queue", {})).data as Row[],
      session.sessionId
    );
    expect(mine).toHaveLength(0);
  });

  it("ignores a class that has not finished yet", async () => {
    const coach = await createCoach();
    const parent = await createClient({ children: 1 });
    const session = await createGroupSession({ startsAt: hoursFromNow(3), coachId: coach.id });
    await bookSession({
      email: parent.email,
      sessionId: session.sessionId,
      playerId: parent.playerIds[0],
    });

    const asCoach = await asUser(coach.email);
    const mine = forSession(
      (await asCoach.rpc("get_coach_wrapup_queue", {})).data as Row[],
      session.sessionId
    );
    expect(mine).toHaveLength(0);
  });

  it("refuses to report another coach's backlog", async () => {
    const { coach } = await endedSession();
    const stranger = await createCoach();
    const asStranger = await asUser(stranger.email);

    const { error } = await asStranger.rpc("get_coach_wrapup_queue", { p_coach: coach.id });
    expect(error?.message ?? "").toContain("not_authorised");
  });
});
