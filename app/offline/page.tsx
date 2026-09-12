import type { Metadata } from "next";

export const metadata: Metadata = { title: "You're offline" };

// Button's own classes, spelled out. This one link cannot be a ButtonLink: see
// the note below on why it has to be a plain anchor.
const RETRY_CLASSES =
  "pressable inline-flex items-center justify-center gap-2 rounded-[8px] font-semibold select-none " +
  "bg-ember text-ivory hover:bg-ember-2 active:bg-ember-2 min-h-11 px-5 text-base";

/**
 * Where a navigation lands when there is no network.
 *
 * The service worker precaches this one document and serves it for any failed
 * navigation. Installed to the Home Screen, the app fills the whole screen with
 * no address bar, so a dead navigation used to show the browser's own error
 * page — the dinosaur — inside what the user believes is our app. Same phone,
 * same signal, but it reads as "Sharwin is broken" rather than "you're in a
 * lift".
 *
 * Deliberately holds no data and no client component: it has to render from a
 * cached HTML document with nothing else available, so anything that needed a
 * fetch or a hydrated bundle would defeat the point.
 *
 * The link back is a plain anchor with an empty href, which reloads whatever
 * URL is in the address bar. The service worker only substitutes the BODY of a
 * failed navigation, so the address bar still holds the page the person was
 * asking for — a real retry is free. It used to be a ButtonLink to /app, which
 * threw that away and sent everyone to the client app: wrong for a coach, a
 * founder or a school (the proxy bounces them straight out again) and wrong for
 * anyone not signed in.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-6 text-center text-fg">
      <p className="label">No connection</p>
      <h1 className="mt-3 font-display text-3xl">You&apos;re offline</h1>
      <p className="mt-3 max-w-[34ch] text-fg-2">
        Sharwin can&apos;t reach us from here. Your schedule comes straight back
        when your signal does — nothing has been lost.
      </p>
      <a href="" className={`${RETRY_CLASSES} mt-8`}>
        Try again
      </a>
    </main>
  );
}
