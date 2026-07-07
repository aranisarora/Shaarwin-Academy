// Client tools — everything a member can do from /app, over chat instead.
// All queries run on ctx.supabase (the member's own session), so RLS and the
// booking RPCs enforce subscription, capacity, and household rules server-side.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowseSessions, getMyBookings } from "@/lib/booking";
import { getSubscriptionSummary } from "@/lib/billing";
import { fail, fmtIST, ok, type ToolContext, type WaTool } from "./types";

const RPC_ERROR_COPY: Record<string, string> = {
  no_active_subscription: "No active membership — buy one on the website pricing page first.",
  weekly_cap_reached: "The weekly group-session allowance is used up for that week.",
  session_not_bookable: "That session can't be booked any more (too close to start, or not scheduled).",
  player_double_booked: "That player already has a session at that time.",
  player_not_in_household: "That player isn't in this household.",
  already_booked: "Already booked into that session.",
  insufficient_minutes: "Not enough private-coaching minutes left.",
  lead_time_24h: "Private sessions need at least 24 hours' notice.",
  cancellation_window: "Too late to cancel this one for free.",
  not_authenticated: "Session problem — ask them to re-link their account.",
};

function friendlyRpcError(message: string): string {
  const key = Object.keys(RPC_ERROR_COPY).find((k) => message.includes(k));
  return key ? RPC_ERROR_COPY[key] : `The action failed: ${message}`;
}

async function householdPlayers(supabase: SupabaseClient, clientId: string) {
  const { data } = await supabase
    .from("players")
    .select("id,full_name")
    .eq("client_id", clientId);
  return data ?? [];
}

/** Pick the player: by name when given, otherwise only if unambiguous. */
async function resolvePlayer(
  ctx: ToolContext,
  playerName?: string
): Promise<{ id: string } | { error: string }> {
  const players = await householdPlayers(ctx.supabase!, ctx.profile!.id);
  if (players.length === 0) return { error: "No players found on this account." };
  if (playerName) {
    const needle = playerName.trim().toLowerCase();
    const match = players.filter((p) => p.full_name.toLowerCase().includes(needle));
    if (match.length === 1) return { id: match[0].id };
    return {
      error: `Couldn't uniquely match "${playerName}". Players on this account: ${players.map((p) => p.full_name).join(", ")}.`,
    };
  }
  if (players.length === 1) return { id: players[0].id };
  return {
    error: `Multiple players on this account — ask which one: ${players.map((p) => p.full_name).join(", ")}.`,
  };
}

async function geocode(address: string): Promise<{ lat: number; lng: number; place: string } | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!token) return null;
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?limit=1&access_token=${token}`
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    features?: { center: [number, number]; place_name: string }[];
  };
  const hit = json.features?.[0];
  return hit ? { lat: hit.center[1], lng: hit.center[0], place: hit.place_name } : null;
}

const mySchedule: WaTool = {
  name: "my_schedule",
  description:
    "The user's upcoming and recent bookings (group and private), including booking_id values needed for cancelling or rescheduling.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const bookings = await getMyBookings(ctx.supabase!, ctx.profile!.id);
    return ok(
      bookings.map((b) => ({
        booking_id: b.id,
        status: b.status,
        waitlist_position: b.waitlist_position,
        player: b.playerName,
        when: fmtIST(b.session.starts_at),
        starts_at: b.session.starts_at,
        title: b.session.classTitle,
        type: b.session.isPrivate ? "private" : "group",
        venue: b.session.venueName,
        coach: b.session.coachName,
        session_id: b.session.id,
      }))
    );
  },
};

const browseSessions: WaTool = {
  name: "browse_group_sessions",
  description:
    "Upcoming group sessions the user could book, with seats left and session_id values. Default window is 7 days (max 28).",
  input_schema: {
    type: "object",
    properties: {
      days: { type: "number", description: "How many days ahead to look (default 7)" },
    },
  },
  run: async (input, ctx) => {
    const days = Math.min(Math.max(Number(input.days) || 7, 1), 28);
    const sessions = await getBrowseSessions(ctx.supabase!, days);
    return ok(
      sessions.map((s) => ({
        session_id: s.id,
        when: fmtIST(s.starts_at),
        starts_at: s.starts_at,
        title: s.classTitle,
        level: s.level,
        duration_minutes: s.durationMinutes,
        venue: s.venue?.name ?? null,
        coach: s.coachName,
        seats_left: Math.max(0, s.capacity - s.confirmed),
      }))
    );
  },
};

const bookGroup: WaTool = {
  name: "book_group_session",
  description:
    "Book a group session (session_id from browse_group_sessions). Confirm the exact session with the user before calling. If the session is full the booking lands on the waitlist.",
  input_schema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      player_name: {
        type: "string",
        description: "Which household player, if the account has more than one",
      },
    },
    required: ["session_id"],
  },
  run: async (input, ctx) => {
    const player = await resolvePlayer(ctx, input.player_name);
    if ("error" in player) return fail(player.error);
    const { data, error } = await ctx.supabase!.rpc("book_session", {
      p_session: input.session_id,
      p_player: player.id,
    });
    if (error) return fail(friendlyRpcError(error.message));
    return ok({ booking_id: data.id, status: data.status });
  },
};

const cancelBooking: WaTool = {
  name: "cancel_booking",
  description:
    "Cancel one of the user's bookings (booking_id from my_schedule). Always confirm with the user first, and warn that cancelling under 24h before start counts as late.",
  input_schema: {
    type: "object",
    properties: { booking_id: { type: "string" } },
    required: ["booking_id"],
  },
  run: async (input, ctx) => {
    const { error } = await ctx.supabase!.rpc("cancel_booking", {
      p_booking: input.booking_id,
    });
    if (error) return fail(friendlyRpcError(error.message));
    return ok({ cancelled: true });
  },
};

const rescheduleBooking: WaTool = {
  name: "reschedule_booking",
  description:
    "Move a group booking to a different session (booking_id from my_schedule, target session_id from browse_group_sessions). Confirm both with the user first.",
  input_schema: {
    type: "object",
    properties: {
      booking_id: { type: "string" },
      target_session_id: { type: "string" },
    },
    required: ["booking_id", "target_session_id"],
  },
  run: async (input, ctx) => {
    const { data, error } = await ctx.supabase!.rpc("reschedule_booking", {
      p_booking: input.booking_id,
      p_target_session: input.target_session_id,
    });
    if (error) return fail(friendlyRpcError(error.message));
    return ok({ new_booking: data });
  },
};

const membership: WaTool = {
  name: "membership_status",
  description:
    "The user's membership: plan, renewal date, whether it's active, and remaining private-coaching minutes.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const summary = await getSubscriptionSummary(ctx.supabase!, ctx.profile!.id);
    return ok({
      active: summary.active,
      status: summary.status,
      plan: summary.planName,
      renews: summary.periodEnd ? fmtIST(summary.periodEnd) : null,
      cancels_at_period_end: summary.cancelAtPeriodEnd,
      private_minutes_left: summary.minutesBalance,
      note: summary.active
        ? undefined
        : "No active membership — plans are on the website pricing page (payments can't be taken in chat).",
    });
  },
};

const privateSlots: WaTool = {
  name: "private_session_availability",
  description:
    "Find available start times for a private session at the user's home/venue address. Needs a duration in minutes and an address (falls back to the profile's default address).",
  input_schema: {
    type: "object",
    properties: {
      duration_minutes: { type: "number", description: "e.g. 60" },
      address: { type: "string", description: "Where the session happens" },
      days: { type: "number", description: "Days ahead to search (default 7, max 14)" },
      player_name: { type: "string" },
    },
    required: ["duration_minutes"],
  },
  run: async (input, ctx) => {
    const address = (input.address as string) || ctx.profile!.default_address;
    if (!address) return fail("Need an address — ask where the session should happen.");
    const geo = await geocode(address);
    if (!geo) return fail("Couldn't locate that address — ask for a fuller address or postcode.");
    const player = await resolvePlayer(ctx, input.player_name);
    if ("error" in player) return fail(player.error);

    const { data, error } = await ctx.supabase!.rpc("get_bookable_slots", {
      p_lat: geo.lat,
      p_lng: geo.lng,
      p_duration: Math.max(30, Number(input.duration_minutes) || 60),
      p_player: player.id,
      p_days: Math.min(Math.max(Number(input.days) || 7, 1), 14),
    });
    if (error) return fail(friendlyRpcError(error.message));

    const slots = (data as { starts_at: string; coach_count: number }[]) ?? [];
    return ok({
      resolved_address: geo.place,
      slots: slots.slice(0, 40).map((s) => ({ starts_at: s.starts_at, when: fmtIST(s.starts_at) })),
      note: slots.length > 40 ? `${slots.length - 40} more slots not shown.` : undefined,
    });
  },
};

const bookPrivate: WaTool = {
  name: "book_private_session",
  description:
    "Book a private session. Debits the user's private-minutes balance immediately, so ALWAYS confirm start time, duration, and address with the user before calling. starts_at must be an ISO timestamp from private_session_availability.",
  input_schema: {
    type: "object",
    properties: {
      starts_at: { type: "string", description: "ISO timestamp of the chosen slot" },
      duration_minutes: { type: "number" },
      address: { type: "string" },
      player_name: { type: "string" },
      access_notes: { type: "string", description: "Entry instructions, if any" },
      has_table: { type: "boolean", description: "Does the address have a table? Default true" },
    },
    required: ["starts_at", "duration_minutes", "address"],
  },
  run: async (input, ctx) => {
    const geo = await geocode(String(input.address));
    if (!geo) return fail("Couldn't locate that address.");
    const player = await resolvePlayer(ctx, input.player_name);
    if ("error" in player) return fail(player.error);

    const { data, error } = await ctx.supabase!.rpc("request_private_class", {
      payload: {
        player_id: player.id,
        duration_minutes: Number(input.duration_minutes),
        starts_at: input.starts_at,
        address: String(input.address),
        postcode: "",
        lat: geo.lat,
        lng: geo.lng,
        has_table: input.has_table ?? true,
        access_notes: input.access_notes ?? null,
      },
    });
    if (error) return fail(friendlyRpcError(error.message));
    return ok({
      booked: true,
      booking_id: data,
      note: "Minutes debited. A coach is assigned automatically; the user will be notified.",
    });
  },
};

export const clientTools: WaTool[] = [
  mySchedule,
  browseSessions,
  bookGroup,
  cancelBooking,
  rescheduleBooking,
  membership,
  privateSlots,
  bookPrivate,
];
