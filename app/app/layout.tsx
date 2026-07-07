import { ServiceWorkerRegistrar } from "@/components/app/ServiceWorkerRegistrar";
import { OfflineBanner } from "@/components/app/OfflineBanner";
import { InstallPrompt } from "@/components/app/InstallPrompt";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistrar />
      <OfflineBanner />
      {children}
      <InstallPrompt />
    </>
  );
}
