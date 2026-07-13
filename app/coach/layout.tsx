import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorkerRegistrar";
import { OfflineBanner } from "@/components/app/OfflineBanner";
import { RealtimeRefresh } from "@/components/app/RealtimeRefresh";
import { InstallPrompt } from "@/components/app/InstallPrompt";

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistrar />
      <OfflineBanner />
      <RealtimeRefresh tables={["bookings", "class_sessions"]} />
      {children}
      <InstallPrompt />
    </>
  );
}
