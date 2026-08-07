"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireFounder } from "@/lib/founder";
import { academyWallToUtc, formatDate, utcToAcademyWall } from "@/lib/academy-time";
import { overlaps, weeklyOccurrences } from "@/lib/slot-clashes";
import { asAddressDetails, fromDetails, type StructuredAddress } from "@/lib/address";
import {
  WEEKDAYS,
  type ClassRow,
  type PrivateSeriesRow,
  type SessionRow,
} from "@/components/app/admin-calendar-types";
import { venueDisplayName } from "@/lib/venue-display";
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
//   getSessionDetail ................. notifies nobody (read-only)
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

export type RosterEntry = {
  id: string;
  name: string;
  /** "attended" = present, "no_show" = absent, "confirmed" = unmarked,
   *  "waitlisted" = holding a place in the queue, not in the class. */
  status: "confirmed" | "attended" | "no_show" | "waitlisted";
  /** Where in the queue, for a waitlisted booking. Null for everyone else. */
  waitlistPosition: number | null;
};

/**
 * Who's booked on a session and whether they were marked present or absent —
 * shown in the admin session sheet.
 *
 * The waitlist is opt-in per caller, and deliberately so: the weekly class
 * sheet asks this same question to list "Regulars", and a queue appearing in
 * that list would be answering a question nobody asked there.
 */
export async function getSessionRoster(
  sessionId: string,
  opts?: { includeWaitlisted?: boolean }
): Promise<RosterEntry[]> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return [];
  const statuses: RosterEntry["status"][] = opts?.includeWaitlisted
    ? ["confirmed", "attended", "no_show", "waitlisted"]
    : ["confirmed", "attended", "no_show"];
  const { data } = await supabase
    .from("bookings")
    .select("id,status,waitlist_position,players(full_name)")
    .eq("session_id", sessionId)
    .in("status", statuses);
  return (data ?? [])
    .map((b) => ({
      id: b.id,
      name: b.players?.full_name ?? "Unknown player",
      status: b.status as RosterEntry["status"],
      waitlistPosition: b.waitlist_position ?? null,
    }))
    .sort((a, b) => {
      // Booked first, then the queue in its own order — a waitlisted name
      // sorted alphabetically among the booked would read as being in.
      const aQ = a.status === "waitlisted";
      const bQ = b.status === "waitlisted";
      if (aQ !== bQ) return aQ ? 1 : -1;
      if (aQ && bQ) return (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0);
      return a.name.localeCompare(b.name);
    });
}

/**
 * The facts about one session that aren't already on the calendar row — the
 * coach's name, what he has said and done about turning up, anything he wrote
 * afterwards, and how many places were given back.
 *
 * Kept off `SessionRow` on purpose. That row's select string is duplicated
 * byte-for-byte in two files and is fetched for every session in a week, so
 * widening it to serve one open sheet would put all of this on a phone's wire
 * for sessions nobody is looking at.
 */
export type SessionDetail = {
  status: "scheduled" | "completed" | "cancelled";
  coachName: string | null;
  coachConfirmedAt: string | null;
  coachNotes: string | null;
  cancelReason: string | null;
  /** Places that were held and given back — the ones the roster can't show. */
  cancelledCount: number;
};

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return null;

  const { data: s } = await supabase
    .from("class_sessions")
    .select("status,coach_id,coach_notes,coach_confirmed_at,cancel_reason")
    .eq("id", sessionId)
    .maybeSingle();
  if (!s) return null;

  // Resolved from profiles rather than the sheet's `coaches` prop, which is
  // filtered to active coaches — a session still rostered to a coach who has
  // since been paused would otherwise show no name at all.
  const [{ data: prof }, { count }] = await Promise.all([
    s.coach_id
      ? supabase.from("profiles").select("full_name").eq("id", s.coach_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .in("status", ["cancelled_by_client", "cancelled_by_academy"]),
  ]);

  return {
    status: s.status as SessionDetail["status"],
    coachName: prof?.full_name ?? null,
    coachConfirmedAt: s.coach_confirmed_at,
    coachNotes: s.coach_notes,
    cancelReason: s.cancel_reason,
    cancelledCount: count ?? 0,
  };
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

  const [{ data: rawSessions }] = await Promise.all([
    supabase
      .from("class_sessions")
      .select(
        "id,starts_at,ends_at,status,cancel_reason,coach_id,coach_arrived_at,coach_arrival_source,coach_arrival_distance_m,capacity_override,classes!inner(id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,class_type,is_school,location_label,venues(name,address,postcode,lat,lng,address_details),private_class_details(client_id,address,postcode,lat,lng,access_notes,address_details,players(full_name)))"
      )
      // Cancelled included — see the note on the same query in page.tsx.
      .in("status", ["scheduled", "completed", "cancelled"])
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at"),
  ]);

  const privateClientIds = [
    ...new Set(
      (rawSessions ?? [])
        .map((s) => {
          const cls = s.classes;
          return cls.class_type === "private" ? (cls.private_class_details?.client_id ?? null) : null;
        })
        .filter((id): id is string => id !== null)
    ),
  ];

  const clientNameMap = new Map<string, string>();
  if (privateClientIds.length > 0) {
    const { data: privProfiles } = await supabase
      .from("profiles")
      .select("id,full_name")
      .in("id", privateClientIds);
    for (const p of privProfiles ?? []) clientNameMap.set(p.id, p.full_name);
  }

  const classTime = (classId: string, fallbackIso: string) => {
    const iso = nextByClass[classId] ?? fallbackIso;
    return utcToAcademyWall(new Date(iso)).time;
  };

  const sessions: SessionRow[] = (rawSessions ?? []).map((s) => {
    const cls = s.classes;
    const priv = cls.private_class_details;
    const address: StructuredAddress | null = cls.venues
      ? fromDetails(asAddressDetails(cls.venues.address_details), {
          address: cls.venues.address,
          postcode: cls.venues.postcode,
          lat: cls.venues.lat,
          lng: cls.venues.lng,
        })
      : priv
        ? fromDetails(asAddressDetails(priv.address_details), {
            address: priv.address,
            postcode: priv.postcode,
            lat: priv.lat,
            lng: priv.lng,
            access_notes: priv.access_notes,
          })
        : null;


    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      status: s.status,
      cancelReason: s.cancel_reason,
      coachId: s.coach_id,
      coachArrivedAt: s.coach_arrived_at,
      coachArrivalSource: s.coach_arrival_source,
      coachArrivalDistanceM: s.coach_arrival_distance_m,
      title: cls.title,
      capacity: s.capacity_override ?? cls.capacity,
      isPrivate: cls.class_type === "private",
      isSchool: cls.is_school,
      venueName: cls.location_label ?? null,
      playerName: priv?.client_id ? (clientNameMap.get(priv.client_id) ?? null) : null,
      privatePlayerName:
        (priv?.players as unknown as { full_name: string } | null)?.full_name ?? null,
      privateClientId: priv?.client_id ?? null,
      address,
      classId: cls.id,
      classActive: cls.active,
      classDescription: cls.description ?? "",
      classLevel: cls.skill_level,
      classCapacity: cls.capacity,
      classDuration: cls.duration_minutes,
      classVenueId: cls.venue_id,
      classWeekday: cls.recurrence_rule?.match(/BYDAY=(..)/)?.[1] ?? "MO",
      classTime: classTime(cls.id, s.starts_at),
      classSlotTime: slotByClass[cls.id] ?? null,
      classRecurring: !!cls.recurrence_rule,
    };
  });

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

  const [
    { data: classes },
    { count: oneOffCount },
    { data: coaches },
    { data: venues },
    { data: series },
  ] = await Promise.all([
    supabase
      .from("classes")
      .select(
        "id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,ends_on,venue_id,is_school,venues(name,unit)"
      )
      .eq("class_type", "group")
      .not("recurrence_rule", "is", null)
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
    supabase
      .from("private_booking_series")
      .select(
        "id,weekday,start_time,duration_minutes,preferred_coach,venue_id,venue_label," +
          "venues(name,unit)," +
          "player:players!private_booking_series_player_id_fkey(full_name)," +
          "client:profiles!private_booking_series_client_id_fkey(full_name)"
      )
      .eq("active", true),
  ]);

  const classIds = (classes ?? []).map((c) => c.id);
  const { data: nextSessions } = classIds.length
    ? await supabase
        .from("class_sessions")
        .select("id,class_id,starts_at,coach_id,coaches(profiles!inner(full_name))")
        .in("class_id", classIds)
        .eq("status", "scheduled")
        .gt("starts_at", new Date().toISOString())
        .order("starts_at")
    : {
        data: [] as {
          id: string;
          class_id: string;
          starts_at: string;
          coach_id: string | null;
          coaches: unknown;
        }[],
      };

  const nextByClass = new Map<
    string,
    { sessionId: string; starts_at: string; coachName: string | null; coachId: string | null }
  >();
  for (const s of nextSessions ?? []) {
    if (nextByClass.has(s.class_id)) continue;
    const coachName =
      (s.coaches as unknown as { profiles: { full_name: string } } | null)?.profiles?.full_name ??
      null;
    nextByClass.set(s.class_id, {
      sessionId: s.id,
      starts_at: s.starts_at,
      coachName,
      coachId: s.coach_id,
    });
  }

  // Ending a class cancels every future session, so the lookup above finds
  // nothing for one. Its own past sessions still hold the truth about its slot;
  // a hardcoded fallback here used to rewrite that slot on the next save.
  const slotlessIds = classIds.filter((id) => !nextByClass.has(id));
  const lastSessionsPromise = slotlessIds.length
    ? supabase
        .from("class_sessions")
        .select("class_id,starts_at")
        .in("class_id", slotlessIds)
        .order("starts_at", { ascending: false })
        .then((r) => r.data)
    : Promise.resolve(null);

  const seriesIds = ((series ?? []) as unknown as { id: string }[]).map((s) => s.id);
  const seriesBookingsPromise = seriesIds.length
    ? supabase
        .from("bookings")
        .select("private_series_id,class_sessions(id,starts_at,status)")
        .in("private_series_id", seriesIds)
        .then((r) => r.data)
    : Promise.resolve(null);

  const nextSessionIds = [...nextByClass.values()].map((n) => n.sessionId);
  const bookedBySession = new Map<string, number>();
  if (nextSessionIds.length) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("session_id")
      .in("session_id", nextSessionIds)
      .in("status", ["confirmed", "attended"]);
    for (const b of bookings ?? [])
      bookedBySession.set(b.session_id, (bookedBySession.get(b.session_id) ?? 0) + 1);
  }

  const lastByClass = new Map<string, string>();
  for (const s of (await lastSessionsPromise) ?? []) {
    if (!lastByClass.has(s.class_id)) lastByClass.set(s.class_id, s.starts_at);
  }

  const classRows: ClassRow[] = (classes ?? []).map((c) => {
    const next = nextByClass.get(c.id);
    const last = lastByClass.get(c.id);
    const time = next
      ? utcToAcademyWall(new Date(next.starts_at)).time
      : last
        ? utcToAcademyWall(new Date(last)).time
        : (timeFromTitle(c.title) ?? "18:30");
    const v = c.venues as unknown as { name: string; unit: string | null } | null;
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
      venueName: v ? venueDisplayName(v) : null,
      isSchool: c.is_school,
      coachName: next?.coachName ?? null,
      bookedCount: next ? (bookedBySession.get(next.sessionId) ?? 0) : 0,
      nextSessionId: next?.sessionId ?? null,
      nextSessionStart: next?.starts_at ?? null,
      nextCoachId: next?.coachId ?? null,
    };
  });

  const coachNameById = new Map(
    (coaches ?? []).map((c) => [
      c.id,
      (c.profiles as unknown as { full_name: string }).full_name,
    ])
  );

  type SeriesRow = {
    id: string;
    weekday: number;
    start_time: string;
    duration_minutes: number;
    preferred_coach: string | null;
    venue_id: string | null;
    venue_label: string | null;
    venues: { name: string; unit: string | null } | null;
    player: { full_name: string } | null;
    client: { full_name: string } | null;
  };
  const seriesRows = (series ?? []) as unknown as SeriesRow[];

  // Sessions link to a series through their booking's private_series_id, so the
  // deep-link target is the earliest scheduled future session across those.
  const nextBySeriesId = new Map<string, { id: string; starts_at: string }>();
  {
    const seriesBookings = await seriesBookingsPromise;
    const nowIso = new Date().toISOString();
    for (const b of seriesBookings ?? []) {
      const sid = b.private_series_id as string | null;
      const cs = b.class_sessions as unknown as {
        id: string;
        starts_at: string;
        status: string;
      } | null;
      if (!sid || !cs || cs.status !== "scheduled" || cs.starts_at <= nowIso) continue;
      const cur = nextBySeriesId.get(sid);
      if (!cur || cs.starts_at < cur.starts_at)
        nextBySeriesId.set(sid, { id: cs.id, starts_at: cs.starts_at });
    }
  }

  const knownVenueNames = new Set(
    (venues ?? []).map((v) => venueDisplayName(v).toLowerCase())
  );
  const isoWeekdayCode = WEEKDAYS.map(([code]) => code); // 0-based: [MO..SU]

  const privateSeries: PrivateSeriesRow[] = seriesRows.map((s) => {
    const venueName =
      (s.venues ? venueDisplayName(s.venues) : s.venue_label?.trim()) ?? "Private location";
    const next = nextBySeriesId.get(s.id);
    return {
      id: s.id,
      playerName: s.player?.full_name ?? "Player",
      clientName: s.client?.full_name ?? "",
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
