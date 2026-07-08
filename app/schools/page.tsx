import type { Metadata } from "next";
import { StageShell } from "@/components/shells/StageShell";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/Reveal";
import { whatsappLink, CONTACT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "For schools",
  description:
    "A complete table tennis programme for schools — PE coaching for grades 1–12, after-school training, team practice and a pathway from internal tournaments to the national level.",
};

const offerings = [
  {
    title: "PE & classroom coaching",
    body: "Structured sessions for every grade, 1 through 12. We slot into your PE timetable and take students from the very basics — grip, stance, the first rally — through to advanced strokes and match play, at a pace matched to each age group.",
  },
  {
    title: "After-school programme",
    body: "For students who want to go further. A focused pathway for those aiming to make the school team: personalised, skill-building training that sharpens technique, footwork and match temperament.",
  },
  {
    title: "Morning team practice",
    body: "Dedicated pre-school sessions for your school squad — consistent, disciplined practice that keeps your strongest players sharp and match-ready right through the season.",
  },
  {
    title: "Structured lesson plans",
    body: "Every programme runs on a written, progressive curriculum — clear objectives, drills and milestones for each grade and level, so progress is visible and measurable term over term.",
  },
];

const pathway = [
  {
    stage: "Internal tournaments",
    body: "Regular in-school competitions that get every student playing, build a competitive culture, and surface your strongest talent.",
  },
  {
    stage: "Interschool",
    body: "We enter and prepare your teams for interschool competition across the city — the first taste of representing the school.",
  },
  {
    stage: "State level",
    body: "Squads are trained and mentored to compete against the best in Karnataka, on the state stage.",
  },
  {
    stage: "National level",
    body: "The strongest players go all the way — coached and mentored to represent the school at the national championships.",
  },
];

const pitchMessage =
  "Hi Sharwin TTA! We'd like to talk about a table tennis programme for our school.";

export default function SchoolsPage() {
  return (
    <StageShell>
      {/* HERO */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-28 md:pb-20 md:pt-32">
        <Reveal>
          <p className="label mb-4">For schools</p>
          <h1 className="font-display max-w-[16ch] text-4xl leading-[1.05] md:text-6xl">
            Table tennis, built into school life
          </h1>
          <p className="mt-6 max-w-[60ch] text-lg text-smoke md:text-xl">
            A complete, structured table tennis programme for schools across
            Bengaluru — from first-time players in the classroom to competitors
            representing the school at the national level. Delivered on your
            campus, by ITTF- and PTT-certified coaches.
          </p>
        </Reveal>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* WHAT WE DELIVER */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <Reveal>
          <p className="label mb-3">What we deliver</p>
          <h2 className="font-display mb-10 max-w-[20ch] text-3xl md:text-5xl">
            From the classroom up
          </h2>
        </Reveal>
        <div className="grid gap-4 md:grid-cols-2">
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
            Something to play for
          </h2>
          <p className="mb-12 max-w-[56ch] text-lg text-smoke">
            We don&apos;t just teach the game — we give students a reason to
            train, and a clear route to rise through the levels.
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
              Bring Sharwin Table Tennis Academy to your school
            </h2>
            <p className="mt-4 max-w-[56ch] text-lg text-smoke">
              Planning a programme for your students? Start a conversation and
              we&apos;ll build it around your school&apos;s timetable, grades
              and goals.
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
