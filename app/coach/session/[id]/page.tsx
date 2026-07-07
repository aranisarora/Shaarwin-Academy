import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { SessionRoster } from "@/components/app/SessionRoster";

export const metadata: Metadata = { title: "Session" };

export default async function CoachSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await requireUser(`/coach/session/${id}`);

  const { data: session } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,ends_at,coach_id,coach_notes,classes!inner(title,skill_level,class_type,venues(name,address,postcode),private_class_details(address,postcode,access_notes,has_table))"
    )
    .eq("id", id)
    .maybeSingle();

  if (!session || session.coach_id !== user.id) notFound();

  const cls = session.classes as unknown as {
    title: string;
    skill_level: string;
    class_type: string;
    venues: { name: string; address: string; postcode: string } | null;
    private_class_details:
      | { address: string; postcode: string; access_notes: string | null; has_table: boolean }[]
      | null;
  };
  const priv = cls.private_class_details?.[0] ?? null;

  const { data: roster } = await supabase
    .from("bookings")
    .select("id,status,coach_note,players(full_name,date_of_birth,skill_level)")
    .eq("session_id", id)
    .in("status", ["confirmed", "attended", "no_show"]);

  const rows = (roster ?? []).map((b) => {
    const player = b.players as unknown as {
      full_name: string;
      date_of_birth: string | null;
      skill_level: string;
    };
    const junior =
      player.date_of_birth !== null &&
      new Date(player.date_of_birth) >
        new Date(Date.now() - 18 * 365.25 * 86400000);
    return {
      id: b.id,
      status: b.status,
      coachNote: b.coach_note,
      name: player.full_name,
      level: player.skill_level,
      junior,
    };
  });

  const when = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(session.starts_at));

  return (
    <CoachShell title={cls.title}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="tnum font-display text-3xl">{when}</p>
          <p className="mt-1 text-fg-2">
            {cls.venues
              ? `${cls.venues.name} — ${cls.venues.address}, ${cls.venues.postcode}`
              : priv
                ? `${priv.address}, ${priv.postcode}`
                : "Location TBC"}
          </p>
          <div className="mt-2 flex gap-2">
            <Badge tone={cls.class_type === "private" ? "ember" : "neutral"}>
              {cls.class_type}
            </Badge>
            <Badge>{cls.skill_level}</Badge>
          </div>
          {priv && (
            <div className="mt-3 rounded-[12px] border border-line bg-surface-2 p-4 text-sm">
              <p>
                <span className="label">Table:</span>{" "}
                {priv.has_table ? "at the address" : "none — check with client"}
              </p>
              {priv.access_notes && (
                <p className="mt-1">
                  <span className="label">Access:</span> {priv.access_notes}
                </p>
              )}
            </div>
          )}
        </div>

        <SessionRoster
          sessionId={session.id}
          startsAt={session.starts_at}
          roster={rows}
          coachNotes={session.coach_notes}
        />
      </div>
    </CoachShell>
  );
}
