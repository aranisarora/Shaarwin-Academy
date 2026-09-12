// The one place a cancellation message is composed, for every kind of thing the
// founder can take off the calendar.
//
// A leaf module on purpose: both `admin-ops-classes` and `admin-ops-private-series`
// import it, and neither may import the other.
//
// WHY THIS EXISTS AT ALL. `session_cancelled` is TRANSACTIONAL in the notify
// worker (supabase/functions/notify/index.ts): it ignores the user's prefs, it is
// absent from DEFERRABLE so it skips quiet hours, and it is not subject to the
// daily send cap. Its dedupe key is per session/booking, so nothing collapses
// downstream either. If the collapse does not happen before the insert, it does
// not happen — a parent booked into eight cleared classes is texted eight times,
// possibly at 2am. That is the Jul 22 mass-reassignment burst, and
// `endGroupClassesCore` was written to prevent exactly it.
//
// What changed is the SCOPE of "one operation". `endGroupClassesCore` owned the
// collapse when the only thing a clear-out could touch was group classes. A
// selection can now take weekly private slots in the same breath, and a wipe
// takes everything — so a parent whose child is in three cleared classes AND a
// private slot, or a coach rostered on both, must still hear once. The
// accumulator therefore moves out of the class core: callers build one of these,
// pass it to each core, and flush it exactly once at the end.
//
// (The whole-calendar wipe does not use this class — it is a single SQL
// statement whose INSERT..SELECT..GROUP BY cannot send twice by construction.
// Two implementations of one guarantee, so both are pinned by their own test.)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** What one person lost in one operation, whatever kind of thing it was. */
export type NoticeItem =
  | { kind: "class"; id: string; title: string }
  | { kind: "series"; id: string; label: string; minutesReturned: number };

export type NoticeAudience = "client" | "coach";

type Entry = { audience: NoticeAudience; items: Map<string, NoticeItem> };

/** "Monday 5:00 pm and 3 other classes" — names one, counts the rest. The same
 * grammar the group-only collapse has always used, widened so the noun is right
 * when the list is a mix ("things", because a weekly private slot is not a
 * class and calling it one is how a parent ends up looking for it on the
 * timetable). */
function subject(items: NoticeItem[]): string {
  const [first] = items;
  const head =
    first == null
      ? "Your sessions"
      : first.kind === "class"
        ? first.title
        : first.label;
  const rest = items.length - 1;
  if (rest <= 0) return head;
  const allClasses = items.every((i) => i.kind === "class");
  const noun = allClasses
    ? rest === 1
      ? "class"
      : "classes"
    : rest === 1
      ? "thing"
      : "things";
  return `${head} and ${rest} other ${noun}`;
}

export class CancellationNotice {
  private readonly byUser = new Map<string, Entry>();

  /**
   * Record that `userId` loses `item`. Idempotent per (user, item) — a coach
   * rostered on six sessions of one class is one entry, and a client booked
   * into the same class twice is one entry.
   *
   * A user who is somehow both a client and a coach in one operation keeps the
   * audience they were first added under: the point is one message, and the
   * client wording is the one that mentions their minutes.
   */
  add(audience: NoticeAudience, userId: string, item: NoticeItem): void {
    if (!userId) return;
    const entry =
      this.byUser.get(userId) ?? this.byUser.set(userId, { audience, items: new Map() }).get(userId)!;
    entry.items.set(`${item.kind}:${item.id}`, item);
  }

  /** Distinct people who will be written to, so the ✓ line can say how many
   * families and coaches heard without counting rows twice. */
  get recipients(): { clients: number; coaches: number } {
    let clients = 0;
    let coaches = 0;
    for (const e of this.byUser.values()) {
      if (e.audience === "client") clients += 1;
      else coaches += 1;
    }
    return { clients, coaches };
  }

  get size(): number {
    return this.byUser.size;
  }

  /**
   * Exactly one `notifications` row per distinct user id.
   *
   * Returns what was written AND what was rejected. A swallowed notification
   * failure is how a founder ends up believing forty families were told when
   * none were — every ✓ line in this app promises whether a message went, so
   * the promise has to be checked rather than assumed.
   */
  async flush(
    supabase: SupabaseClient<Database>
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const [userId, entry] of this.byUser) {
      const items = [...entry.items.values()];
      const many = items.length > 1;
      const minutes = items.reduce(
        (n, i) => n + (i.kind === "series" ? i.minutesReturned : 0),
        0
      );
      const classCount = items.filter((i) => i.kind === "class").length;
      const seriesCount = items.filter((i) => i.kind === "series").length;

      // The classes-only wording is untouched from when this collapse lived in
      // `endGroupClassesCore` — it is the message that actually goes out most of
      // the time, and there is no reason for this refactor to change what a
      // parent reads. A slot in the mix earns the different sentence, because
      // minutes coming back is a fact the old copy had no way to say.
      const seriesInvolved = seriesCount > 0;
      const body =
        entry.audience === "client"
          ? seriesInvolved
            ? `${subject(items)} ${many ? "have" : "has"} stopped. Your remaining sessions in ${many ? "them" : "it"} are cancelled — ` +
              (minutes > 0
                ? `${minutes} private minutes are back on your account${classCount > 0 ? ", and your class allowance is unaffected" : ""}.`
                : "your allowance is unaffected.")
            : `${subject(items)} ${many ? "have" : "has"} finished ${many ? "their" : "its"} run. Your remaining sessions in ${many ? "them" : "it"} are cancelled — your allowance is unaffected.`
          : seriesInvolved
            ? `${subject(items)} ${many ? "have" : "has"} stopped — ${many ? "their" : "its"} sessions are off your calendar.`
            : `${subject(items)} ${many ? "have" : "has"} ended — ${many ? "their" : "its"} sessions are off your calendar.`;

      // Titles stay exactly as they were for the classes-only case — that is
      // still by far the commonest clear-out, and "Classes ended" is the line
      // people have been getting. Only a mix reaches for different words,
      // because a weekly private slot is not a class and its family will look
      // for it on the wrong screen if we call it one.
      const title = seriesInvolved
        ? classCount > 0
          ? "Your sessions are cancelled"
          : many
            ? "Weekly slots ended"
            : "Weekly slot ended"
        : many
          ? "Classes ended"
          : "Class ended";

      const { error } = await supabase.from("notifications").insert({
        user_id: userId,
        type: "session_cancelled",
        title,
        body,
        data: {
          // A parent who lost a class is pointed at booking (rebook something
          // else); one who lost a standing private slot is pointed at their
          // schedule, because there is nothing on /app/book that replaces it.
          url:
            entry.audience === "coach"
              ? "/coach"
              : seriesInvolved
                ? "/app/schedule"
                : "/app/book",
          class_count: classCount,
          series_count: seriesCount,
          minutes_returned: minutes,
          collapsed: many,
        },
      });
      if (error) failed += 1;
      else sent += 1;
    }
    return { sent, failed };
  }
}
