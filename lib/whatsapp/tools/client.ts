// Client tools — everything a member can do from /app, over chat instead.
// All queries run on ctx.supabase (the member's own session), so RLS and the
// booking RPCs enforce subscription, capacity, and household rules server-side.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { TableUpdate } from "@/lib/admin-ops-types";
import { getBrowseSessions, getMyBookings } from "@/lib/booking";
import { getSubscriptionSummary } from "@/lib/billing";
import { getRazorpay } from "@/lib/razorpay";
import { geocode } from "@/lib/whatsapp/geocode";
import { formatSessionDate, istDayBounds } from "@/lib/academy-time";
import { formatPrice } from "@/lib/format";
import { bulkTool } from "./bulk";
import { fail, ok, type ToolContext, type WaTool } from "./types";

const RPC_ERROR_COPY: Record<string, string> = {
  no_active_subscription: "No active membership — buy one on the website pricing page first.",
  no_entitlement:
    "No membership, free trial or drop-in class available. Offer the plans (list_membership_plans) or a one-off class (list_one_off_products).",
  recurring_needs_membership:
    "Weekly recurring bookings need a group membership — a trial or drop-in books a single session.",
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

async function householdPlayers(supabase: SupabaseClient<Database>, clientId: string) {
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
        when: formatSessionDate(b.session.starts_at),
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

/**
 * "Where is he?" — the live-status question a parent actually asks.
 *
 * The audit caught this conversation happening for real: a parent asked the bot
 * about their child mid-day and it had nothing to answer with, because
 * my_schedule only knows what was BOOKED, not what is HAPPENING. This tool adds
 * the three facts that make the difference — has the coach arrived, is the coach
 * running late, and has attendance been marked yet.
 *
 * Day bounds are IST, computed as absolute instants, so "today" means the
 * parent's today and not the server's. (notification-fix-plan, Bot changes.)
 */
const playerToday: WaTool = {
  name: "get_player_today",
  description:
    "Live status of the household's sessions TODAY: each player's sessions, whether the coach has confirmed/arrived or is running late, and attendance once the coach has marked it. Use this for any 'where is my child', 'has the coach arrived', 'did they attend', 'is the class on' question — my_schedule only shows what was booked, not what is happening.",
  input_schema: {
    type: "object",
    properties: {
      player_name: {
        type: "string",
        description: "Optional — narrow to one player when the household has several.",
      },
    },
  },
  run: async (input, ctx) => {
    const { start, end } = istDayBounds();

    const { data, error } = await ctx
      .supabase!.from("bookings")
      // One string literal on purpose: concatenation erases the literal type
      // PostgREST needs to infer the row shape.
      .select(
        "id,status,players(full_name),class_sessions!inner(id,starts_at,ends_at,coach_id,coach_confirmed_at,coach_arrived_at,classes!inner(title,location_label,venues(name)))"
      )
      .eq("client_id", ctx.profile!.id)
      .in("status", ["confirmed", "attended", "no_show", "waitlisted"])
      .gte("class_sessions.starts_at", start)
      .lt("class_sessions.starts_at", end);

    if (error) return fail("Couldn't read today's sessions.", error.message);

    type TodaySession = {
      id: string;
      starts_at: string;
      ends_at: string;
      coach_id: string | null;
      coach_confirmed_at: string | null;
      coach_arrived_at: string | null;
      classes: {
        title: string;
        location_label: string | null;
        venues: { name: string } | { name: string }[] | null;
      };
    };

    // Coach names via public_coach_roster(), not a direct profiles read: RLS
    // does not let a client see another member's profile row, so reading
    // profiles here returns null and the parent is told their coach has no
    // name. The roster function is SECURITY DEFINER and exposes exactly the
    // public coach fields, which is what a parent should see.
    const coachIds = new Set(
      (data ?? [])
        .map((b) => (b.class_sessions as unknown as TodaySession).coach_id)
        .filter((id): id is string => !!id)
    );
    const coachNames = new Map<string, string>();
    if (coachIds.size) {
      const { data: roster } = await ctx.supabase!.rpc("public_coach_roster");
      for (const c of roster ?? []) {
        if (coachIds.has(c.id)) coachNames.set(c.id, c.full_name ?? "");
      }
    }

    const wanted = String(input.player_name ?? "").trim().toLowerCase();
    const rows = (data ?? [])
      .map((b) => {
        const s = b.class_sessions as unknown as TodaySession;
        const player =
          (b.players as { full_name: string } | { full_name: string }[] | null) ?? null;
        const playerName = (Array.isArray(player) ? player[0]?.full_name : player?.full_name) ?? "";

        // Attendance is only meaningful once the coach has marked it; until
        // then say so explicitly rather than implying "not attended".
        const attendance =
          b.status === "attended"
            ? "attended"
            : b.status === "no_show"
              ? "marked absent"
              : "not marked yet";

        return {
          player: playerName,
          booking_status: b.status,
          session_id: s.id,
          title: s.classes.title,
          venue: s.classes.location_label ?? null,
          coach: s.coach_id ? (coachNames.get(s.coach_id) ?? null) : null,
          when: formatSessionDate(s.starts_at),
          starts_at: s.starts_at,
          started: new Date(s.starts_at).getTime() <= Date.now(),
          finished: new Date(s.ends_at).getTime() <= Date.now(),
          coach_confirmed: !!s.coach_confirmed_at,
          coach_arrived: !!s.coach_arrived_at,
          attendance,
        };
      })
      .filter((r) => !wanted || r.player.toLowerCase().includes(wanted))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

    if (!rows.length) {
      return ok({
        sessions: [],
        note: wanted
          ? `No sessions today for anyone matching "${input.player_name}".`
          : "Nobody in this household has a session today.",
      });
    }
    return ok({ sessions: rows });
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
    const sessions = await getBrowseSessions(ctx.supabase!, ctx.profile?.id ?? "", days);
    return ok(
      sessions.map((s) => ({
        session_id: s.id,
        when: formatSessionDate(s.starts_at),
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
    "Book a group session (session_id from browse_group_sessions). Works with a group membership, an unused free trial (every child's first class is free — tell the user!), or a purchased drop-in class. Confirm the exact session with the user before calling. If the session is full the booking lands on the waitlist.",
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
  name: "cancel_bookings",
  description:
    "Cancel one or more of the user's bookings (booking_ids from my_schedule) — 'cancel everything next week, we're away' is one call with all of them. Always read the list back and confirm first, and warn that cancelling under 24h before start counts as late.",
  input_schema: {
    type: "object",
    properties: {
      booking_ids: {
        type: "array",
        items: { type: "string" },
        description: "One or more booking ids",
      },
    },
    required: ["booking_ids"],
  },
  run: async (input, ctx) =>
    bulkTool(
      input.booking_ids ?? input.booking_id,
      async (id) => {
        const { error } = await ctx.supabase!.rpc("cancel_booking", { p_booking: id });
        // Decode per booking, not per call: one late cancellation shouldn't
        // hide behind a generic batch error, and "under the 24h window" is the
        // difference between a useful sentence and a constraint violation.
        return error ? { ok: false, error: friendlyRpcError(error.message) } : { ok: true };
      },
      { noun: "booking" }
    ),
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
    "The user's memberships (group and/or private plan), renewal dates, remaining private-coaching minutes, unused free trials and drop-in classes.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const summary = await getSubscriptionSummary(ctx.supabase!, ctx.profile!.id);
    const players = await householdPlayers(ctx.supabase!, ctx.profile!.id);
    // Account-level trial is usable by any household player.
    const trialNames = summary.hasAccountTrial
      ? players.map((p) => p.full_name)
      : players
          .filter((p) => summary.openTrialPlayerIds.includes(p.id))
          .map((p) => p.full_name);
    return ok({
      active: summary.active,
      group_plan: summary.groupPlan
        ? {
            plan: summary.groupPlan.planName,
            status: summary.groupPlan.status,
            renews: summary.groupPlan.periodEnd ? formatSessionDate(summary.groupPlan.periodEnd) : null,
            cancels_at_period_end: summary.groupPlan.cancelAtPeriodEnd,
          }
        : null,
      private_plan: summary.privatePlan
        ? {
            plan: summary.privatePlan.planName,
            status: summary.privatePlan.status,
            renews: summary.privatePlan.periodEnd ? formatSessionDate(summary.privatePlan.periodEnd) : null,
            cancels_at_period_end: summary.privatePlan.cancelAtPeriodEnd,
          }
        : null,
      private_minutes_left: summary.minutesBalance,
      unused_free_trials: trialNames,
      unused_dropin_classes: summary.dropinCredits,
      note: summary.active
        ? undefined
        : trialNames.length > 0
          ? `The first group class is free for ${trialNames.join(" and ")} — no payment needed, just book it. Make sure the user knows this is a free trial.`
          : "No active membership — offer the plans (monthly, cancel anytime) or a one-off class.",
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
      duration_minutes: { type: "number", description: "60 or 90 (sessions come in those two lengths)" },
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
      p_duration: Number(input.duration_minutes) === 90 ? 90 : 60,
      p_player: player.id,
      p_days: Math.min(Math.max(Number(input.days) || 7, 1), 14),
    });
    if (error) return fail(friendlyRpcError(error.message));

    const slots = (data as { starts_at: string; coach_count: number }[]) ?? [];
    return ok({
      resolved_address: geo.place,
      slots: slots.slice(0, 40).map((s) => ({ starts_at: s.starts_at, when: formatSessionDate(s.starts_at) })),
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
      duration_minutes: { type: "number", description: "60 or 90" },
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
          duration_minutes: Number(input.duration_minutes) === 90 ? 90 : 60,
          starts_at: startsAt,
          address: String(input.address),
          postcode: "",
          lat: geo.lat,
          lng: geo.lng,
          has_table: input.has_table ?? true,
          access_notes: input.access_notes ?? null,
          // Minimal structured snapshot from the geocode so bot-booked
          // sessions render through the same shared address display.
          address_details: {
            formatted: geo.place ?? String(input.address),
            lat: geo.lat,
            lng: geo.lng,
            accessNotes: input.access_notes ?? null,
            label: "home",
          },
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
    "The monthly membership plans the user could buy: group plans (1/2/3 classes a week) and private plans (a weekly home session, metered in minutes). Billed monthly, cancel anytime. Use before sending a checkout link. For sustained training beyond these plans (e.g. private more than twice a week), hand off to the founder on WhatsApp rather than refusing.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const { data } = await ctx.supabase!
      .from("plans")
      .select("id,name,description,price_pence,group_sessions_per_week,private_minutes_per_cycle")
      .eq("active", true)
      .order("price_pence");
    return ok(
      (data ?? []).map((p) => ({
        plan_id: p.id,
        name: p.name,
        description: p.description,
        price_per_month: formatPrice(p.price_pence),
        kind:
          p.group_sessions_per_week === 0
            ? "private"
            : "group",
        group_sessions_per_week: p.group_sessions_per_week,
        private_minutes_per_month: p.private_minutes_per_cycle,
      }))
    );
  },
};

const listOneOffs: WaTool = {
  name: "list_one_off_products",
  description:
    "One-off purchases that need no membership: a drop-in group class, single private sessions (60 min), and the discounted intro private session (a promotion, one per child — make sure the user knows it's a promo). Group members get member pricing on private sessions. Use before sending a payment link.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const [{ data: products }, { data: isMember }] = await Promise.all([
      ctx.supabase!
        .from("products")
        .select("id,name,description,kind,price_pence,member_price_pence")
        .eq("active", true)
        .order("price_pence"),
      ctx.supabase!.rpc("has_group_subscription", { p_client: ctx.profile!.id }),
    ]);
    return ok(
      (products ?? []).map((p) => {
        const amount =
          isMember && p.member_price_pence !== null && p.member_price_pence < p.price_pence
            ? p.member_price_pence
            : p.price_pence;
        return {
          product_id: p.id,
          name: p.name,
          description: p.description,
          kind: p.kind,
          price: formatPrice(amount),
          member_price_applied: amount < p.price_pence,
          is_promo: p.kind === "private_intro",
        };
      })
    );
  },
};

const oneOffPaymentLink: WaTool = {
  name: "send_one_off_payment_link",
  description:
    "Create a secure Razorpay payment link for a one-off purchase (product_id from list_one_off_products). The purchase is credited automatically once paid: a drop-in becomes a bookable class credit; private sessions become private minutes. The intro promo needs player_name (one per child). ALWAYS confirm the product and price with the user first.",
  input_schema: {
    type: "object",
    properties: {
      product_id: { type: "string" },
      player_name: {
        type: "string",
        description: "Required for the intro promo; optional otherwise",
      },
    },
    required: ["product_id"],
  },
  run: async (input, ctx) => {
    const razorpay = getRazorpay();
    if (!razorpay) return fail("Online payments aren't set up yet — please try the website.");

    const { data: product } = await ctx.supabase!
      .from("products")
      .select("id,name,kind,price_pence,member_price_pence")
      .eq("id", input.product_id)
      .eq("active", true)
      .maybeSingle();
    if (!product) return fail("That product isn't available.");

    let playerId: string | null = null;
    if (product.kind === "private_intro" || input.player_name) {
      const player = await resolvePlayer(ctx, input.player_name);
      if ("error" in player) return fail(player.error);
      playerId = player.id;
    }

    if (product.kind === "private_intro" && playerId) {
      const { data: prior } = await ctx.supabase!
        .from("orders")
        .select("id, products!inner(kind)")
        .eq("player_id", playerId)
        .eq("status", "paid")
        .eq("products.kind", "private_intro")
        .limit(1);
      if (prior && prior.length > 0) {
        return fail("The intro offer has already been used for that child — offer the regular one-off sessions instead.");
      }
    }

    const { data: isMember } = await ctx.supabase!.rpc("has_group_subscription", {
      p_client: ctx.profile!.id,
    });
    const amount =
      isMember && product.member_price_pence !== null && product.member_price_pence < product.price_pence
        ? product.member_price_pence
        : product.price_pence;

    try {
      // Payment link notes flow through to the payment entity; the webhook's
      // payment.captured handler fulfils from them.
      const link = await razorpay.post<{ short_url?: string }>("/payment_links", {
        amount,
        currency: "INR",
        description: `Sharwin TTA — ${product.name}`,
        customer: { name: ctx.profile!.full_name, email: ctx.profile!.email },
        notes: {
          supabase_user_id: ctx.profile!.id,
          product_id: product.id,
          player_id: playerId ?? "",
        },
      });
      if (!link.short_url) return fail("Couldn't create the payment link — try the website.");
      return ok({
        product: product.name,
        amount: formatPrice(amount),
        payment_url: link.short_url,
        note: "Send them this link. The class credit / minutes appear on their account automatically once paid.",
      });
    } catch (err) {
      console.error("wa one-off payment link failed", err);
      return fail("Couldn't create the payment link just now — try again shortly.");
    }
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
      // 100 monthly cycles ≈ "until cancelled" (Razorpay needs a finite count).
      const sub = await razorpay.post<{ id: string; short_url?: string }>("/subscriptions", {
        plan_id: plan.razorpay_plan_id,
        total_count: 100,
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
    const patch: TableUpdate<"profiles"> = {};
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
  playerToday,
  browseSessions,
  bookGroup,
  cancelBooking,
  rescheduleBooking,
  membership,
  privateSlots,
  bookPrivate,
  listPlans,
  listOneOffs,
  checkoutLink,
  oneOffPaymentLink,
  updateProfile,
  addPlayer,
  renamePlayer,
];
