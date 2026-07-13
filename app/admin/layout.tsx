import { OfflineBanner } from "@/components/app/OfflineBanner";
import { RealtimeRefresh } from "@/components/app/RealtimeRefresh";
import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorkerRegistrar";
import { InstallPrompt } from "@/components/app/InstallPrompt";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistrar />
      <OfflineBanner />
      <RealtimeRefresh tables={["class_sessions", "coach_assignments", "bookings"]} />
      {children}
      <InstallPrompt />
    </>
  );
}
