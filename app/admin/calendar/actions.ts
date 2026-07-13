"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/founder";
import { utcToAcademyWall } from "@/lib/academy-time";
import { fromDetails, type StructuredAddress } from "@/lib/address";
import type { SessionRow } from "@/components/app/admin-calendar-types";
import {
  cancelFuturePrivateSessionsCore,
  createOneOffSessionCore,
  createPrivateSessionCore,
  deleteGroupClassCore,
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
  type PrivateSessionInput,
} from "@/lib/admin-ops";

type Result = { ok: boolean; error?: string; code?: string };

function refresh() {
  revalidatePath("/admin/calendar");
  revalidatePath("/admin");
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

export async function topUpSessions(): Promise<Result & { created?: number }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await topUpSessionsCore(supabase, founder.id);
  if (!result.ok) return result;
  refresh();
  return { ok: true, created: result.created };
}

// ── Adding to the calendar ───────────────────────────────────────────────────

export async function createOneOffSession(
  classId: string,
  date: string,
  time: string,
  coachId: string
): Promise<Result> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { ok: false, error: "Founder only." };
  const result = await createOneOffSessionCore(supabase, founder.id, classId, date, time, coachId);
  if (!result.ok) return result;
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
  revalidatePath("/admin/clients");
  return { ok: true };
}

// ── Week data for client-side navigation ─────────────────────────────────────

type PrivDetail = {
  client_id: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  access_notes: string | null;
  address_details: Partial<StructuredAddress> | null;
};
type ClsShape = {
  id: string;
  title: string;
  description: string | null;
  skill_level: string;
  capacity: number;
  duration_minutes: number;
  recurrence_rule: string | null;
  active: boolean;
  venue_id: string | null;
  class_type: string;
  venues: {
    name: string;
    address: string;
    postcode: string;
    lat: number;
    lng: number;
    address_details: Partial<StructuredAddress> | null;
  } | null;
  private_class_details: PrivDetail | PrivDetail[] | null;
};

function privOf(cls: ClsShape): PrivDetail | null {
  const d = cls.private_class_details;
  return Array.isArray(d) ? (d[0] ?? null) : (d ?? null);
}

/**
 * Fetches sessions for a given week offset and maps them to SessionRow[].
 * Called by AdminCalendarNav for client-side week navigation — avoids a full
 * page reload and only re-fetches the week-specific session data.
 *
 * nextByClass is the class-id → next-session-ISO map computed on initial page
 * load and passed down as a plain object (serialisable over the wire).
 */
export async function fetchWeekSessions(
  weekOffset: number,
  nextByClass: Record<string, string>
): Promise<{ sessions: SessionRow[]; rangeLabel: string }> {
  const { supabase, founder } = await requireFounder();
  if (!founder) return { sessions: [], rangeLabel: "" };

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() + weekOffset * 7);
  const to = new Date(from.getTime() + 7 * 86400000);

  const { data: rawSessions } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,ends_at,coach_id,coach_arrived_at,capacity_override,classes!inner(id,title,description,skill_level,capacity,duration_minutes,recurrence_rule,active,venue_id,class_type,venues(name,address,postcode,lat,lng,address_details),private_class_details(client_id,address,postcode,lat,lng,access_notes,address_details))"
    )
    .eq("status", "scheduled")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at");

  const privateClientIds = [
    ...new Set(
      (rawSessions ?? [])
        .map((s) => {
          const cls = s.classes as unknown as ClsShape;
          return cls.class_type === "private" ? (privOf(cls)?.client_id ?? null) : null;
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
    const cls = s.classes as unknown as ClsShape;
    const priv = privOf(cls);
    const address: StructuredAddress | null = cls.venues
      ? fromDetails(cls.venues.address_details, {
          address: cls.venues.address,
          postcode: cls.venues.postcode,
          lat: cls.venues.lat,
          lng: cls.venues.lng,
        })
      : priv
        ? fromDetails(priv.address_details, {
            address: priv.address,
            postcode: priv.postcode,
            lat: priv.lat,
            lng: priv.lng,
            access_notes: priv.access_notes,
          })
        : null;

    const privLocationName = priv
      ? (priv.address_details?.name ??
          (priv.address.includes(",")
            ? priv.address.split(",")[0].trim()
            : priv.address) ??
          null)
      : null;

    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      coachId: s.coach_id,
      coachArrivedAt: s.coach_arrived_at,
      title: cls.title,
      capacity: s.capacity_override ?? cls.capacity,
      isPrivate: cls.class_type === "private",
      venueName: cls.venues?.name ?? privLocationName,
      playerName: priv ? (clientNameMap.get(priv.client_id) ?? null) : null,
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
    };
  });

  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const rangeLabel = `${fmt.format(from)} – ${fmt.format(new Date(to.getTime() - 86400000))}`;

  return { sessions, rangeLabel };
}
