import { CoachShell } from "@/components/app/CoachShell";
import { Skeleton, PageSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <CoachShell title={<Skeleton className="h-6 w-32" />}>
      <PageSkeleton />
    </CoachShell>
  );
}
