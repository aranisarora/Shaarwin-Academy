import type { Metadata } from "next";
import Image from "next/image";
import { StageShell } from "@/components/shells/StageShell";
import { getCoaches } from "@/lib/data";

export const metadata: Metadata = {
  title: "Coaches",
  description: "Meet the Sharwin TTA coaching team.",
};

export default async function CoachesPage() {
  const coaches = await getCoaches();

  return (
    <StageShell>
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-28">
        <p className="label mb-3">The team</p>
        <h1 className="font-display mb-4 text-4xl md:text-6xl">The coaches</h1>
        <p className="mb-12 max-w-md text-lg text-smoke">
          Every session — group or private — is taught by one of these people.
        </p>

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
              <p className="label mt-0.5">Teaches to {coach.level}</p>
              <p className="mt-2 text-sm text-smoke">{coach.bio}</p>
            </article>
          ))}
        </div>
      </div>
    </StageShell>
  );
}
