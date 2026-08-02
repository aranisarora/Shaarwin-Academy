"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireFounder } from "@/lib/founder";
import { academyWallToUtc, formatDate, utcToAcademyWall } from "@/lib/academy-time";
import { asAddressDetails, fromDetails, type StructuredAddress } from "@/lib/address";
import type { SessionRow } from "@/components/app/admin-calendar-types";
import {
  assignPrivateSessionClientCore,
  bulkRemoveClassesCore,
  cancelFuturePrivateSessionsCore,
  createOneOffClassCore,
  createPrivateSessionCore,
  deleteGroupClassCore,
  planClassRemovalCore,
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
//   cancelAllFuturePrivateSessions ... notifies the client
//   reassignClassCoach ............... notifies the coach(es)
//   deleteGroupClass ................. notifies nobody (only unbooked classes delete)
//   planClassRemoval ................. notifies nobody (read-only preview)
//   bulkRemoveClasses ................ deletes notify nobody; the classes it *ends* notify
//                                      everyone booked + their coaches, ONE message each no
//                                      matter how many classes went (see endGroupClassesCore)
//   topUpSessions .................... notifies nobody
//   createOneOffClass ................ notifies nobody (nothing booked yet)
//   addSchoolPlayer .................. notifies nobody
//   createPrivateSession ............. notifies the client
//   assignPrivateSessionClient ....... notifies the client
//   createPrivateSessionForInvite .... notifies the client
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
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await moveSessionCore(supabase, founder.id, sessionId, date, time);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
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

export async function updateGroupClass(input: ClassUpdate): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await updateGroupClassCore(supabase, founder.id, input);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
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

export async function deleteGroupClass(classId: string): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await deleteGroupClassCore(supabase, founder.id, classId);
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

/** What a bulk removal would do, so the confirm step can say it out loud. */
export async function planClassRemoval(
  classIds: string[]
): Promise<Result & { deletable?: string[]; booked?: string[] }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const plan = await planClassRemovalCore(supabase, classIds);
  return { ok: true, ...plan };
}

/** Clear a selection of weekly classes — delete the unbooked, optionally end
 * the rest (which messages everyone booked, exactly as ending one does). */
export async function bulkRemoveClasses(
  classIds: string[],
  endBooked: boolean
): Promise<Result & { deleted?: number; ended?: number; kept?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await bulkRemoveClassesCore(supabase, founder.id, classIds, endBooked);
  if (!result.ok) return result;
  refresh();
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
  playerId?: string,
  overridePlanLimits = false
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await assignPrivateSessionClientCore(
    supabase,
    founder.id,
    sessionId,
    clientId,
    playerId,
    overridePlanLimits
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
  /** "attended" = present, "no_show" = absent, "confirmed" = unmarked. */
  status: "confirmed" | "attended" | "no_show";
};

/** Who's booked on a session and whether they were marked present or absent —
 * shown in the admin session sheet. */
export async function getSessionRoster(sessionId: string): Promise<RosterEntry[]> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return [];
  const { data } = await supabase
    .from("bookings")
    .select("id,status,players(full_name)")
    .eq("session_id", sessionId)
    .in("status", ["confirmed", "attended", "no_show"]);
  return (data ?? [])
    .map((b) => ({
      id: b.id,
      name:
        b.players?.full_name ?? "Unknown player",
      status: b.status as RosterEntry["status"],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Week data for client-side navigation ─────────────────────────────────────


/**
 * Fetches the 7-day window of sessions starting on `anchor` (a "YYYY-MM-DD"
 * academy wall date) and maps them to SessionRow[]. Called by AdminCalendarNav
 * for client-side navigation — avoids a full page reload and only re-fetches
 * the window-specific session data.
 *
 * nextByClass is the class-id → next-session-ISO map computed on initial page
 * load and passed down as a plain object (serialisable over the wire).
 */
export async function fetchWeekSessions(
  anchor: string,
  nextByClass: Record<string, string>
): Promise<{ sessions: SessionRow[]; rangeLabel: string }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { sessions: [], rangeLabel: "" };

  const from = academyWallToUtc(anchor, "00:00");
  const to = new Date(from.getTime() + 7 * 86400000);

  const [{ data: rawSessions }] = await Promise.all([
    supabase
      .from("class_sessions")
      .select(
        "id,starts_at,ends_at,coach_id,coach_arrived_at,coach_arrival_source,coach_arrival_distance_m,capacity_override,classes!inner(id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,class_type,is_school,location_label,venues(name,address,postcode,lat,lng,address_details),private_class_details(client_id,address,postcode,lat,lng,access_notes,address_details))"
      )
      .in("status", ["scheduled", "completed"])
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
      classRecurring: !!cls.recurrence_rule,
    };
  });

  const rangeLabel = `${formatDate(from)} – ${formatDate(to.getTime() - 86400000)}`;

  return { sessions, rangeLabel };
}
