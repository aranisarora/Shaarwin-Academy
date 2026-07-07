import { OfflineBanner } from "@/components/app/OfflineBanner";
import { RealtimeRefresh } from "@/components/app/RealtimeRefresh";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OfflineBanner />
      <RealtimeRefresh tables={["class_sessions", "coach_assignments", "bookings"]} />
      {children}
    </>
  );
}
