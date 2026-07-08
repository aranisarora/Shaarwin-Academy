import { Reveal } from "@/components/Reveal";
import { TESTIMONIALS } from "@/lib/testimonials";

/** Student stories — clean quote cards, from → now in two short lines. */
export function Testimonials() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
      <Reveal>
        <p className="label mb-3">Student stories</p>
        <h2 className="font-display mb-10 max-w-[22ch] text-3xl md:text-5xl">
          Real results. Real players.
        </h2>
      </Reveal>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {TESTIMONIALS.map((t, i) => (
          <Reveal key={t.name} delay={(i % 3) * 90}>
            <figure className="flex h-full flex-col rounded-[12px] border border-line bg-ink-2 p-6">
              <blockquote className="flex-1">
                <p className="text-smoke">
                  <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-slate">
                    Before
                  </span>
                  {t.before}
                </p>
                <p className="mt-4 text-ivory">
                  <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-ember">
                    Now
                  </span>
                  {t.after}
                </p>
              </blockquote>
              <figcaption className="mt-6 flex items-baseline justify-between border-t border-line pt-4">
                <span className="font-medium text-ivory">{t.name}</span>
                <span className="label">{t.duration} in</span>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
