import { Suspense } from "react";
import type { Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorkerRegistrar";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { PreviewBanner } from "@/components/app/PreviewBanner";
import { createClient } from "@/lib/supabase/server";
import { getSchoolPreview } from "@/lib/school-preview";
import { exitSchoolView } from "@/app/school/preview-actions";
import { getCampuses, campusLabel } from "@/lib/school";

// Everything below here is the ivory studio shell, so Android should tint the
// address bar to match rather than to the ink the marketing site asks for. Only
// themeColor changes; the root's viewport-fit, colour scheme and keyboard
// behaviour merge through untouched.
export const viewport: Viewport = { themeColor: "#F4F1EA" };

/**
 * The founder-only "view as school" banner, isolated in its own async component
 * behind Suspense rather than awaited in the layout body — same reasoning as the
 * coach one: a layout that reads runtime data suppresses loading.tsx for
 * everything below it, so every /school navigation would block on this instead
 * of showing the skeleton. Nothing renders for a real school, so the fallback is
 * null.
 *
 * `getCampuses` is the same request-cached call the page itself makes, and it is
 * already preview-scoped, so naming the campus here costs no extra round trip.
 */
async function SchoolPreview() {
  const preview = await getSchoolPreview();
  if (!preview) return null;
  const supabase = await createClient();
  return (
    <PreviewBanner
      who={campusLabel(await getCampuses(supabase))}
      onExit={exitSchoolView}
      backTo="/admin/schools"
    />
  );
}

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
      <Suspense fallback={null}>
        <SchoolPreview />
      </Suspense>
      <ServiceWorkerRegistrar />
      {children}
      <InstallPrompt />
    </>
  );
}
