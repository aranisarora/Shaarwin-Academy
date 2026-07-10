export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-[8px] bg-line ${className}`}
    />
  );
}

/**
 * Generic page-body skeleton for `loading.tsx` route fallbacks: a hero card,
 * an action row, then a list — the shape most app screens resolve into, so
 * the swap-in causes minimal layout shift.
 */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Skeleton className="h-44 w-full rounded-[12px]" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-16 rounded-[12px]" />
        <Skeleton className="h-16 rounded-[12px]" />
        <Skeleton className="h-16 rounded-[12px]" />
      </div>
    </div>
  );
}
