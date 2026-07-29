// Tools that need no account: public academy info. Unknown numbers are
// auto-provisioned a client account before the agent runs, so "guest" only
// occurs defensively (e.g. a DB hiccup); nothing here can read user data —
// the admin client is used only for public catalogue reads.

import { getBrowseSessions } from "@/lib/booking";
import { formatSessionDate } from "@/lib/academy-time";
import { formatPricePence, ok, type WaTool } from "./types";

export const academyInfo: WaTool = {
  name: "get_academy_info",
  description:
    "Public info about Sharwin Table Tennis Academy: membership plans with prices, venues, and the group sessions running over the next 7 days. Use for any general question about the academy, prices, or timetable.",
  input_schema: { type: "object", properties: {} },
  run: async (_input, ctx) => {
    const [{ data: plans }, { data: venues }, sessions] = await Promise.all([
      ctx.admin
        .from("plans")
        .select("id,name,description,price_pence,group_sessions_per_week,private_minutes_per_cycle")
        .eq("active", true)
        .order("price_pence"),
      ctx.admin
        .from("venues")
        .select("id,name,address,postcode")
        .eq("active", true),
      getBrowseSessions(ctx.admin, "", 7),
    ]);

    return ok({
      plans: (plans ?? []).map((p) => ({
        plan_id: p.id,
        name: p.name,
        description: p.description,
        price_per_month: formatPricePence(p.price_pence),
        group_sessions_per_week: p.group_sessions_per_week,
        private_minutes_per_month: p.private_minutes_per_cycle,
      })),
      offers:
        "Every child's first group class is FREE (one trial per player, no payment details needed — sign up and book). There's also a discounted intro price on the first private session, one per child. One-off classes can be bought without any membership; monthly plans just work out cheaper.",
      venues: venues ?? [],
      next_7_days_group_sessions: sessions.map((s) => ({
        session_id: s.id,
        when: formatSessionDate(s.starts_at),
        title: s.classTitle,
        level: s.level,
        venue: s.venue?.name ?? null,
        coach: s.coachName,
        seats_left: Math.max(0, s.capacity - s.confirmed),
      })),
    });
  },
};

export const guestTools: WaTool[] = [academyInfo];
