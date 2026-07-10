import { ClientShell } from "@/components/app/ClientShell";
import { Skeleton, PageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <ClientShell title={<Skeleton className="h-6 w-32" />}>
      <PageSkeleton />
    </ClientShell>
  );
}
