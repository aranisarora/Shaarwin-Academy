import Image from "next/image";
import academyHall from "@/public/images/academy-hall.jpg";
import { Reveal } from "@/components/Reveal";
import { ButtonLink } from "@/components/ui/Button";

const APPLY_HREF =
  "https://wa.me/918431435758?text=Hi%20Sharwin%20TTA%20—%20I%27d%20like%20to%20apply%20as%20a%20coach.%20Here%20are%20my%20playing%20videos%2C%20qualifications%20and%20years%20of%20experience%3A";

/** Coach hiring section — applications come in over WhatsApp. */
export function JoinTeam() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <p className="label mb-3">We&apos;re hiring coaches</p>
          <h2 className="font-display mb-6 max-w-[22ch] text-3xl md:text-5xl">
            Join our coaching team
          </h2>
          <p className="max-w-[60ch] text-lg text-smoke">
            Passionate about table tennis? We&apos;re always looking for skilled,
            motivated coaches to join the Sharwin family. If you have a strong
            playing background and a desire to develop players at every level,
            we&apos;d love to hear from you.
          </p>
          <p className="mt-4 max-w-[60ch] text-smoke">
            To apply, send a WhatsApp message with your playing videos, coaching
            qualifications and years of experience. Our founder reviews every
            application personally.
          </p>
          <ButtonLink href={APPLY_HREF} size="lg" className="mt-8">
            Apply via WhatsApp
          </ButtonLink>
          <p className="mt-3 text-sm text-slate">
            Opens WhatsApp with a pre-filled message — just hit send.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <div className="overflow-hidden rounded-[16px] border border-line">
            <Image
              src={academyHall}
              alt="Sharwin Table Tennis Academy hall with STAG tables"
              className="h-full w-full object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
