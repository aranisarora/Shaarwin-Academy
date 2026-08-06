import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";

/**
 * What a button on a push notification actually does.
 *
 * A tap here must land in exactly the same place a tap on the WhatsApp button
 * lands — same RPC, same guard, same side effects — otherwise a coach who
 * confirms from the lock screen is still "silent" as far as the escalation
 * ladder is concerned and the founder gets pinged anyway. So this dispatches to
 * `coach_confirm_session` and `coach_mark_arrival`, the two the WhatsApp path
 * uses (see lib/whatsapp/interactive.ts), and nothing else.
 *
 * Both RPCs are SECURITY DEFINER and check `auth.uid()` against the session's
 * coach themselves, so the only thing this route has to prove is that somebody
 * is signed in — the service worker sends the session cookie with the POST.
 *
 * Deliberately *not* here: "Can't make it". It starts a cover search and can't
 * be undone from the tray, so WhatsApp asks a second question before committing
 * it. The push notification offers it as a link into the session screen, where
 * the same confirm step lives, rather than as a one-tap button on a lock screen
 * a coach might be brushing lint off.
 *
 * The second job is housekeeping: `subscription_changed` is the service
 * worker's `pushsubscriptionchange` handler telling us a push service rotated
 * an endpoint, and `lib/push.ts` falling back here when its own upsert is
 * refused. Same route because it is the same conversation — the worker already
 * knows this URL, and the endpoint UNIQUE constraint makes the write
 * idempotent.
 */

type Body = {
  action?: string;
  session_id?: string | null;
  old_endpoint?: string | null;
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;

  if (body.action === "subscription_changed") {
    const sub = body.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys.auth) {
      return NextResponse.json({ error: "bad_subscription" }, { status: 400 });
    }
    // Clear the way with the service role, because either row in the way can
    // belong to somebody else. `old_endpoint` is the one a push service just
    // rotated away from. The incoming endpoint is the shared-device case: it is
    // globally UNIQUE and a browser profile has exactly one, so the second
    // person to sign in on a family iPad collides with the row the first left
    // behind — and RLS hides that row from both of them, which is why the
    // browser cannot do this itself and why the toggle used to sit on a
    // permanent failure there.
    //
    // Taking an endpoint off another account is deliberate. The exposure is
    // narrow: an endpoint URL is known only to the browser holding it and to
    // us, so anyone able to name one already has that browser or our database.
    // The alternative is a shared device that can never subscribe again.
    const cleaner = hasServiceRoleKey() ? createAdminClient() : supabase;
    const inTheWay = [sub.endpoint];
    if (body.old_endpoint && body.old_endpoint !== sub.endpoint) {
      inTheWay.push(body.old_endpoint);
    }
    await cleaner.from("push_subscriptions").delete().in("endpoint", inTheWay);

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: request.headers.get("user-agent") ?? null,
      },
      { onConflict: "endpoint" }
    );
    if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const sessionId = body.session_id;
  if (!sessionId) return NextResponse.json({ error: "no_session" }, { status: 400 });

  switch (body.action) {
    case "coach_confirm": {
      const { error } = await supabase.rpc("coach_confirm_session", { p_session: sessionId });
      if (error) return NextResponse.json({ error: "rpc_failed" }, { status: 400 });
      revalidatePath(`/coach/session/${sessionId}`);
      return NextResponse.json({
        ok: true,
        message: "You're confirmed. See you there.",
      });
    }
    case "coach_arrived": {
      // p_source is constrained to 'auto' | 'tap' | 'wa', and this *is* a tap —
      // just one made in the notification tray rather than on the session
      // screen. Adding a fourth value would mean a migration for a distinction
      // nothing reads.
      const { error } = await supabase.rpc("coach_mark_arrival", {
        p_session: sessionId,
        p_late: false,
        p_source: "tap",
      });
      if (error) return NextResponse.json({ error: "rpc_failed" }, { status: 400 });
      revalidatePath(`/coach/session/${sessionId}`);
      return NextResponse.json({
        ok: true,
        message: "Marked you as arrived. Everyone booked on the session has been told.",
      });
    }
    case "coach_late": {
      const { error } = await supabase.rpc("coach_mark_arrival", {
        p_session: sessionId,
        p_late: true,
      });
      if (error) return NextResponse.json({ error: "rpc_failed" }, { status: 400 });
      revalidatePath(`/coach/session/${sessionId}`);
      return NextResponse.json({
        ok: true,
        message: "Thanks — we've told everyone you're running a little late.",
      });
    }
    default:
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }
}
