// One turn per conversation, however many messages it arrived in.
//
// THE PROBLEM
// -----------
// People text the way they think:
//
//   "cancel tomorrow"          → webhook 1
//   "actually just move it"    → webhook 2
//   "to 5pm"                   → webhook 3
//
// Each webhook is claimed exactly once (that guarantee is old and stays), but
// each then started its OWN agent run. Three runs, none of which could see the
// others' messages — because a message is only written to wa_messages when its
// own turn finishes. So run 1 cancelled a session that sentence 2 retracted,
// and all three replied, contradicting each other.
//
// THE SHAPE OF THE FIX
// --------------------
//   * The claim row is the queue. wa_inbound_seen already records every
//     MessageSid on arrival; it now carries the body and a handled_at, so
//     claiming and enqueueing are one INSERT with no gap between them.
//   * One run per chat, taken with a TTL lock in Postgres. The winner answers
//     the whole burst. The loser returns immediately — its message is in the
//     queue, and the winner will absorb it.
//   * A short settle window before starting, because the three webhooks above
//     arrive within a second or two of each other and waiting is what turns
//     them into one sentence.
//   * The run re-checks the queue before every state-changing tool call and
//     before it finishes. A correction must always beat the action it corrects.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * How long to wait for the rest of a burst before answering.
 *
 * Long enough to catch a fragment typed straight after the last one, short
 * enough that a single message still feels immediate. The webhook has already
 * acked Twilio and this runs inside after(), so nothing is blocked by it.
 */
export const SETTLE_MS = 1500;

/** Lease length. Longer than the Gemini timeout (30s) plus tool time, so a live
 *  run is never robbed; short enough that a dead one frees the chat quickly. */
export const LOCK_TTL_SECONDS = 120;

/** A burst is a burst, not a transcript — refuse to glue an unbounded number
 *  of fragments into one prompt. */
const MAX_FRAGMENTS = 10;

export type Pending = { message_sid: string; body: string; created_at: string };

/**
 * Does this tool only READ?
 *
 * Used to decide whether a call must first yield to input the run hasn't seen.
 * Reads are free to proceed — re-reading with stale context costs nothing and
 * the answer is thrown away if a correction lands. Writes are not.
 *
 * DEFAULTS TO WRITE, and that direction is the whole design. There are 68 tools
 * and more arrive every month; a new one that this list has never heard of must
 * be treated as dangerous, because the cost of being wrong is asymmetric. A
 * write misread as a read cancels a session somebody just retracted. A read
 * misread as a write costs one indexed query.
 */
export function isReadOnlyTool(name: string): boolean {
  return (
    /^(find|resolve|get_|list_|my_|browse_|search_|check_|view_)/.test(name) ||
    READ_ONLY_EXTRAS.has(name)
  );
}

/** Readers whose names don't follow the prefix convention. */
const READ_ONLY_EXTRAS = new Set([
  "academy_overview",
  "membership_status",
  "client_payments",
  "session_roster",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Record an inbound message and claim it in one statement.
 *
 * Returns false only for a Twilio RETRY of a sid we already hold — the caller
 * drops those. Every other outcome, including an unexpected DB error, returns
 * true: a dropped message is worse than a rare double reply, which is the same
 * fail-open stance the claim has always had.
 */
export async function claimAndQueue(
  admin: SupabaseClient<Database>,
  phone: string,
  messageSid: string,
  body: string
): Promise<boolean> {
  if (!messageSid) return true;
  const { error } = await admin
    .from("wa_inbound_seen")
    .insert({ message_sid: messageSid, phone, body: body.slice(0, 4000) });
  if (!error) return true;
  // 23505 = unique_violation → someone else already claimed this sid.
  if (error.code === "23505") return false;
  console.warn("wa: inbound claim failed, processing anyway", error.message);
  return true;
}

/** Everything this chat has said and not yet been answered, oldest first. */
export async function pendingFor(
  admin: SupabaseClient<Database>,
  phone: string
): Promise<Pending[]> {
  const { data, error } = await admin
    .from("wa_inbound_seen")
    .select("message_sid,body,created_at")
    .eq("phone", phone)
    .is("handled_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_FRAGMENTS);
  if (error) {
    console.warn("wa: pending read failed", error.message);
    return [];
  }
  return (data ?? [])
    .filter((r): r is Pending => typeof r.body === "string" && r.body.trim().length > 0)
    .map((r) => ({ message_sid: r.message_sid, body: r.body, created_at: r.created_at }));
}

/** Mark fragments answered. Done AFTER the reply is composed, so a run that
 *  dies mid-flight leaves its input for the next one rather than eating it. */
export async function markHandled(
  admin: SupabaseClient<Database>,
  sids: readonly string[]
): Promise<void> {
  if (sids.length === 0) return;
  const { error } = await admin
    .from("wa_inbound_seen")
    .update({ handled_at: new Date().toISOString() })
    .in("message_sid", [...sids]);
  if (error) console.warn("wa: marking inbound handled failed", error.message);
}

/** Is there input this run has not read? The question a write must ask first. */
export async function hasUnread(
  admin: SupabaseClient<Database>,
  phone: string,
  known: ReadonlySet<string>
): Promise<boolean> {
  const pending = await pendingFor(admin, phone);
  return pending.some((p) => !known.has(p.message_sid));
}

export async function acquireChatLock(
  admin: SupabaseClient<Database>,
  phone: string,
  runId: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("wa_claim_chat", {
    p_phone: phone,
    p_run: runId,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });
  if (error) {
    // Fail OPEN, deliberately. If the lock cannot be taken the worst case is
    // the old behaviour — two runs on one chat — and the alternative is a
    // silent chat, which is worse.
    console.warn("wa: chat lock failed, running unserialized", error.message);
    return true;
  }
  return data !== false;
}

export async function releaseChatLock(
  admin: SupabaseClient<Database>,
  phone: string,
  runId: string
): Promise<void> {
  const { error } = await admin.rpc("wa_release_chat", { p_phone: phone, p_run: runId });
  if (error) console.warn("wa: chat lock release failed", error.message);
}

/** How the fragments of one burst are joined into a single utterance. */
export function joinFragments(fragments: readonly Pending[]): string {
  return fragments
    .map((f) => f.body.trim())
    .filter(Boolean)
    .join("\n");
}

export type TurnInput = { text: string; sids: string[] };

/**
 * "answered" — the fragments were dealt with and may be marked handled.
 * "superseded" — the run stood down because a correction arrived, and the
 * fragments must STAY queued so the next pass reads them together with it.
 * Marking them handled here is what would lose the retracted half of the
 * sentence and leave the correction sitting on its own with no context.
 */
export type TurnVerdict = "answered" | "superseded";

/** Passes before the turn stops yielding and simply answers. */
const MAX_PASSES = 3;

/**
 * Run `handle` over the whole burst, once, with the chat serialized.
 *
 * `handle` is given the joined text and a `stillCurrent()` it must consult
 * before any state-changing tool call. Returning from `handle` completes the
 * turn; if more input arrived meanwhile, the loop goes round again with the new
 * fragments folded in — which is how "no, 5pm not 4" beats the move it corrects
 * without anyone having to notice it is a correction.
 */
export async function runCoalescedTurn(opts: {
  admin: SupabaseClient<Database>;
  phone: string;
  runId: string;
  /** Skip the settle wait — a button tap is a complete thought on its own. */
  immediate?: boolean;
  handle: (
    input: TurnInput,
    /**
     * Null on the final pass: at that point the run must ANSWER rather than
     * keep standing aside, or a fast typist could leave the chat with no reply
     * at all — the one outcome worse than acting on a stale fragment.
     */
    stillCurrent: (() => Promise<boolean>) | null
  ) => Promise<TurnVerdict>;
}): Promise<void> {
  const { admin, phone, runId, handle } = opts;

  if (!(await acquireChatLock(admin, phone, runId))) {
    // Someone else is answering this chat. Our message is already queued, and
    // they will absorb it — replying too would be the double-reply we are here
    // to prevent.
    console.info("wa: chat busy, folding into the run in flight", phone.slice(-4));
    return;
  }

  try {
    if (!opts.immediate) await sleep(SETTLE_MS);

    // Bounded: each pass answers what is queued, then checks whether anything
    // arrived while it was thinking. One pass is the common case; the cap stops
    // a fast typist from spinning it forever.
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const fragments = await pendingFor(admin, phone);
      if (fragments.length === 0) return;

      const sids = fragments.map((f) => f.message_sid);
      const known = new Set(sids);
      const text = joinFragments(fragments);
      if (!text) {
        await markHandled(admin, sids);
        return;
      }

      if (fragments.length > 1) {
        console.info("wa: coalesced", fragments.length, "fragments for", phone.slice(-4));
      }

      const lastPass = pass === MAX_PASSES - 1;
      const verdict = await handle(
        { text, sids },
        lastPass ? null : async () => !(await hasUnread(admin, phone, known))
      );

      if (verdict === "superseded") {
        // Leave the fragments queued on purpose. The next pass re-reads them
        // WITH the correction, so the model sees "cancel tomorrow / actually
        // just move it / to 5pm" as the one sentence it always was.
        console.info("wa: superseded, re-reading with the correction", phone.slice(-4));
        continue;
      }

      await markHandled(admin, sids);
      if (!(await hasUnread(admin, phone, known))) return;
      console.info("wa: new input arrived mid-turn, going round again", phone.slice(-4));
    }
  } finally {
    await releaseChatLock(admin, phone, runId);
  }
}
