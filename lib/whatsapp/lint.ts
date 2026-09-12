// The last thing between the model and a real person.
//
// The system prompt already forbids all of this — in bold, with reasons. It
// happened anyway, in production, to the founder:
//
//   "I found two players named Riaan: 1. Riaan (Player ID: ed159aa7-250f-…)"
//   "I've sent the message to Sunil Hatti."   ← notify returned `queued`,
//                                               and delivery went by EMAIL
//
// A prohibition the model can only obey by being useless is a prohibition it
// will break. It printed the uuid because two players shared a name and the id
// was the only thing telling them apart; it said "sent" because that is the
// natural English for what it had just done. Neither is fixable by asking more
// firmly. So this is enforcement in code: deterministic, testable, and
// impossible to talk out of.
//
// Every hit is logged whether or not it is repaired. That log is the metric for
// whether the prompt rules are working at all — previously the only way to know
// was to read transcripts days later.

import { appBaseUrl } from "@/lib/app-url";
import { formatFullDateTime } from "@/lib/academy-time";

export type LintRule = "uuid" | "localhost" | "raw_iso" | "sent_claim";

export type LintFinding = { rule: LintRule; matched: string };

export type LintResult = { text: string; findings: LintFinding[] };

/**
 * Strict RFC-4122 shape, deliberately. A loose hex pattern would maul order
 * numbers, Razorpay ids and anything else that merely looks hex-ish — mangling
 * real content is a worse failure than the one being fixed.
 */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

const LOCALHOST_RE = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/gi;

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

/**
 * Phrasings that upgrade "queued" into "arrived". Sending is not receiving: a
 * message is handed to a worker that delivers it later, over whichever channel
 * each person's settings allow — and for some people that is no channel at all.
 * Only checked when a messaging tool actually ran this turn, so ordinary
 * sentences ("send me the schedule") are untouched.
 */
// NB "messaged" is deliberately absent: it is what the repairs below produce,
// and matching it would make the linter flag its own output — breaking
// idempotency and failing every already-correct hard-coded string.
const SENT_CLAIM_RE =
  /\b(?:ha(?:s|ve) been (?:notified|told|informed)|(?:was|were|has been|have been) delivered|they(?:'ve| have) (?:got|received)|everyone (?:has|have) been told)\b/gi;

const SENT_CLAIM_FIXES: [RegExp, string][] = [
  [/\bhas been notified\b/gi, "has been messaged"],
  [/\bhave been notified\b/gi, "have been messaged"],
  [/\bhas been told\b/gi, "has been messaged"],
  [/\bhave been told\b/gi, "have been messaged"],
  [/\bhas been informed\b/gi, "has been messaged"],
  [/\bhave been informed\b/gi, "have been messaged"],
  [/\beveryone has been told\b/gi, "everyone has been messaged"],
  [/\bthey've received\b/gi, "it's queued to them"],
  [/\bthey have received\b/gi, "it is queued to them"],
  [/\bthey've got\b/gi, "it's queued to them"],
  [/\bthey have got\b/gi, "it is queued to them"],
];

/** Did this turn run a tool that queues a message to somebody? */
export function usedMessagingTool(toolNames: readonly string[]): boolean {
  return toolNames.some((n) => /notify|broadcast|message/i.test(n));
}

/**
 * Repair what can be repaired, flag the rest. Idempotent by construction: a
 * repaired string has nothing left to match, so linting twice is safe and the
 * transcript and the delivered message stay byte-identical.
 */
export function lintReply(text: string, opts: { usedMessaging?: boolean } = {}): LintResult {
  const findings: LintFinding[] = [];
  let out = text;

  out = out.replace(UUID_RE, (m) => {
    findings.push({ rule: "uuid", matched: m });
    return "that one";
  });

  const base = appBaseUrl();
  out = out.replace(LOCALHOST_RE, (m) => {
    findings.push({ rule: "localhost", matched: m });
    return base;
  });

  out = out.replace(ISO_RE, (m) => {
    const d = new Date(m);
    if (Number.isNaN(d.getTime())) return m;
    findings.push({ rule: "raw_iso", matched: m });
    return formatFullDateTime(d);
  });

  if (opts.usedMessaging) {
    const claims = out.match(SENT_CLAIM_RE);
    if (claims) {
      for (const c of claims) findings.push({ rule: "sent_claim", matched: c });
      for (const [re, fix] of SENT_CLAIM_FIXES) out = out.replace(re, fix);
    }
  }

  for (const f of findings) {
    console.warn("wa: lint", f.rule, JSON.stringify(f.matched.slice(0, 80)));
  }
  return { text: out, findings };
}
