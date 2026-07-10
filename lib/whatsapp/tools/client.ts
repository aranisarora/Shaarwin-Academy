// Client tools — everything a member can do from /app, over chat instead.
// All queries run on ctx.supabase (the member's own session), so RLS and the
// booking RPCs enforce subscription, capacity, and household rules server-side.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowseSessions, getMyBookings } from "@/lib/booking";
import { getSubscriptionSummary } from "@/lib/billing";
import { getRazorpay } from "@/lib/razorpay";
import { geocode } from "@/lib/whatsapp/geocode";
import { fail, fmtIST, formatPricePence, ok, type ToolContext, type WaTool } from "./types";

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
    "Book one or more private sessions. Debits the user's private-minutes balance immediately (per session), so ALWAYS confirm the start time(s), duration, and address with the user before calling. starts_at takes an ISO timestamp from private_session_availability, or an array of them to book several slots at once.",
  input_schema: {
    type: "object",
    properties: {
      starts_at: {
        description:
          "ISO timestamp of the chosen slot, or an array of ISO timestamps to book several slots at once",
        oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
      },
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

    // One slot or several — each becomes its own session, booked earliest-first
    // so a partial run (minutes running out) keeps the soonest slots.
    const raw = input.starts_at;
    const starts = [
      ...new Set((Array.isArray(raw) ? raw : [raw]).map(String).filter((s) => s && s !== "undefined")),
    ].sort();
    if (starts.length === 0) return fail("Need at least one start time.");

    const booked: string[] = [];
    let stopped: string | undefined;
    for (const startsAt of starts) {
      const { error } = await ctx.supabase!.rpc("request_private_class", {
        payload: {
          player_id: player.id,
          duration_minutes: Number(input.duration_minutes),
          starts_at: startsAt,
          address: String(input.address),
          postcode: "",
          lat: geo.lat,
          lng: geo.lng,
          has_table: input.has_table ?? true,
          access_notes: input.access_notes ?? null,
        },
      });
      if (error) {
        // First slot failing hard = abort; later ones stop but keep successes.
        if (booked.length === 0) return fail(friendlyRpcError(error.message));
        stopped = friendlyRpcError(error.message);
        break;
      }
      booked.push(startsAt);
    }
    return ok({
      booked_count: booked.length,
      booked_slots: booked,
      stopped_reason: stopped,
      note: "Minutes debited per session. A coach is assigned automatically; the user will be notified.",
    });
  },
};

const listPlans: WaTool = {
  name: "list_membership_plans",
  description:
    "The membership plans the user could buy, with plan_id, price, weekly group allowance and quarterly private minutes. Use before sending a checkout link.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const { data } = await ctx.supabase!
      .from("plans")
      .select("id,name,description,price_pence,group_sessions_per_week,private_minutes_per_quarter")
      .eq("active", true)
      .order("price_pence");
    return ok(
      (data ?? []).map((p) => ({
        plan_id: p.id,
        name: p.name,
        description: p.description,
        price_per_quarter: formatPricePence(p.price_pence),
        group_sessions_per_week: p.group_sessions_per_week,
        private_minutes_per_quarter: p.private_minutes_per_quarter,
      }))
    );
  },
};

const checkoutLink: WaTool = {
  name: "send_membership_checkout_link",
  description:
    "Start buying/renewing a membership. Card payment can't happen in chat, so this creates a secure Razorpay checkout link the user taps to pay. plan_id from list_membership_plans. The membership activates automatically once payment succeeds.",
  input_schema: {
    type: "object",
    properties: { plan_id: { type: "string" } },
    required: ["plan_id"],
  },
  run: async (input, ctx) => {
    const razorpay = getRazorpay();
    if (!razorpay) return fail("Online payments aren't set up yet — please try the website.");
    const { data: plan } = await ctx.supabase!
      .from("plans")
      .select("id,name,razorpay_plan_id")
      .eq("id", input.plan_id)
      .eq("active", true)
      .maybeSingle();
    if (!plan?.razorpay_plan_id) return fail("That plan isn't available for checkout.");
    try {
      const sub = await razorpay.post<{ id: string; short_url?: string }>("/subscriptions", {
        plan_id: plan.razorpay_plan_id,
        total_count: 40,
        quantity: 1,
        customer_notify: 1,
        notes: {
          supabase_user_id: ctx.profile!.id,
          plan_id: plan.id,
          email: ctx.profile!.email,
          full_name: ctx.profile!.full_name,
        },
      });
      if (!sub.short_url) return fail("Couldn't create the checkout link — try the website.");
      return ok({
        plan: plan.name,
        checkout_url: sub.short_url,
        note: "Send them this link to complete payment. Membership activates automatically afterwards.",
      });
    } catch (err) {
      console.error("wa checkout link failed", err);
      return fail("Couldn't start checkout just now — try again shortly.");
    }
  },
};

const updateProfile: WaTool = {
  name: "update_profile",
  description:
    "Update the user's own name and/or default address. Use this to record a new member's name after they tell you.",
  input_schema: {
    type: "object",
    properties: {
      full_name: { type: "string" },
      default_address: { type: "string" },
    },
  },
  run: async (input, ctx) => {
    const patch: Record<string, string> = {};
    if (input.full_name != null && String(input.full_name).trim().length >= 2) {
      patch.full_name = String(input.full_name).trim();
    }
    if (input.default_address != null) {
      patch.default_address = String(input.default_address).trim();
    }
    if (Object.keys(patch).length === 0) return fail("Nothing valid to update.");
    const { error } = await ctx.supabase!.from("profiles").update(patch).eq("id", ctx.profile!.id);
    if (error) return fail("Couldn't save that.");
    // Keep the household's default player name in step with the account name.
    if (patch.full_name) {
      await ctx.supabase!
        .from("players")
        .update({ full_name: patch.full_name })
        .eq("client_id", ctx.profile!.id)
        .in("full_name", ["", "there"]);
    }
    return ok({ updated: Object.keys(patch) });
  },
};

const addPlayer: WaTool = {
  name: "add_player",
  description:
    "Add a household player (e.g. a child) to the account so they can be booked into sessions.",
  input_schema: {
    type: "object",
    properties: { full_name: { type: "string" } },
    required: ["full_name"],
  },
  run: async (input, ctx) => {
    const name = String(input.full_name ?? "").trim();
    if (name.length < 2) return fail("Need the player's name.");
    const { error } = await ctx.supabase!
      .from("players")
      .insert({ client_id: ctx.profile!.id, full_name: name });
    if (error) return fail("Couldn't add that player.");
    return ok({ added: name });
  },
};

const renamePlayer: WaTool = {
  name: "rename_player",
  description: "Rename a household player. Match the current name; confirm the new one.",
  input_schema: {
    type: "object",
    properties: {
      current_name: { type: "string" },
      new_name: { type: "string" },
    },
    required: ["current_name", "new_name"],
  },
  run: async (input, ctx) => {
    const player = await resolvePlayer(ctx, String(input.current_name));
    if ("error" in player) return fail(player.error);
    const newName = String(input.new_name ?? "").trim();
    if (newName.length < 2) return fail("Need a valid new name.");
    const { error } = await ctx.supabase!
      .from("players")
      .update({ full_name: newName })
      .eq("id", player.id);
    if (error) return fail("Couldn't rename that player.");
    return ok({ renamed_to: newName });
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
  listPlans,
  checkoutLink,
  updateProfile,
  addPlayer,
  renamePlayer,
];
