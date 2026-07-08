import type { Metadata } from "next";
import { StageShell } from "@/components/shells/StageShell";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/Reveal";
import { whatsappLink, CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "For colleges",
  description:
    "A table tennis programme for colleges — build and train a competitive squad for intercollege, intercity, state and national tournaments, and open the sport up to every student.",
};

const offerings = [
  {
    title: "Build & train your team",
    body: "We assemble and develop your college squad from the ground up — technique, tactics, fitness and match temperament — and prepare them for competition at intercollege, intercity, state and national level.",
  },
  {
    title: "Sport for every student",
    body: "Table tennis for the whole campus, not just the team. Sessions that get more students active, playing and engaged — a healthy, competitive sporting culture across the college.",
  },
  {
    title: "Structured lesson plans",
    body: "A written, progressive curriculum for every level, from complete beginners to your competitive players — clear objectives and drills so everyone improves with purpose.",
  },
];

const pathway = [
  {
    stage: "Intercollege",
    body: "We prepare and enter your squad for intercollege fixtures — the proving ground for your strongest players.",
  },
  {
    stage: "Intercity",
    body: "Trained to travel and compete against colleges from across the region.",
  },
  {
    stage: "State level",
    body: "Coached and mentored to represent the college against the best in Karnataka.",
  },
  {
    stage: "National level",
    body: "The top players go all the way — prepared to compete on the national college stage.",
  },
];

const pitchMessage =
  "Hi Sharwin TTA! We'd like to talk about a table tennis programme for our college.";

export default function CollegesPage() {
  return (
    <StageShell>
      {/* HERO */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-28 md:pb-20 md:pt-32">
        <Reveal>
          <p className="label mb-4">For colleges</p>
          <h1 className="font-display max-w-[16ch] text-4xl leading-[1.05] md:text-6xl">
            Build a college team that competes
          </h1>
          <p className="mt-6 max-w-[60ch] text-lg text-smoke md:text-xl">
            A table tennis programme for colleges across Bengaluru — from
            opening the sport up to every student, to building and training a
            squad that competes at intercollege, intercity, state and national
            level. On your campus, led by certified coaches.
          </p>
        </Reveal>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* WHAT WE DELIVER */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <Reveal>
          <p className="label mb-3">What we deliver</p>
          <h2 className="font-display mb-10 max-w-[20ch] text-3xl md:text-5xl">
            From first serve to national squad
          </h2>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-3">
          {offerings.map((item, i) => (
            <Reveal key={item.title} delay={i * 90}>
              <div className="flex h-full flex-col rounded-[12px] border border-line bg-ink-2 p-7">
                <p className="font-display text-2xl text-ivory">{item.title}</p>
                <p className="mt-3 text-smoke">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* TOURNAMENT PATHWAY */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <Reveal>
          <p className="label mb-3">A pathway to compete</p>
          <h2 className="font-display mb-4 max-w-[22ch] text-3xl md:text-5xl">
            Every level of the game
          </h2>
          <p className="mb-12 max-w-[56ch] text-lg text-smoke">
            We train your squad to rise — from the first intercollege fixture to
            the national stage.
          </p>
        </Reveal>
        <ol className="space-y-4">
          {pathway.map((step, i) => (
            <Reveal key={step.stage} delay={i * 80}>
              <li className="flex gap-5 rounded-[12px] border border-line p-6 md:gap-7 md:p-7">
                <span
                  aria-hidden
                  className="font-display tnum text-3xl leading-none text-ember md:text-4xl"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="font-display text-xl text-ivory md:text-2xl">
                    {step.stage}
                  </p>
                  <p className="mt-2 max-w-[64ch] text-smoke">{step.body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <Reveal>
          <div className="rounded-[16px] border border-line bg-ink-2 p-8 md:p-14">
            <h2 className="font-display max-w-[18ch] text-3xl md:text-5xl">
              Bring Sharwin to your college
            </h2>
            <p className="mt-4 max-w-[56ch] text-lg text-smoke">
              Ready to build a squad worth cheering for? Start a conversation
              and we&apos;ll shape a programme around your college&apos;s goals
              and calendar.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink
                href={whatsappLink(pitchMessage)}
                target="_blank"
                rel="noopener noreferrer"
                size="lg"
              >
                Talk to us on WhatsApp
              </ButtonLink>
              <ButtonLink
                href={`mailto:${CONTACT_EMAIL}`}
                variant="ghost"
                size="lg"
              >
                Email the academy
              </ButtonLink>
            </div>
          </div>
        </Reveal>
      </section>
    </StageShell>
  );
}
