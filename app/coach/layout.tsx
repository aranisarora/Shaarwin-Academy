import { Suspense } from "react";
import type { Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorkerRegistrar";
import { RealtimeRefresh } from "@/components/app/RealtimeRefresh";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { PushPrompt } from "@/components/app/PushPrompt";
import { LocationPrompt } from "@/components/app/LocationPrompt";
import { CoachWrapUpPrompt } from "@/components/app/CoachWrapUpPrompt";
import { PreviewBanner } from "@/components/app/PreviewBanner";
import { getCoachPreview } from "@/lib/coach-preview";
import { exitCoachView } from "@/app/coach/preview-actions";

// Everything below here is the ivory studio shell, so Android should tint the
// address bar to match rather than to the ink the marketing site asks for. Only
// themeColor changes; the root's viewport-fit, colour scheme and keyboard
// behaviour merge through untouched.
export const viewport: Viewport = { themeColor: "#F4F1EA" };

/**
 * The founder-only "view as coach" banner, isolated in its own async component
 * behind Suspense rather than awaited in the layout body. A layout that reads
 * runtime data suppresses loading.tsx for everything below it — navigation to
 * every /coach route would block on this resolving instead of showing the
 * skeleton. It reads cookies on every request, and on a real preview makes
 * three more Supabase calls. Nothing renders for an ordinary coach, so the
 * fallback is null.
 */
async function CoachPreview() {
  const preview = await getCoachPreview();
  if (!preview) return null;
  return (
    <PreviewBanner
      who={preview.coachName}
      onExit={exitCoachView}
      backTo="/admin/coaches"
    />
  );
}

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <CoachPreview />
      </Suspense>
      <ServiceWorkerRegistrar />
      <RealtimeRefresh tables={["bookings", "class_sessions"]} />
      {children}
      <InstallPrompt />
      {/* One permission dialog at a time, and push goes first — turn
          notifications on, then be told what they will be about. The location
          ask appears the moment push stops asking, which for a coach who taps
          "Turn on notifications" is immediately. Coaches only: this is the one
          shell where an arrival exists to be marked. */}
      <PushPrompt thenAsk={<LocationPrompt />} />
      <CoachWrapUpPrompt />
    </>
  );
}
