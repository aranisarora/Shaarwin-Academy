// The handover: the link a school is sent, and the message it arrives in.
//
// This lives in `lib` rather than inside SchoolManager because it is the whole
// contract between two screens that never see each other. The founder's sheet
// composes the text; the school's sign-in page has to make good on every
// promise in it. If the link written here and the link `/login/school` reads
// ever drift apart, the failure lands on a head teacher who has no way to
// diagnose it — so both ends import from this file, and it is unit-tested.
// `pack`/`unpack` are the sharpest edge of that: one writes what the other
// reads, and nothing else in the app can tell you they still agree.

import { isSyntheticEmail } from "@/lib/synthetic-email";
import { appBaseUrl } from "@/lib/app-url";

/**
 * Where the school is told to go. Deliberately not `window.location.origin`:
 * this text gets pasted into WhatsApp and lives on a head teacher's phone for a
 * term, and a founder who opened the admin app from a Vercel preview URL would
 * be sending a link that stops resolving the week after.
 *
 * `appBaseUrl()` rather than reading the env directly: the same reasoning one
 * step further on. A dev-valued NEXT_PUBLIC_APP_URL doesn't stop resolving next
 * week — it never resolved for the head teacher at all.
 */
export const APP_ORIGIN = appBaseUrl();

/** The school sign-in screen, without the query string. Shown in the message as
 *  the thing to type when a tapped link doesn't survive being forwarded. */
export const SCHOOL_LOGIN_PATH = "/login/school";

/**
 * The half-prefilled link: address filled, password still to type. This is what
 * `/login` redirects a school to when it types its minted address into the
 * family form, and it is the shape a founder can hand over when he does not
 * want a tap-to-enter link in the thread at all.
 *
 * `?email=` is a query string because the address is not a secret: it is minted,
 * nothing is delivered to it, and on its own it opens nothing.
 */
export function schoolLoginUrl(email: string): string {
  return `${APP_ORIGIN}${SCHOOL_LOGIN_PATH}?email=${encodeURIComponent(email)}`;
}

/**
 * Both halves, packed into one string for the instant-login link.
 *
 * Not encryption and not pretending to be — anyone who can read the link can
 * read the credential, exactly as anyone who can read the message can. What the
 * packing buys is that the URL does not advertise "password=" to someone
 * glancing at a screen, and that one opaque blob survives copy-paste as a unit
 * where two separate parameters can be clipped apart.
 *
 * UTF-8 in, base64url out, so it is safe in a URL and symmetric between the
 * founder's browser that writes it and the school's browser that reads it.
 */
function pack(email: string, password: string): string {
  const payload = `${encodeURIComponent(email)}:${encodeURIComponent(password)}`;
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The credential a link carries, or null if it carries nothing usable. Never
 *  throws: this parses a string a stranger controls, and the honest answer to
 *  anything malformed is the ordinary sign-in form. */
export function unpack(token: string): { email: string; password: string } | null {
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const [email, password] = new TextDecoder().decode(bytes).split(":");
    if (!email || !password) return null;
    return {
      email: decodeURIComponent(email),
      password: decodeURIComponent(password),
    };
  } catch {
    return null;
  }
}

/** The fragment key the link uses, and the entry screen reads. */
export const LINK_TOKEN_KEY = "t";

/**
 * Where a tap-to-enter link lands: a screen whose only job is to redeem it.
 *
 * Its own route rather than a mode of `/login/school`, because the two screens
 * owe the visitor opposite things. This one has no form, no fields and nothing
 * to read — it is a spinner and a redirect, and a form flashing up before being
 * replaced would be a step in a journey we promised had none. When redemption
 * fails it forwards to `/login/school`, which is the screen that already knows
 * how to explain itself.
 */
export const SCHOOL_ENTER_PATH = "/login/school/enter";

/**
 * The tap-to-enter link: the school opens it and is signed in, with nothing to
 * type at all.
 *
 * The credential rides in the URL **fragment**, and that is the whole design.
 * A fragment is never sent to a server — not to ours, not to a proxy, not in a
 * Referer header on the next outbound click. Three consequences, all of which we
 * need:
 *
 *   • It stays out of our own request logs. A query string carrying a live
 *     password would be written to every log line that touches the request, and
 *     those logs outlive the term.
 *   • WhatsApp fetches a link to build its preview card. That crawler gets the
 *     page and no credential, so it cannot sign itself in — which matters more
 *     than it sounds: a crawler sign-in would stamp `last_sign_in_at` the moment
 *     the founder pressed send, and "Never signed in" is exactly how he finds
 *     the handovers that never landed.
 *   • The school's own page strips it from the address bar on arrival, so the
 *     live credential does not sit in the URL to be shoulder-read or shared by
 *     someone copying what is on screen.
 *
 * What it emphatically is NOT is a second, weaker credential. The link *is* the
 * password, so it grants nothing the message it travels in did not already
 * grant, and — the part that matters for revocation — resetting a school's
 * password kills every link ever sent to it, on the spot, with no second thing
 * for the founder to remember to revoke.
 */
export function instantLoginUrl(email: string, password: string): string {
  return `${APP_ORIGIN}${SCHOOL_ENTER_PATH}#${LINK_TOKEN_KEY}=${pack(email, password)}`;
}

/**
 * The message the founder actually sends. One body, whichever button he uses,
 * so the copied text and the WhatsApp text can never drift apart.
 *
 * Written for a school administrator who has never heard of the app and will
 * read it on a phone. Every constraint in it is load-bearing:
 *
 *   • Plain text with bare URLs. WhatsApp renders no markdown, and a link in
 *     brackets arrives as literal brackets.
 *   • The tap comes first, and it is a tap and nothing else — no field, no
 *     password, no second screen. That is the path almost everyone takes.
 *   • The typed fallback comes second, in full. A link can be broken by a
 *     forward, a copy-paste that clips the fragment, or a keyboard that
 *     "helpfully" capitalises it — and when it breaks, the person holding this
 *     message must still be able to get in without asking anyone. This is also
 *     the only way in on a browser with JavaScript switched off, since the
 *     credential in the link is read by the page itself and never by a server.
 *   • It warns that the link signs in whoever taps it. A school that forwards
 *     the message to a parent group has handed over the account, and nothing
 *     about a tidy-looking URL suggests that on its own.
 *   • Credentials sit alone between blank lines. On a narrow screen that is the
 *     difference between a field to copy and a wall of prose.
 *   • It never says "check your email". The address is a mailbox nothing is
 *     delivered to, so a school waiting on a confirmation would wait forever.
 *   • It says there is no reset link, because there isn't one — a lost password
 *     comes back through us, and a school that doesn't know that will assume
 *     the page is broken.
 *   • It says the login is shared, so the first person to receive it doesn't
 *     treat it as personal and sit on it.
 */
export function handoverText(
  school: string,
  email: string,
  password: string
): string {
  return [
    `Sharwin Academy — ${school}`,
    "",
    "You can now see how your pupils are getting on in our sessions: who attended, how each child is progressing, and the coaches' notes on them.",
    "",
    "Tap here and you will be signed in straight away — nothing to type:",
    instantLoginUrl(email, password),
    "",
    `If that link doesn't work, go to ${APP_ORIGIN}${SCHOOL_LOGIN_PATH} and type these:`,
    "",
    `Email: ${email}`,
    `Password: ${password}`,
    "",
    isSyntheticEmail(email)
      ? 'That email is only a username — nothing is ever sent to it, and there is no "forgot password" link, so please keep this message.'
      : 'There is no "forgot password" link on this page, so please keep this message.',
    "",
    "Anyone at the school can use the same login, so do share this with your colleagues — but not more widely: the link above signs in whoever taps it. Tell us if you would like the details changed and we will send new ones.",
  ].join("\n");
}
