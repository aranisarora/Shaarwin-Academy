// Tools available to unlinked phone numbers: public academy info, account
// linking, and in-chat signup. Nothing here can read another user's data —
// the admin client is used only for public catalogue reads and the identity
// handshakes in lib/whatsapp/identity.ts.

import { consumeLinkCode, signUpNewClient } from "@/lib/whatsapp/identity";
import { getBrowseSessions } from "@/lib/booking";
import { fail, fmtIST, formatPricePence, ok, type WaTool } from "./types";

export const academyInfo: WaTool = {
  name: "get_academy_info",
  description:
    "Public info about Sharwin Table Tennis Academy: membership plans with prices, venues, and the group sessions running over the next 7 days. Use for any general question about the academy, prices, or timetable.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const [{ data: plans }, { data: venues }, sessions] = await Promise.all([
      ctx.admin
        .from("plans")
        .select("id,name,description,price_pence,group_sessions_per_week,private_minutes_per_quarter")
        .eq("active", true)
        .order("price_pence"),
      ctx.admin
        .from("venues")
        .select("id,name,address,postcode")
        .eq("active", true),
      getBrowseSessions(ctx.admin, 7),
    ]);

    return ok({
      plans: (plans ?? []).map((p) => ({
        plan_id: p.id,
        name: p.name,
        description: p.description,
        price_per_quarter: formatPricePence(p.price_pence),
        group_sessions_per_week: p.group_sessions_per_week,
        private_minutes_per_quarter: p.private_minutes_per_quarter,
      })),
      venues: venues ?? [],
      next_7_days_group_sessions: sessions.map((s) => ({
        session_id: s.id,
        when: fmtIST(s.starts_at),
        title: s.classTitle,
        level: s.level,
        venue: s.venue?.name ?? null,
        coach: s.coachName,
        seats_left: Math.max(0, s.capacity - s.confirmed),
      })),
    });
  },
};

export const linkAccount: WaTool = {
  name: "link_account",
  description:
    "Link this WhatsApp number to an existing academy account using the one-time code the user generated in the webapp (looks like TT-XXXXXX). Ask for the code if they say they already have an account.",
  input_schema: {
    type: "object",
    properties: {
      code: { type: "string", description: "The link code, e.g. TT-4F7K2N" },
    },
    required: ["code"],
  },
  run: async (input, ctx) => {
    const result = await consumeLinkCode(ctx.admin, String(input.code ?? ""), ctx.phone);
    if (!result.ok) {
      const copy: Record<string, string> = {
        code_not_found: "That code wasn't recognised. Codes look like TT-XXXXXX.",
        code_already_used: "That code was already used. Generate a fresh one in the webapp.",
        code_expired: "That code has expired (they last 15 minutes). Generate a fresh one in the webapp.",
      };
      return fail(copy[result.error] ?? "Linking failed.");
    }
    return ok({
      linked: true,
      note: "Account linked. The user's next message will be handled with their account active — greet them by name and offer help.",
    });
  },
};

export const signUp: WaTool = {
  name: "sign_up_new_client",
  description:
    "Create a brand-new client account for this WhatsApp number. Use only after collecting BOTH full name and email address, and after the user confirms they don't already have an account.",
  input_schema: {
    type: "object",
    properties: {
      full_name: { type: "string" },
      email: { type: "string" },
    },
    required: ["full_name", "email"],
  },
  run: async (input, ctx) => {
    const name = String(input.full_name ?? "").trim();
    if (name.length < 2) return fail("Full name looks empty.");
    const result = await signUpNewClient(ctx.admin, ctx.phone, name, String(input.email ?? ""));
    if (!result.ok) {
      const copy: Record<string, string> = {
        invalid_email: "That email doesn't look valid.",
        email_taken:
          "An account with that email already exists. They should generate a link code from the webapp profile page instead (or use 'forgot password' to get back in).",
        signup_failed: "Signup failed — try again in a moment.",
      };
      return fail(copy[result.error] ?? "Signup failed.");
    }
    if (result.role === "coach") {
      return ok({
        created: true,
        note: "Account created as a coach (they were on the invite list) and this number is now linked. Their next message will be handled with coach tools — greet them and offer their schedule, rosters and availability.",
      });
    }
    return ok({
      created: true,
      note: "Account created and this number is now linked. They can browse sessions right away; to book they'll need a membership (payments happen on the website pricing page).",
    });
  },
};

export const guestTools: WaTool[] = [academyInfo, linkAccount, signUp];
