import { SchoolShell } from "@/components/app/SchoolShell";
import { PageSkeleton, Skeleton } from "@/components/ui/Skeleton";

/** The shell paints instantly on navigation and the roster fills in under it —
 * the same deal /app, /coach and /admin already get. */
export default function Loading() {
  return (
    <SchoolShell title={<Skeleton className="h-6 w-32" />}>
      <div className="mx-auto max-w-2xl">
        <PageSkeleton />
      </div>
    </SchoolShell>
  );
}
