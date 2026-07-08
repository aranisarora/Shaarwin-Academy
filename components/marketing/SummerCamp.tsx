import Image from "next/image";
import { Reveal } from "@/components/Reveal";
import { ButtonLink } from "@/components/ui/Button";

const REGISTER_HREF =
  "https://wa.me/918431435758?text=Hi%20Sharwin%20TTA%20—%20I%27d%20like%20to%20register%20interest%20for%20the%20Summer%20Camp%202026.";

/** Seasonal camp promo. Image lives at /public/images/summer-camp.jpg. */
export function SummerCamp() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
        <Reveal>
          <p className="label mb-3">Summer camp 2026</p>
          <h2 className="font-display mb-6 max-w-[20ch] text-3xl md:text-5xl">
            Sharwin Summer Camp
          </h2>
          <p className="max-w-[52ch] text-lg text-smoke">
            Bengaluru&apos;s most exciting table tennis summer camp — an
            action-packed program for players of all ages and levels. Our
            ITTF-certified coaches sharpen your technique, build your match
            instinct and fuel your passion for the sport.
          </p>
          <p className="mt-4 max-w-[52ch] text-smoke">
            First paddle or levelling up your competitive game, it&apos;s a
            transformative few weeks — skill-building, fun, and unforgettable.
          </p>
          <ButtonLink href={REGISTER_HREF} className="mt-8">
            Register interest
          </ButtonLink>
        </Reveal>
        <Reveal delay={150}>
          <div className="relative aspect-[1280/904] overflow-hidden rounded-[12px] border border-line bg-ink-2">
            <Image
              src="/images/summer-camp.jpg"
              alt="Young players training at the Sharwin summer camp"
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
