// Applying one named operation across a set of ids.
//
// The honest limitation, stated once here so it isn't re-discovered: supabase-js
// has no client-side transaction, so this is a sequential loop, NOT a database
// transaction. Cancelling 14 sessions can still stop at the 9th.
//
// What it fixes is nonetheless the thing that actually bit: before this, the
// model had to emit one tool call per id inside a 2048-token output budget, and
// when call 9 failed nobody found out — the assistant had no complete picture to
// report. Here the loop runs server-side, every outcome is captured, and the
// summary distinguishes "all 14 done" from "9 done, 5 failed, here's which".
// True atomicity needs a Postgres function per operation; that's a migration,
// deliberately not in this change.
//
// Sequential rather than parallel on purpose: these cores each fan out to
// notifications and audit rows, and a burst of 50 concurrent writes is how you
// turn a founder's typo into a rate-limit incident.

import { fail, ok } from "./types";

/** Ceiling on ids per bulk call. Above this the tool refuses and asks for a narrower set. */
export const BULK_CAP = 50;

export type BulkOutcome = { id: string; ok: boolean; error?: string };

export type BulkSummary = {
  requested: number;
  succeeded: number;
  failed: number;
  outcomes: BulkOutcome[];
};

/** Normalise the id argument: the model sends an array, or one string, or "a,b". */
export function idList(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : input == null
      ? []
      : String(input)
          .split(",")
          .map((s) => s.trim());
  return [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))];
}

/**
 * Run `op` over each id in order, collecting outcomes. Never throws for a single
 * id's failure — a half-finished bulk still has to be reportable.
 */
export async function runBulk(
  ids: readonly string[],
  op: (id: string) => Promise<{ ok: boolean; error?: string }>
): Promise<BulkSummary> {
  const outcomes: BulkOutcome[] = [];
  for (const id of ids) {
    try {
      const result = await op(id);
      outcomes.push({ id, ok: result.ok, error: result.ok ? undefined : (result.error ?? "Failed.") });
    } catch (err) {
      outcomes.push({
        id,
        ok: false,
        error: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }
  const succeeded = outcomes.filter((o) => o.ok).length;
  return { requested: ids.length, succeeded, failed: outcomes.length - succeeded, outcomes };
}

/**
 * Shared entry point for every bulk tool: validate the id set against the cap,
 * run the op, and shape a result the model can report faithfully.
 *
 * Partial failure returns ok:true with a `failed` count rather than an error —
 * the work genuinely happened for most ids, and reporting it as a flat failure
 * is how an assistant ends up telling someone nothing was cancelled when eleven
 * things were.
 */
export async function bulkTool(
  rawIds: unknown,
  op: (id: string) => Promise<{ ok: boolean; error?: string }>,
  opts: { noun: string; cap?: number } = { noun: "item" }
): Promise<string> {
  const ids = idList(rawIds);
  const cap = opts.cap ?? BULK_CAP;
  if (ids.length === 0) return fail(`No ${opts.noun} ids given.`);
  if (ids.length > cap) {
    return fail(
      `That's ${ids.length} ${opts.noun}s — more than the ${cap} this can do at once. Narrow it down and go again.`
    );
  }

  const summary = await runBulk(ids, op);
  const failures = summary.outcomes.filter((o) => !o.ok);
  return ok({
    requested: summary.requested,
    succeeded: summary.succeeded,
    failed: summary.failed,
    // Only failures are itemised: the successes are the ids the caller sent, and
    // echoing 50 UUIDs back at the model wastes the context it needs to write a
    // sentence about them.
    failures: failures.map((f) => ({ id: f.id, error: f.error })),
    partial: summary.failed > 0 && summary.succeeded > 0,
  });
}
