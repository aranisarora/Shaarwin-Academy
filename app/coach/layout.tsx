import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorkerRegistrar";
import { OfflineBanner } from "@/components/app/OfflineBanner";
import { RealtimeRefresh } from "@/components/app/RealtimeRefresh";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { PendingAssessments } from "@/components/app/PendingAssessments";
import { CoachPreviewBanner } from "@/components/app/CoachPreviewBanner";
import { getCoachPreview } from "@/lib/coach-preview";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const preview = await getCoachPreview();
  return (
    <>
      {preview && <CoachPreviewBanner coachName={preview.coachName} />}
      <ServiceWorkerRegistrar />
      <OfflineBanner />
      <RealtimeRefresh tables={["bookings", "class_sessions"]} />
      {children}
      <InstallPrompt />
      <PendingAssessments />
    </>
  );
}
