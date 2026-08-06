import type { Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorkerRegistrar";
import { InstallPrompt } from "@/components/app/InstallPrompt";

// Everything below here is the ivory studio shell, so Android should tint the
// address bar to match rather than to the ink the marketing site asks for. Only
// themeColor changes; the root's viewport-fit, colour scheme and keyboard
// behaviour merge through untouched.
export const viewport: Viewport = { themeColor: "#F4F1EA" };

/**
 * /school was the one signed-in area sitting outside the PWA: three pages and no
 * layout, so unlike /app, /coach and /admin it never registered the service
 * worker, never said anything when the connection dropped, and never offered to
 * go on the home screen. A head of sport opens this on a phone in a corridor
 * like everyone else, so it gets the same chrome. (The offline strip now comes
 * with the shell itself, so it isn't listed here.)
 *
 * No RealtimeRefresh, though — the roster is read-only and nothing on these
 * screens changes underneath you while you're reading it.
 */
export default function SchoolLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistrar />
      {children}
      <InstallPrompt />
    </>
  );
}
