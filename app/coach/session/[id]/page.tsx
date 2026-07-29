import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { effectiveCoachId } from "@/lib/coach-preview";
import { CoachShell } from "@/components/app/CoachShell";
import { Badge } from "@/components/ui/Badge";
import { SessionRoster } from "@/components/app/SessionRoster";
import { SessionArrival } from "@/components/app/SessionArrival";
import { AddressDisplay } from "@/components/app/AddressDisplay";
import { asAddressDetails, fromDetails, type StructuredAddress } from "@/lib/address";
import { formatClock, formatDayLong, nowMs } from "@/lib/academy-time";

export const metadata: Metadata = { title: "Session" };

export default async function CoachSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await requireUser(`/coach/session/${id}`);
  const coachId = await effectiveCoachId(user.id);

  const { data: session } = await supabase
    .from("class_sessions")
    .select(
      "id,starts_at,ends_at,coach_id,coach_notes,coach_arrived_at,coach_confirmed_at,classes!inner(title,skill_level,class_type,is_school,venues(name,address,postcode,lat,lng,address_details),private_class_details(address,postcode,lat,lng,access_notes,has_table,address_details))"
    )
    .eq("id", id)
    .maybeSingle();

  if (!session || session.coach_id !== coachId) notFound();

  const cls = session.classes;
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

  const { data: roster } = await supabase
    .from("bookings")
    .select("id,status,coach_note,players(full_name,date_of_birth,skill_level)")
    .eq("session_id", id)
    .in("status", ["confirmed", "attended", "no_show"]);

  const rows = (roster ?? []).map((b) => {
    const player = b.players;
    const junior =
      player.date_of_birth !== null &&
      new Date(player.date_of_birth) >
        new Date(nowMs() - 18 * 365.25 * 86400000);
    return {
      id: b.id,
      status: b.status,
      coachNote: b.coach_note,
      name: player.full_name,
      level: player.skill_level,
      junior,
    };
  });

  const when = `${formatDayLong(session.starts_at)}, ${formatClock(session.starts_at)} – ${formatClock(session.ends_at)}`;

  return (
    <CoachShell title={cls.title}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="tnum font-display text-3xl">{when}</p>
          {cls.venues && (
            <p className="mt-1 font-medium">{cls.venues.name}</p>
          )}
          {address ? (
            <AddressDisplay address={address} audience="staff" className="mt-1" />
          ) : (
            <p className="mt-1 text-fg-2">Location TBC</p>
          )}
          <div className="mt-3 flex gap-2">
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
            </div>
          )}
        </div>

        <SessionArrival
          sessionId={session.id}
          startsAt={session.starts_at}
          endsAt={session.ends_at}
          coachArrivedAt={session.coach_arrived_at}
          coachConfirmedAt={session.coach_confirmed_at}
          venueLat={cls.venues?.lat ?? priv?.lat ?? null}
          venueLng={cls.venues?.lng ?? priv?.lng ?? null}
          venueName={cls.venues?.name ?? null}
        />

        <SessionRoster
          sessionId={session.id}
          startsAt={session.starts_at}
          roster={rows}
          coachNotes={session.coach_notes}
          isSchool={cls.is_school}
        />
      </div>
    </CoachShell>
  );
}
