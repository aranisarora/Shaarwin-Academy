import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import { StageShell } from "@/components/shells/StageShell";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCoaches } from "@/lib/data";

export const metadata: Metadata = {
  title: "Coaches",
  description: "Meet the Sharwin Table Tennis Academy coaching team.",
};

async function CoachGrid() {
  const coaches = await getCoaches();
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
      {coaches.map((coach) => (
        <article key={coach.slug}>
          <div className="relative aspect-[4/5] overflow-hidden rounded-[12px] border border-line">
            <Image
              src={coach.image}
              alt={`Portrait of coach ${coach.name}`}
              fill
              sizes="(min-width: 1024px) 25vw, 50vw"
              className="object-cover"
            />
          </div>
          <h2 className="mt-3 font-medium">{coach.name}</h2>
          {coach.credentials && coach.credentials.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {coach.credentials.map((c) => (
                <li
                  key={c}
                  className="rounded-full border border-ember px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ember"
                >
                  {c}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-smoke">{coach.bio}</p>
          {coach.quote && (
            <p className="mt-3 text-sm italic text-slate">
              &ldquo;{coach.quote}&rdquo;
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function CoachGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[4/5] w-full rounded-[12px]" />
          <Skeleton className="mt-3 h-5 w-2/3" />
          <Skeleton className="mt-3 h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

export default function CoachesPage() {
  return (
    <StageShell>
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-28">
        <p className="label mb-3">The team</p>
        <h1 className="font-display mb-4 text-4xl md:text-6xl">The coaches</h1>
        <p className="mb-12 max-w-md text-lg text-smoke">
          Every session — group or private — is taught by one of these people.
        </p>

        <Suspense fallback={<CoachGridSkeleton />}>
          <CoachGrid />
        </Suspense>
      </div>
    </StageShell>
  );
}
