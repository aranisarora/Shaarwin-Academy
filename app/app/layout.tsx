import type { Viewport } from "next";
import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorkerRegistrar";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { PushPrompt } from "@/components/app/PushPrompt";

// Everything below here is the ivory studio shell, so Android should tint the
// address bar to match rather than to the ink the marketing site asks for. Only
// themeColor changes; the root's viewport-fit, colour scheme and keyboard
// behaviour merge through untouched. The offline strip is StudioShell's job now
// — in flow, above the header, where it can't cover anything.
export const viewport: Viewport = { themeColor: "#F4F1EA" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistrar />
      {children}
      <InstallPrompt />
      <PushPrompt />
    </>
  );
}
