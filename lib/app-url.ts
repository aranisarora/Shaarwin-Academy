// The origin we are allowed to put in a link that LEAVES the building.
//
// Every WhatsApp reply the bot composes, every message a founder pastes into a
// thread, every deep link in a notification — all of them are read on someone
// else's phone, on a network that has never heard of this machine. A link is
// only useful there if it points at the public origin.
//
// The whole file exists because `process.env.NEXT_PUBLIC_APP_URL ?? PROD` does
// NOT give you that. `??` falls back when the variable is UNSET; it does
// nothing when the variable is SET TO THE WRONG THING. `.env.local` in this
// repo sets `NEXT_PUBLIC_APP_URL=http://localhost:3000`, which is correct for
// `next dev` and fatal for anything sent outbound — so a bot answering a real
// coach from a dev process replied `http://localhost:3000/coach/session/…`,
// a link that resolves to the coach's own phone and shows nothing.
//
// scripts/whatsapp/provision-templates.mjs already refuses to bake a localhost
// URL into a WhatsApp template, for exactly this reason, and its comment claims
// "a URL passed as a template variable is resolved at send time by the worker
// and is safe". That was only ever true of the Deno worker, which reads its own
// `APP_URL` secret. The Next.js side resolves at send time too — out of the
// variable this guard now checks.
//
// NOT for in-app links. `app/layout.tsx`, `sitemap.ts` and `robots.ts` want the
// origin the browser is actually on, localhost included. This is the outbound
// rule only.

/** Where the public app lives when the environment can't be trusted to say. */
export const PRODUCTION_APP_URL = "https://sharwinacademy.com";

/**
 * Validate a candidate origin for outbound use. Returns the trimmed origin, or
 * null when it is anything a stranger's phone cannot open.
 *
 * Accepts any https origin, so Vercel previews and a future custom domain keep
 * working without a code change. Rejects:
 *   - empty / unset
 *   - non-https (an http link is a broken link on WhatsApp anyway, and every
 *     real deployment terminates TLS)
 *   - loopback and private hosts, however they are spelled
 *   - anything that isn't a parseable URL
 */
export function validateOutboundOrigin(raw: string | undefined | null): string | null {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;

  // Hostname only — `new URL` has already stripped any port and userinfo, so
  // there is no "localhost:3000" spelling left to sneak past a bare compare.
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    // Private ranges: a LAN address in a message is the same failure as
    // localhost, one desk further away.
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return null;
  }

  return value;
}

/**
 * The base URL for a link we are about to send someone. Never throws and never
 * returns a dev origin: a wrong-but-reachable production link beats a link that
 * cannot resolve, because the first one lands the reader somewhere they can
 * navigate from and the second one is a dead end.
 *
 * The one-time warning is the point of the fallback being silent-ish — it makes
 * a misconfigured deployment visible in the function logs instead of only in a
 * coach's confusion.
 */
let warned = false;
export function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const valid = validateOutboundOrigin(configured);
  if (valid) return valid;

  if (configured && !warned) {
    warned = true;
    console.warn(
      `app-url: NEXT_PUBLIC_APP_URL=${configured} is not a public https origin — ` +
        `outbound links fall back to ${PRODUCTION_APP_URL}.`
    );
  }
  return PRODUCTION_APP_URL;
}

/** Test seam: forget that we've already warned. */
export function resetAppUrlWarning(): void {
  warned = false;
}
