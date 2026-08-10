import type { Viewport } from "next";
import { RealtimeRefresh } from "@/components/app/RealtimeRefresh";
import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorkerRegistrar";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { PushPrompt } from "@/components/app/PushPrompt";

// Everything below here is the ivory studio shell, so Android should tint the
// address bar to match rather than to the ink the marketing site asks for. Only
// themeColor changes; the root's viewport-fit, colour scheme and keyboard
// behaviour merge through untouched.
export const viewport: Viewport = { themeColor: "#F4F1EA" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistrar />
      <RealtimeRefresh tables={["class_sessions", "coach_assignments", "bookings"]} />
      {children}
      <InstallPrompt />
      <PushPrompt />
    </>
  );
}
