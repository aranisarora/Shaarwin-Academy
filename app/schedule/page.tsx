import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { StudioShell } from "@/components/shells/StudioShell";
import { GroupCard } from "@/components/ui/GroupCard";
import { CalendarIcon, WhatsAppIcon } from "@/components/ui/icons";
import { DayHeading } from "@/components/schedule/DayHeading";
import { Locked } from "@/components/schedule/Locked";
import { SessionCard } from "@/components/schedule/SessionCard";
import { WeekStrip } from "@/components/schedule/WeekStrip";
import { fetchDiary } from "@/lib/bluetick";
import { whatsappThreadLink } from "@/lib/contact";
import { GATE_COOKIE, cookieOpens } from "@/lib/schedule-gate";
import { academyToday, nowMs } from "@/lib/academy-time";
import { dayDensity, groupByDay, sessionView } from "@/lib/schedule-view";

// The founder's week — the Schedule tab of the admin that used to live here,
// with everything you could do on it taken away.
//
// It is his page and nobody else's: private lessons are at people's homes and
// school classes are on somebody's campus, and the whole week lists both. So it
// is behind a key (lib/schedule-gate.ts), not a login: the assistant hands him
// a link on WhatsApp, and the link is the door.
//
// Nothing here writes, and nothing here opens. A class is changed by saying so
// in the WhatsApp thread, which is where every button on this page goes.

export const metadata: Metadata = {
  title: "Schedule",
  // A page behind a key is not a page for a crawler.
  robots: { index: false, follow: false },
};

// The studio shell is ivory, so Android tints the address bar to match rather
// than to the ink the marketing site asks for.
export const viewport: Viewport = { themeColor: "#F4F1EA" };

/** How many days one screen of the week shows. */
const WINDOW_DAYS = 7;

/** Clears the sticky header and the week strip under it, so a day the strip
 *  jumps to lands below them rather than behind them. */
const DAY_SCROLL_MARGIN: React.CSSProperties = {
  scrollMarginTop: "calc(var(--header-h) + 8rem)",
};

/** A "YYYY-MM-DD" that is actually a date, or null. */
function parseFrom(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const round =
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d;
  return round ? raw : null;
}

/** The way back. The thread itself, with nothing typed into it: he already has
 *  the conversation, and this is the button that returns him to it. */
function BackToWhatsApp({ size = "sm" }: { size?: "sm" | "lg" }) {
  const sizing = size === "lg" ? "min-h-11 px-5 text-base" : "min-h-9 px-3 text-sm";
  return (
    <a
      href={whatsappThreadLink()}
      target="_blank"
      rel="noopener noreferrer"
      className={`pressable inline-flex items-center justify-center gap-2 rounded-[8px] bg-ember font-semibold text-ivory hover:bg-ember-2 ${sizing}`}
    >
      <WhatsAppIcon className="h-4 w-4" />
      {size === "lg" ? "Back to WhatsApp" : "WhatsApp"}
    </a>
  );
}

// Schedule is the only screen; WhatsApp is the only other place to go.
const tabs = [
  { href: "/schedule", label: "Schedule", icon: <CalendarIcon />, active: true },
  { href: whatsappThreadLink(), label: "WhatsApp", icon: <WhatsAppIcon />, external: true },
];

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [params, jar] = await Promise.all([searchParams, cookies()]);
  const open = await cookieOpens(jar.get(GATE_COOKIE)?.value);

  if (!open) {
    return (
      <StudioShell title="Schedule" tabs={tabs}>
        <Locked />
      </StudioShell>
    );
  }

  const requestedFrom = parseFrom(params.from);
  const result = await fetchDiary({
    from: requestedFrom ?? undefined,
    days: WINDOW_DAYS,
  });

  // When bluetick answered, its `from` is the authority — it resolved "today"
  // on the academy's own clock.
  const today = academyToday();
  const anchor = result.ok ? result.diary.from : (requestedFrom ?? today);
  const now = nowMs();
  const sessions = result.ok ? result.diary.events.map((e) => sessionView(e, now)) : [];
  const days = groupByDay(sessions, today);

  return (
    <StudioShell title="Schedule" tabs={tabs} actions={<BackToWhatsApp />}>
      <div className="space-y-3">
        <div className="sticky top-[var(--header-h)] z-20 -mx-5 border-b border-line bg-surface px-5 pb-2 pt-1.5">
          <WeekStrip anchor={anchor} today={today} days={dayDensity(sessions)} />
        </div>

        {!result.ok && (
          <div className="rounded-[12px] border border-ember bg-surface-2 p-4 text-sm">
            <p className="font-medium text-fg">The schedule can&apos;t be loaded right now.</p>
            <p className="mt-1 text-fg-2">
              Bluetick didn&apos;t answer ({result.reason}). Try again in a minute.
            </p>
          </div>
        )}

        {result.ok && sessions.length === 0 && (
          <div className="rounded-[12px] border border-line bg-surface-2 p-4 text-sm text-fg-2">
            <p className="font-medium text-fg">Nothing on this week.</p>
            <p className="mt-1">
              The timetable is written down five weeks ahead, so a week further
              out than that stays empty until it is.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {days.map((day) => {
            const on = day.rows.filter((s) => !s.cancelled);
            const off = day.rows.filter((s) => s.cancelled);
            return (
              // The scroll target the week strip aims at.
              <div key={day.key} id={`day-${day.key}`} style={DAY_SCROLL_MARGIN}>
                <GroupCard
                  title={<DayHeading label={day.label} isToday={day.isToday} />}
                  meta={`${on.length} class${on.length === 1 ? "" : "es"}`}
                >
                  <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {on.map((s) => (
                      <SessionCard key={s.id} session={s} />
                    ))}
                    {on.length === 0 && off.length > 0 && (
                      <p className="col-span-full px-1 text-sm text-fg-2">
                        Nothing running — everything on this day was called off.
                      </p>
                    )}
                    {/* The cancellations, folded into a line: the count is the
                        fact he needs while scanning, the cards the fact he
                        needs only once he has stopped. A native disclosure, so
                        it works with no script. */}
                    {off.length > 0 && (
                      <details className="group col-span-full">
                        <summary className="pressable flex min-h-11 list-none items-center gap-1.5 rounded-[8px] px-1 text-sm text-fg-2 hover:text-ember [&::-webkit-details-marker]:hidden">
                          <span aria-hidden className="transition-transform group-open:rotate-90">
                            ›
                          </span>
                          {off.length} cancelled
                        </summary>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {off.map((s) => (
                            <SessionCard key={s.id} session={s} />
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </GroupCard>
              </div>
            );
          })}
        </div>

        <div className="rounded-[12px] border border-line bg-surface-2 p-5 text-center">
          <p className="font-semibold">Need to change something?</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-2">
            This page only shows the week. Moving a class, swapping a coach or
            calling one off all happen in your WhatsApp thread — just say so
            there.
          </p>
          <div className="mt-4 flex justify-center">
            <BackToWhatsApp size="lg" />
          </div>
        </div>
      </div>
    </StudioShell>
  );
}
