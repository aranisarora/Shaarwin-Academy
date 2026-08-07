// The handover: the link a school is sent, and the message it arrives in.
//
// This lives in `lib` rather than inside SchoolManager because it is the whole
// contract between two screens that never see each other. The founder's sheet
// composes the text; the school's sign-in page has to make good on every
// promise in it. If the URL shape here and the query string `/login/school`
// reads ever drift apart, the failure lands on a head teacher who has no way to
// diagnose it — so both ends import from this file, and it is unit-tested.

import { isSyntheticEmail } from "@/lib/synthetic-email";

/**
 * Where the school is told to go. Deliberately not `window.location.origin`:
 * this text gets pasted into WhatsApp and lives on a head teacher's phone for a
 * term, and a founder who opened the admin app from a Vercel preview URL would
 * be sending a link that stops resolving the week after.
 */
export const APP_ORIGIN = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://sharwinacademy.com"
).replace(/\/$/, "");

/** The school sign-in screen, without the query string. Shown in the message as
 *  the thing to type when a tapped link doesn't survive being forwarded. */
export const SCHOOL_LOGIN_PATH = "/login/school";

/**
 * The prefilled link. `?email=` fills the address in for them, which is the
 * half of the credential they gain nothing from typing: it is minted, it is
 * long, and it is not a secret — nothing is ever delivered to it and it opens
 * nothing on its own.
 *
 * The password is deliberately NOT in the URL. It is the whole of the secret,
 * and a URL is the one part of this that gets written down by machines — browser
 * history on a shared staff-room phone, a Referer header on the next outbound
 * click, an analytics path. It stays in the message body, where it is exactly as
 * exposed as the message already is and no more.
 */
export function schoolLoginUrl(email: string): string {
  return `${APP_ORIGIN}${SCHOOL_LOGIN_PATH}?email=${encodeURIComponent(email)}`;
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
 *   • The tap comes first. One link that opens the right screen with the email
 *     already in it is the shortest path that exists, and it is the path almost
 *     everyone will take.
 *   • The typed fallback comes second, in full. A link can be broken by a
 *     forward, a copy-paste that clips the query string, or a keyboard that
 *     "helpfully" capitalises it — and when it breaks, the person holding this
 *     message must still be able to get in without asking anyone.
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
    "Tap here to open your sign-in page — your email is filled in already:",
    schoolLoginUrl(email),
    "",
    "Then type this password:",
    "",
    password,
    "",
    `If that link doesn't open, go to ${APP_ORIGIN}${SCHOOL_LOGIN_PATH} and type both of these:`,
    "",
    `Email: ${email}`,
    `Password: ${password}`,
    "",
    isSyntheticEmail(email)
      ? 'That email is only a username — nothing is ever sent to it, and there is no "forgot password" link, so please keep this message.'
      : 'There is no "forgot password" link on this page, so please keep this message.',
    "",
    "Anyone at the school can use the same login. Tell us if you would like it changed and we will send new details.",
  ].join("\n");
}
