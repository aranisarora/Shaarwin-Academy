// The one lock on the site.
//
// /schedule is the founder's page now: every class this week, the private
// lessons at people's homes included. There is no account to sign into any
// more — a phone number is the identity everywhere else — so the door is a
// link. The assistant hands the owner https://sharwinacademy.com/schedule?key=…
// and nobody else; proxy.ts trades the key in that URL for a cookie and takes
// the key off the address bar; the page trusts only the cookie.
//
// The cookie carries a digest of the key rather than the key itself, and every
// comparison is between digests of equal length, so neither the cookie nor the
// timing of a refusal says anything about the secret. Rotating
// SCHEDULE_ADMIN_KEY on Vercel logs every phone out at once — that is the whole
// of the revocation story, and all it needs.
//
// No key configured means no way in. A page that fails open on the day an env
// var goes missing is exactly the leak this exists to close.

export const GATE_COOKIE = "sharwin_schedule";

/** A year. He opens this from a link on his own phone; asking again sooner is
 *  a nuisance that buys nothing, since the link is the same link. */
export const GATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time over two strings of equal length; false at once otherwise. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function configuredKey(): string | null {
  const key = process.env.SCHEDULE_ADMIN_KEY?.trim();
  return key ? key : null;
}

/** What the cookie holds once a key has been accepted. */
export async function gateCookieValue(key: string): Promise<string> {
  return sha256Hex(`sharwin-schedule:${key}`);
}

/** Does this key, offered in a URL, open the page? */
export async function keyOpens(offered: string): Promise<boolean> {
  const key = configuredKey();
  if (!key) return false;
  const [a, b] = await Promise.all([sha256Hex(offered), sha256Hex(key)]);
  return sameString(a, b);
}

/** Does this cookie, sent with a request, open the page? */
export async function cookieOpens(value: string | undefined): Promise<boolean> {
  const key = configuredKey();
  if (!key || !value) return false;
  return sameString(value, await gateCookieValue(key));
}
