"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireFounder } from "@/lib/founder";
import { academyWallToUtc, formatDate, utcToAcademyWall } from "@/lib/academy-time";
import { overlaps, weeklyOccurrences } from "@/lib/slot-clashes";
import {
  WEEKDAYS,
  type ClassRow,
  type PrivateSeriesRow,
  type SessionRow,
} from "@/components/app/admin-calendar-types";
import { venueDisplayName } from "@/lib/venue-display";
import {
  readRankedCoaches,
  readRoster,
  readSessionDetail,
  type RankedCoach,
  type RosterEntry,
  type SessionDetail,
} from "@/lib/session-sheet";
import { buildSessionRows, fetchWeekRaw } from "@/lib/session-week";
import {
  assignPrivateSessionClientCore,
  bulkRemoveClassesCore,
  cancelFuturePrivateSessionsCore,
  createOneOffClassCore,
  createPrivateSessionCore,
  deleteGroupClassCore,
  endPrivateSeriesCore,
  planCalendarWipeCore,
  planClassRemovalCore,
  planPrivateSeriesRemovalCore,
  wipeCalendarCore,
  type CalendarWipePreview,
  type CalendarWipeResult,
  type ClassRemovalPlan,
  type PrivateSeriesRemovalPlan,
  materializeInviteCore,
  endGroupClassCore,
  moveSessionCore,
  reassignClassCoachCore,
  reassignSessionCore,
  restoreGroupClassCore,
  setSessionCapacityCore,
  topUpSessionsCore,
  updateGroupClassCore,
  updatePrivateSeriesCore,
  type PrivateSeriesPatch,
  type ClassUpdate,
  type NewOneOffClass,
  type PrivateSessionInput,
} from "@/lib/admin-ops";

// ── WhatsApp/notify manifest ─────────────────────────────────────────────────
// The founder migrated from a world where he *watched* each message send. So
// every success line in the UI must say whether a WhatsApp actually went out —
// he should never wonder if he still has to message people himself. Tag any new
// action here, and word its ✓ line to match (silent → plain "Saved.";
// notifying → "…everyone booked / the coach / the client has been told").
//
//   reassignSession .................. notifies the coach(es) (old + new)
//   moveSession ...................... notifies everyone booked + the coach
//   setSessionCapacity ............... notifies nobody
//   updateGroupClass ................. notifies everyone booked *iff* the slot moves
//   endGroupClass .................... notifies everyone booked (sessions cancelled)
//   restoreGroupClass ................ notifies nobody
//   cancelAllFuturePrivateSessions ... notifies the client + affected coaches, and
//                                      retires the client's weekly slots so they stop
//                                      regenerating
//   endPrivateSeries ................. notifies each family + each coach, ONE message
//                                      each across every slot in the selection; the
//                                      minutes go back in full, including a week
//                                      inside the 24-hour window
//   updatePrivateSeries .............. notifies the family *iff* the slot moves, and every
//                                      coach who had a week of it or is taking it now —
//                                      ONE message each however many weeks move
//   planPrivateSeriesRemoval ......... notifies nobody (read-only preview)
//   reassignClassCoach ............... notifies the coach(es)
//   deleteGroupClass ................. notifies nobody when the class holds no live booking;
//                                      when it does, `force` ends it first, so everyone
//                                      booked + their coach get the cancellation
//   planClassRemoval ................. notifies nobody (read-only preview)
//   bulkRemoveClasses ................ classes holding nothing delete silently, whether they
//                                      had stopped or (on deleteRunningEmpty) were still
//                                      running; every class it ends — including the ones it
//                                      only ends because they were running and empty
//                                      (endRunningEmpty, coaches only) and the ones it
//                                      ends AND deletes (deleteBooked) — notifies everyone
//                                      booked + their coaches, ONE message each no matter how
//                                      many classes went. That guarantee now spans BOTH
//                                      kinds: a parent losing three classes and a weekly
//                                      private slot in one clear-out hears once (the collapse
//                                      is CancellationNotice.flush, not endGroupClassesCore)
//   planCalendarWipe ................. notifies nobody (read-only preview)
//   wipeCalendar ..................... notifies everyone booked + every coach rostered, ONE
//                                      message each for the whole calendar (one SQL
//                                      INSERT..SELECT..GROUP BY — there is no loop to get it
//                                      wrong)
//   topUpSessions .................... notifies nobody
//   createOneOffClass ................ notifies nobody (nothing booked yet)
//   addSchoolPlayer .................. notifies nobody
//   createPrivateSession ............. notifies the client
//   assignPrivateSessionClient ....... notifies the client
//   createPrivateSessionForInvite .... notifies the client
//   previewSlotClashes ............... notifies nobody (read-only preview)
//   getSessionSheet .................. notifies nobody (read-only)
// (cancelSession lives in app/admin/actions.ts: notifies everyone booked + coach.)
type Result = { ok: boolean; error?: string; code?: string };

function refresh() {
  revalidatePath("/admin/schedule");
  revalidatePath("/admin/weekly");
  revalidatePath("/admin");
  // Group-class edits (title/active/etc.) feed the cached public `getGroupClasses`.
  revalidateTag("classes", "max");
}

// ── One session ("just this session") ────────────────────────────────────────

export async function reassignSession(
  sessionId: string,
  coachId: string,
  lock: boolean,
  force = false
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await reassignSessionCore(supabase, founder.id, sessionId, coachId, lock, force);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function moveSession(
  sessionId: string,
  date: string,
  time: string
): Promise<Result & { coachCleared?: boolean }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await moveSessionCore(supabase, founder.id, sessionId, date, time);
  if (!result.ok) return result;
  refresh();
  // Passed through so the ✓ can say the coach came off — the move succeeds
  // either way, but "moved" alone hides a session that now needs someone.
  return { ok: true, coachCleared: result.coachCleared };
}

export async function setSessionCapacity(
  sessionId: string,
  capacity: number | null
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await setSessionCapacityCore(supabase, founder.id, sessionId, capacity);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

// ── The whole class ("every week") ───────────────────────────────────────────

export async function updateGroupClass(
  input: ClassUpdate
): Promise<Result & { moved?: number; stuck?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await updateGroupClassCore(supabase, founder.id, input);
  if (!result.ok) return result;
  refresh();
  // `stuck` is weeks that refused to move even without their coach. They stay
  // on the old slot, so a bare "Saved" would be a false report.
  return { ok: true, moved: result.moved, stuck: result.stuck };
}

export async function endGroupClass(classId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await endGroupClassCore(supabase, founder.id, classId);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function cancelAllFuturePrivateSessions(
  sessionId: string
): Promise<Result & { cancelled?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await cancelFuturePrivateSessionsCore(supabase, founder.id, sessionId);
  if (!result.ok) return result;
  refresh();
  return { ok: true, cancelled: result.cancelled };
}

export async function restoreGroupClass(classId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await restoreGroupClassCore(supabase, founder.id, classId);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function reassignClassCoach(
  classId: string,
  coachId: string,
  lock: boolean,
  force = false
): Promise<Result & { changed?: number; skipped?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await reassignClassCoachCore(
    supabase,
    founder.id,
    classId,
    coachId,
    lock,
    force
  );
  if (!result.ok) return result;
  refresh();
  return { ok: true, changed: result.changed, skipped: result.skipped };
}

/** `force` deletes a class together with the history it holds — and, if people
 * are still booked on it, cancels their sessions and tells them on the way. The
 * sheet asks a second time before passing it. */
export async function deleteGroupClass(
  classId: string,
  force = false
): Promise<Result & { cancelledBookings?: number; unmarkedBookings?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await deleteGroupClassCore(supabase, founder.id, classId, force);
  if (!result.ok) return result;
  refresh();
  return {
    ok: true,
    cancelledBookings: result.cancelledBookings,
    unmarkedBookings: result.unmarkedBookings,
  };
}

/**
 * What a bulk removal would do, so the confirm step can say it out loud.
 *
 * Two id spaces, two plans, deliberately never merged: `classIds` are `classes`
 * rows, `seriesIds` are `private_booking_series` rows, and there is no foreign
 * key between the tables. A series id passed as a class id matches nothing and
 * disappears.
 */
export async function planClassRemoval(
  classIds: string[],
  seriesIds: string[] = []
): Promise<Result & Partial<ClassRemovalPlan> & { series?: PrivateSeriesRemovalPlan }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const [plan, series] = await Promise.all([
    planClassRemovalCore(supabase, classIds),
    planPrivateSeriesRemovalCore(supabase, seriesIds),
  ]);
  return { ok: true, ...plan, series };
}

/** Retire weekly private slots outright — the Schedule tab's client-wide
 * "cancel all upcoming" is a different, blunter thing. */
export async function endPrivateSeries(
  seriesIds: string[]
): Promise<Result & { ended?: number; cancelled?: number; minutesReturned?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await endPrivateSeriesCore(supabase, founder.id, seriesIds);
  if (!result.ok) return result;
  refresh();
  return {
    ok: true,
    ended: result.ended,
    cancelled: result.cancelled,
    minutesReturned: result.minutesReturned,
  };
}

/** Move a family's standing weekly slot, or change who takes it. Carries the
 *  weeks already on the calendar across with it — see updatePrivateSeriesCore
 *  for why changing only the template would split the family's weeks in two. */
export async function updatePrivateSeries(
  seriesId: string,
  patch: PrivateSeriesPatch
): Promise<Result & { movedSessions?: number; coachCleared?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await updatePrivateSeriesCore(supabase, founder.id, seriesId, patch);
  if (!result.ok) return result;
  refresh();
  return {
    ok: true,
    movedSessions: result.movedSessions,
    coachCleared: result.coachCleared,
  };
}

/** Clear a selection of weekly classes — delete the stopped ones that carry no
 * history, and whichever of the buckets with a cost the founder opted into. */
export async function bulkRemoveClasses(
  classIds: string[],
  opts: {
    endBooked?: boolean;
    purgeEnded?: boolean;
    deleteBooked?: boolean;
    deleteRunningEmpty?: boolean;
    endRunningEmpty?: boolean;
    privateSeriesIds?: string[];
    endPrivateSeries?: boolean;
  }
): Promise<
  Result & {
    deleted?: number;
    deletedRunning?: number;
    ended?: number;
    purged?: number;
    deletedBooked?: number;
    kept?: number;
    privateSeriesEnded?: number;
    minutesReturned?: number;
    unsupported?: number;
    warning?: string;
  }
> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await bulkRemoveClassesCore(supabase, founder.id, classIds, opts);
  if (!result.ok) return result;
  refresh();
  return result;
}

// ── The whole calendar ───────────────────────────────────────────────────────

/** Read-only. What is on the calendar right now, so the confirm step can name
 * the cost before the founder is anywhere near a destructive control. */
export async function planCalendarWipe(): Promise<Result & { preview?: CalendarWipePreview }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  return planCalendarWipeCore(supabase);
}

/**
 * Clear everything. `confirm` must be the literal "WIPE" — checked again in the
 * RPC, so the guard survives anything the client does.
 */
export async function wipeCalendar(
  confirm: string,
  keepHistory: boolean
): Promise<Result & { wiped?: CalendarWipeResult }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await wipeCalendarCore(supabase, founder.id, { confirm, keepHistory });
  if (!result.ok) return result;
  refresh();
  // A wipe reaches further than the calendar screens: a parent's schedule and
  // the players list both read from what just went.
  revalidatePath("/admin/players");
  revalidatePath("/app/schedule");
  return result;
}

export async function topUpSessions(): Promise<Result & { created?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await topUpSessionsCore(supabase, founder.id);
  if (!result.ok) return result;
  refresh();
  return { ok: true, created: result.created };
}

// ── Adding to the calendar ───────────────────────────────────────────────────

/** A brand-new one-off group/school class — sessions only on the picked dates,
 * never topped up. */
export async function createOneOffClass(input: NewOneOffClass): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await createOneOffClassCore(supabase, founder.id, input);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

/**
 * Register a pupil on a school class from the admin schedule. Uses the same
 * add_school_player RPC as the coach flow (authorised here as the founder):
 * creates the account-less player, enrols them and books this + future sessions.
 */
export async function addSchoolPlayer(
  sessionId: string,
  fullName: string,
  grade: number | null
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  if (fullName.trim() === "") return { ok: false, error: "Enter the player's name." };
  const { error } = await supabase.rpc("add_school_player", {
    p_session: sessionId,
    p_full_name: fullName.trim(),
    // See the coach-side caller: p_grade is required-but-nullable in SQL, which
    // the generated Args type can't express.
    p_grade: grade as number,
  });
  if (error) return { ok: false, error: "Couldn't add the player. Try again." };
  refresh();
  return { ok: true };
}

export async function createPrivateSession(input: PrivateSessionInput): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await createPrivateSessionCore(supabase, founder.id, input);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

/** Assign a client to an "open" private slot that was created without one. */
export async function assignPrivateSessionClient(
  sessionId: string,
  clientId: string,
  playerId?: string
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await assignPrivateSessionClientCore(
    supabase,
    founder.id,
    sessionId,
    clientId,
    playerId
  );
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

/**
 * Book a private session for a pre-registered client (a phone invite with no
 * account yet). The invite is turned into a real client account first, then
 * the session is booked exactly like createPrivateSession.
 */
export async function createPrivateSessionForInvite(
  inviteId: string,
  input: Omit<PrivateSessionInput, "clientId" | "playerId">
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const materialized = await materializeInviteCore(supabase, founder.id, inviteId);
  if (!materialized.ok || !materialized.clientId)
    return { ok: false, error: materialized.error ?? "Couldn't create the account." };
  const result = await createPrivateSessionCore(supabase, founder.id, {
    ...input,
    clientId: materialized.clientId,
  });
  if (!result.ok) return result;
  refresh();
  revalidatePath("/admin/players");
  return { ok: true };
}

// ── Session roster (players + attendance) ────────────────────────────────────

export async function getSessionRoster(
  sessionId: string,
  opts?: { includeWaitlisted?: boolean }
): Promise<RosterEntry[]> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return [];
  return readRoster(supabase, sessionId, opts?.includeWaitlisted === true);
}

export async function getSessionSheet(
  sessionId: string,
  withRanks: boolean
): Promise<{ roster: RosterEntry[]; detail: SessionDetail | null; ranked: RankedCoach[] | null }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { roster: [], detail: null, ranked: null };
  const [roster, detail, ranked] = await Promise.all([
    readRoster(supabase, sessionId, true),
    readSessionDetail(supabase, sessionId),
    withRanks ? readRankedCoaches(supabase, sessionId) : null,
  ]);
  return { roster, detail, ranked };
}

// ── Week data for client-side navigation ─────────────────────────────────────


/**
 * Fetches the 7-day window of sessions starting on `anchor` (a "YYYY-MM-DD"
 * academy wall date) and maps them to SessionRow[]. Called by AdminScheduleTabs
 * for client-side navigation — avoids a full page reload and only re-fetches
 * the window-specific session data.
 *
 * nextByClass is the class-id → next-session-ISO map computed on initial page
 * load and passed down as a plain object (serialisable over the wire).
 */
export async function fetchWeekSessions(
  anchor: string,
  nextByClass: Record<string, string>,
  /** classId → the slot the class keeps, "HH:MM". Computed once on the server
   *  page from every future session; passed back in so paging to another week
   *  can still tell a moved session from one sitting where it belongs. */
  slotByClass: Record<string, string> = {}
): Promise<{ sessions: SessionRow[]; rangeLabel: string }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { sessions: [], rangeLabel: "" };

  const from = academyWallToUtc(anchor, "00:00");
  const to = new Date(from.getTime() + 7 * 86400000);

  const { data: rawSessions } = await fetchWeekRaw(supabase, from, to);
  const sessions = await buildSessionRows(supabase, rawSessions ?? [], nextByClass, slotByClass);

  const rangeLabel = `${formatDate(from)} – ${formatDate(to.getTime() - 86400000)}`;

  return { sessions, rangeLabel };
}

// ── What's already there ─────────────────────────────────────────────────────

/** One session standing in the way of a slot the founder is picking. */
export type SlotClash = {
  startsAt: string; // ISO
  endsAt: string; // ISO
  title: string;
  isPrivate: boolean;
};

export type SlotPreviewRow = {
  /** The instants this pick would occupy, ISO ascending. */
  occurrences: string[];
  /** Occurrences the NAMED coach cannot take. Empty when left on automatic. */
  coachBusy: { startsAt: string; clash: SlotClash }[];
  /** Overlapping sessions in the same hall, whoever is teaching them. Never a
   *  blocker — two classes in one venue is an ordinary arrangement. */
  venueBusy: SlotClash[];
};

export type SlotPreview = {
  byKey: Record<string, SlotPreviewRow>;
  /** The lookup itself fell over. The sheet says so and publishing carries on —
   *  a preview that fails must never become a gate. */
  failed?: boolean;
};

/**
 * What already occupies the day and time the founder is picking — asked while
 * he is picking it, rather than after he taps Publish.
 *
 * Read-only, and deliberately NOT a validator: it returns facts and the sheet
 * decides which of them are worth a sentence. For a repeating class nothing
 * here can refuse anything at all — a week the chosen coach is busy on simply
 * goes out for a coach to be picked automatically.
 */
export async function previewSlotClashes(input: {
  mode: "recurring" | "dates";
  /** "MO".."SU" for recurring, "YYYY-MM-DD" for dates. */
  keys: string[];
  timesByKey: Record<string, string>;
  durationMinutes: number;
  venueId: string;
  coachId?: string;
  weeks?: number;
}): Promise<SlotPreview> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { byKey: {}, failed: true };

  try {
    const durationMs = input.durationMinutes * 60000;

    // The same occurrence maths the insert uses, so the weeks named here are
    // exactly the weeks that get written (lib/slot-clashes.ts).
    const perKey = new Map<string, Date[]>();
    for (const key of input.keys) {
      const time = input.timesByKey[key];
      if (!time) continue;
      perKey.set(
        key,
        input.mode === "recurring"
          ? weeklyOccurrences(key, time, input.weeks ?? 8)
          : [academyWallToUtc(key, time)]
      );
    }

    const all = [...perKey.values()].flat();
    if (all.length === 0) return { byKey: {} };
    const windowStart = new Date(Math.min(...all.map((d) => d.getTime())));
    const windowEnd = new Date(Math.max(...all.map((d) => d.getTime())) + durationMs);

    const SELECT = "starts_at,ends_at,classes!inner(title,class_type)";

    // The coach's diary. Hits class_sessions_coach_id_starts_at_idx, which is
    // partial on status='scheduled' — the same rows coach_no_overlap governs,
    // so this asks exactly the question the database will ask.
    const coachRows = input.coachId
      ? (
          await supabase
            .from("class_sessions")
            .select(SELECT)
            .eq("coach_id", input.coachId)
            .eq("status", "scheduled")
            .lt("starts_at", windowEnd.toISOString())
            .gt("ends_at", windowStart.toISOString())
        ).data ?? []
      : [];

    // The hall. Matched on venue_id and never on name: `venues.unit` means two
    // halls in one complex are separate rows, so a name match would have every
    // class at a large site warning about every other one.
    const { data: venueClasses } = await supabase
      .from("classes")
      .select("id")
      .eq("venue_id", input.venueId);
    const ids = (venueClasses ?? []).map((c) => c.id);
    const venueRows = ids.length
      ? (
          await supabase
            .from("class_sessions")
            .select(SELECT)
            .in("class_id", ids)
            .eq("status", "scheduled")
            .lt("starts_at", windowEnd.toISOString())
            .gt("ends_at", windowStart.toISOString())
        ).data ?? []
      : [];

    type Row = { starts_at: string; ends_at: string; classes: unknown };
    const asClash = (r: Row): SlotClash => {
      const cls = r.classes as { title: string; class_type: string };
      return {
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        title: cls.title,
        isPrivate: cls.class_type === "private",
      };
    };
    const hits = (rows: Row[], start: Date) =>
      rows.filter((r) =>
        overlaps(
          start.getTime(),
          start.getTime() + durationMs,
          new Date(r.starts_at).getTime(),
          new Date(r.ends_at).getTime()
        )
      );

    const byKey: Record<string, SlotPreviewRow> = {};
    for (const [key, occurrences] of perKey) {
      const coachBusy: { startsAt: string; clash: SlotClash }[] = [];
      const venueBusy: SlotClash[] = [];
      const seenVenue = new Set<string>();
      for (const start of occurrences) {
        for (const r of hits(coachRows as Row[], start)) {
          coachBusy.push({ startsAt: start.toISOString(), clash: asClash(r) });
        }
        for (const r of hits(venueRows as Row[], start)) {
          // One line per neighbouring class, not one per week — he is asking
          // "what else is in this hall", not for a register of dates.
          const k = `${r.starts_at}|${r.ends_at}`;
          if (seenVenue.has(k)) continue;
          seenVenue.add(k);
          venueBusy.push(asClash(r));
        }
      }
      byKey[key] = {
        occurrences: occurrences.map((d) => d.toISOString()),
        coachBusy,
        venueBusy,
      };
    }

    return { byKey };
  } catch {
    return { byKey: {}, failed: true };
  }
}

// ── The timetable ────────────────────────────────────────────────────────────
// The repeating classes behind the schedule, fetched on demand rather than on
// every page load. The Schedule tab opens on This week; the founder may never
// flip to Timetable in a given visit, and making him pay for that query on
// first paint was the one real cost of merging the two screens into one tab.

/** "Monday 3:30 pm · Mantri Espana" → "15:30".
 *
 * Last resort, for a class that never had a single session generated. The title
 * is written from the slot by `generateClassTitle`, so it is the only record of
 * that slot left once there are no sessions to read it off — `recurrence_rule`
 * carries the day and nothing else. Anything unparseable falls through. */
function timeFromTitle(title: string): string | null {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(title);
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export type Timetable = {
  classes: ClassRow[];
  privateSeries: PrivateSeriesRow[];
  /** Group classes that run on a date, not every week — not on this list at
   *  all. Counted so the screen can say where they are instead of going quiet. */
  oneOffCount: number;
};

export async function fetchTimetable(): Promise<Timetable> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { classes: [], privateSeries: [], oneOffCount: 0 };

  const nowIso = new Date().toISOString();
  const [
    { data: classes },
    { count: oneOffCount },
    { data: coaches },
    { data: venues },
    { data: series },
  ] = await Promise.all([
    // Each class carries its next scheduled session (with the families booked on
    // it) and its latest session of any status. Ending a class cancels every
    // future session, so `next` comes back empty for one; its own past sessions
    // still hold the truth about its slot, and a hardcoded fallback here used to
    // rewrite that slot on the next save.
    supabase
      .from("classes")
      .select(
        "id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,ends_on,venue_id,is_school,venues(name,unit),next:class_sessions(id,starts_at,coach_id,coaches(profiles(full_name)),bookings(client_id)),last:class_sessions(starts_at)"
      )
      .eq("class_type", "group")
      .not("recurrence_rule", "is", null)
      .eq("next.status", "scheduled")
      .gt("next.starts_at", nowIso)
      .in("next.bookings.status", ["confirmed", "attended"])
      .order("starts_at", { referencedTable: "next" })
      .limit(1, { referencedTable: "next" })
      .order("starts_at", { referencedTable: "last", ascending: false })
      .limit(1, { referencedTable: "last" })
      .order("title"),
    supabase
      .from("classes")
      .select("id", { count: "exact", head: true })
      .eq("class_type", "group")
      .is("recurrence_rule", null),
    supabase
      .from("coaches")
      .select("id,active,profiles!inner(full_name)")
      .eq("active", true),
    supabase.from("venues").select("id,name,unit").order("name"),
    // client_id as well as the joined name: the sub-line needs the name, the
    // client filter needs the id, and resolving one back from the other would
    // make two families called Sharma one row on the founder's screen. Sessions
    // link to a series through their booking's private_series_id, so the
    // deep-link target is the earliest scheduled future session across those.
    supabase
      .from("private_booking_series")
      .select(
        "id,client_id,weekday,start_time,duration_minutes,preferred_coach,venue_id,venue_label,player:players!private_booking_series_player_id_fkey(full_name),client:profiles!private_booking_series_client_id_fkey(full_name),bookings(class_sessions!inner(id,starts_at))"
      )
      .eq("active", true)
      .eq("bookings.class_sessions.status", "scheduled")
      .gt("bookings.class_sessions.starts_at", nowIso),
  ]);

  const classRows: ClassRow[] = (classes ?? []).map((c) => {
    const [next] = c.next;
    const [last] = c.last;
    const time = next
      ? utcToAcademyWall(new Date(next.starts_at)).time
      : last
        ? utcToAcademyWall(new Date(last.starts_at)).time
        : (timeFromTitle(c.title) ?? "18:30");
    return {
      id: c.id,
      title: c.title,
      description: c.description ?? "",
      level: c.skill_level,
      capacity: c.capacity,
      duration: c.duration_minutes,
      weekday: c.recurrence_rule?.match(/BYDAY=(..)/)?.[1] ?? "MO",
      time,
      active: c.active,
      endsOn: c.ends_on,
      venueId: c.venue_id,
      venueName: c.venues ? venueDisplayName(c.venues) : null,
      isSchool: c.is_school,
      coachName: next?.coaches?.profiles.full_name ?? null,
      bookedCount: next ? next.bookings.length : 0,
      // A Set, because two children of one family in the same class are two
      // bookings and one name to filter by. School pupils have no client at all.
      clientIds: next
        ? [...new Set(next.bookings.map((b) => b.client_id).filter((id): id is string => !!id))]
        : [],
      nextSessionId: next?.id ?? null,
      nextSessionStart: next?.starts_at ?? null,
      nextCoachId: next?.coach_id ?? null,
    };
  });

  const coachNameById = new Map((coaches ?? []).map((c) => [c.id, c.profiles.full_name]));

  const venueById = new Map((venues ?? []).map((v) => [v.id, v]));
  const knownVenueNames = new Set(
    (venues ?? []).map((v) => venueDisplayName(v).toLowerCase())
  );
  const isoWeekdayCode = WEEKDAYS.map(([code]) => code); // 0-based: [MO..SU]

  const privateSeries: PrivateSeriesRow[] = (series ?? []).map((s) => {
    const venue = s.venue_id ? venueById.get(s.venue_id) : undefined;
    const venueName =
      (venue ? venueDisplayName(venue) : s.venue_label?.trim()) ?? "Private location";
    const next = s.bookings
      .map((b) => b.class_sessions)
      .reduce<{ id: string; starts_at: string } | null>(
        (soonest, cs) => (!soonest || cs.starts_at < soonest.starts_at ? cs : soonest),
        null
      );
    return {
      id: s.id,
      playerName: s.player?.full_name ?? "Player",
      clientName: s.client?.full_name ?? "",
      clientId: s.client_id ?? null,
      weekday: isoWeekdayCode[s.weekday - 1] ?? "MO",
      time: String(s.start_time).slice(0, 5),
      duration: s.duration_minutes,
      coachName: s.preferred_coach ? (coachNameById.get(s.preferred_coach) ?? null) : null,
      venueName,
      knownVenue: knownVenueNames.has(venueName.toLowerCase()),
      nextSessionId: next?.id ?? null,
      nextSessionStart: next?.starts_at ?? null,
    };
  });

  return { classes: classRows, privateSeries, oneOffCount: oneOffCount ?? 0 };
}
