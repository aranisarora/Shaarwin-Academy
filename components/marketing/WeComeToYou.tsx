import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { WhatsAppCta } from "@/components/marketing/WhatsAppCta";

const places: {
  title: string;
  body: string;
  href?: string;
}[] = [
  {
    title: "Your home",
    body: "We come straight to your doorstep — no commute, no hassle.",
  },
  {
    title: "Schools",
    body: "PE coaching, after-school programs, morning team practice and a full tournament pathway. We build and train your school team.",
    href: "/schools",
  },
  {
    title: "Colleges",
    body: "Team building and structured training to prepare your college squad for intercollege, state and national competition.",
    href: "/colleges",
  },
  {
    title: "Offices",
    body: "Fun, active sessions that build teamwork and morale — plus a proper office team, trained and match-ready.",
  },
];

const features = [
  {
    title: "Group classes",
    body: "Batch sessions with flexible schedules through the week, at homes, offices, schools or colleges.",
  },
  {
    title: "Private sessions",
    body: "One-to-one coaching tailored entirely to your goals and availability, conducted at your place.",
  },
  {
    title: "Booking by message",
    body: "No app, no account. Book, reschedule or cancel in one WhatsApp thread — ask and we send you the week's times.",
  },
];

/** The core differentiator: coaching comes to you, wherever you are. */
export function WeComeToYou() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
      <Reveal>
        <p className="label mb-3">Why choose us</p>
        <h2 className="font-display mb-4 max-w-[20ch] text-3xl md:text-5xl">
          We come to you
        </h2>
        <p className="mb-10 max-w-[56ch] text-lg text-smoke">
          No travel, no hassle. Our coaches bring professional table tennis
          coaching to your home, office, school or college across Bengaluru —
          on your schedule.
        </p>
      </Reveal>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {places.map((place, i) => {
          const inner = (
            <>
              <p className="font-display text-xl text-ivory">{place.title}</p>
              <p className="mt-3 text-sm text-smoke">{place.body}</p>
              {place.href && (
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ember">
                  What we do
                  <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              )}
            </>
          );
          return (
            <Reveal key={place.title} delay={i * 90}>
              {place.href ? (
                <Link
                  href={place.href}
                  className="group flex h-full flex-col rounded-[12px] border border-line bg-ink-2 p-6 transition-colors hover:border-ember"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex h-full flex-col rounded-[12px] border border-line bg-ink-2 p-6">
                  {inner}
                </div>
              )}
            </Reveal>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {features.map((feature, i) => (
          <Reveal key={feature.title} delay={i * 90}>
            <div className="flex h-full flex-col rounded-[12px] border border-line p-6">
              <p className="label mb-2 !text-ember">{feature.title}</p>
              <p className="text-sm text-smoke">{feature.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <WhatsAppCta
          className="mt-10"
          message="Hi! I'd like to book private table tennis coaching at my place."
        >
          Book on WhatsApp
        </WhatsAppCta>
      </Reveal>
    </section>
  );
}
