import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { getCoachPreview } from "@/lib/coach-preview";
import { parseArrivalFixReport } from "@/lib/arrival-fix";
import { GEOFENCE_M } from "@/lib/geo";

/**
 * Record what the proximity check saw, whether or not it marked anyone arrived.
 *
 * The fence is 150 m and there is no evidence for that number — 5 of 42 manual
 * arrivals in production carried a distance, because `coach_arrival_distance_m`
 * is only written when arrival is actually marked. Refusals, timeouts and coaches
 * standing 600 m away all left no trace at all. This is the row that was missing;
 * a week of them is what the fence should be set from.
 *
 * Writes to `audit_log` and needs no migration for it, which is the point: PR B
 * is editing supabase/schema.sql in parallel and the pre-commit hook pairs any
 * migration with a hand-edit of that file. `audit_log` already carries an actor,
 * an entity and a jsonb meta.
 *
 * Two guards, both narrow and both load-bearing:
 *
 *   • The session has to be the caller's own. RLS on class_sessions would hide
 *     someone else's row from the read, so a parent naming a session id gets a
 *     404 here rather than a row in the founder's audit log.
 *   • A founder in "view as coach" is refused, exactly as markArrived refuses.
 *     A founder wandering around a coach's screens from an office would
 *     otherwise pour their own distance-from-the-venue into the distribution
 *     that decides how wide the fence should be.
 *
 * The service role does the insert because "founder writes audit" is the only
 * INSERT policy on audit_log, and a coach is not a founder. Everything written
 * is server-derived or validated first, and the actor is always the real
 * signed-in user rather than anything the body claims.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const report = parseArrivalFixReport(await request.json().catch(() => null));
  if (!report) return NextResponse.json({ error: "bad_report" }, { status: 400 });

  if (await getCoachPreview()) {
    return NextResponse.json({ error: "preview" }, { status: 403 });
  }

  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,coach_id")
    .eq("id", report.sessionId)
    .maybeSingle();
  if (!session || session.coach_id !== user.id) {
    return NextResponse.json({ error: "not_your_session" }, { status: 404 });
  }

  // Telemetry that cannot be written is not worth a 500 to the coach's device —
  // the arrival itself went through a different path and has already happened.
  if (!hasServiceRoleKey()) return NextResponse.json({ ok: true, stored: false });

  const { error } = await createAdminClient()
    .from("audit_log")
    .insert({
      actor_id: user.id,
      action: "coach_arrival_fix",
      entity: "class_sessions",
      entity_id: report.sessionId,
      meta: {
        source: report.source,
        outcome: report.outcome,
        distance_m: report.distanceM,
        accuracy_m: report.accuracyM,
        marked: report.marked,
        // Which fence was in force when this was measured. Without it, a row
        // read back in a month cannot be compared against one written after
        // somebody widens GEOFENCE_M — and comparing them is the entire job.
        fence_m: GEOFENCE_M,
      },
    });
  if (error) return NextResponse.json({ ok: true, stored: false });

  return NextResponse.json({ ok: true, stored: true });
}
