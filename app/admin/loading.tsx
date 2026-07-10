import { AdminShell } from "@/components/app/AdminShell";
import { Skeleton, PageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <AdminShell title={<Skeleton className="h-6 w-32" />}>
      <PageSkeleton />
    </AdminShell>
  );
}
