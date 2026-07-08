import Image from "next/image";
import Link from "next/link";
import { StageShell } from "@/components/shells/StageShell";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Reveal } from "@/components/Reveal";
import { Parallax } from "@/components/marketing/Parallax";
import { VenueMap } from "@/components/marketing/VenueMap";
import { Faq } from "@/components/marketing/Faq";
import { WeComeToYou } from "@/components/marketing/WeComeToYou";
import { Testimonials } from "@/components/marketing/Testimonials";
import { SummerCamp } from "@/components/marketing/SummerCamp";
import { JoinTeam } from "@/components/marketing/JoinTeam";
import { ContactSection } from "@/components/marketing/ContactSection";
import { getPlans, getVenues, getCoaches, formatPrice } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import heroServe from "@/public/images/hero-serve.jpg";
import heroServeMobile from "@/public/images/hero-serve-mobile.jpg";
import programGroup from "@/public/images/program-group.jpg";
import programPrivate from "@/public/images/program-private.jpg";
import textureBallLine from "@/public/images/texture-ball-line.jpg";
import founderClose from "@/public/images/founder-close.jpg";

const academyStats = [
  { value: "17+", label: "Years of coaching" },
  { value: "1,000+", label: "Students trained" },
  { value: "175+", label: "Championship titles" },
  { value: "350+", label: "Tournaments mentored" },
];

const heroBenefits = [
  "ITTF & PTT certified coaches",
  "Group classes & private 1-on-1",
  "We come to your location",
  "Every level, beginner to competitor",
];

// Real tournament photos in /public/images/tournament. Captions are keyed by
// file number; a `win` flag adds an ember badge. Uncaptioned photos stay clean.
const communityPhotos: {
  n: number;
  caption?: string;
  win?: boolean;
}[] = [
  { n: 1, caption: "ISF U18 Gymnasiade — Bahrain, 2024", win: true },
  { n: 2, caption: "CISCE National Table Tennis, 2022" },
  { n: 3, caption: "66th National School Games" },
  { n: 4 },
  { n: 5 },
  { n: 6 },
];

export default async function LandingPage() {
  const [plans, venues, coaches] = await Promise.all([
    getPlans(),
    getVenues(),
    getCoaches(),
  ]);

  const groupFrom = plans.length
    ? formatPrice(Math.min(...plans.map((p) => p.price_pence)))
    : "£180";
  const privatePlan = plans.find((p) => p.private_minutes_per_quarter > 0);

  // The WhatsApp companion needs a linked account to be useful, so it lives
  // inside the app. Signed-in visitors go straight there; everyone else is
  // pointed at sign-up first rather than a dead-end chat.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = Boolean(user);

  return (
    <StageShell>
      {/* HERO — art-directed swap: 16:9 desktop, 4:5 mobile */}
      <section className="relative min-h-[92dvh] overflow-hidden">
        <Parallax>
          <Image
            src={heroServe}
            alt="A player frozen at the moment of a serve toss in a dark tournament hall"
            fill
            priority
            placeholder="blur"
            sizes="100vw"
            className="hidden object-cover md:block"
          />
          <Image
            src={heroServeMobile}
            alt="A player frozen at the moment of a serve toss in a dark tournament hall"
            fill
            priority
            placeholder="blur"
            sizes="100vw"
            className="object-cover md:hidden"
          />
        </Parallax>
        <div className="scrim-ink-bottom absolute inset-0" aria-hidden />
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-6 pb-20 md:pb-28">
            <Reveal>
              <h1 className="display-xl max-w-[14ch] text-ivory">
                Play faster. Think faster.
              </h1>
            </Reveal>
            <Reveal delay={180}>
              <p className="mt-4 max-w-md text-lg text-smoke md:text-xl">
                Group classes across Bengaluru and private coaching at your own
                table. Taught properly, from the first serve.
              </p>
            </Reveal>
            <Reveal delay={270}>
              <ul className="mt-6 grid max-w-lg grid-cols-1 gap-x-6 gap-y-1.5 text-sm text-smoke sm:grid-cols-2">
                {heroBenefits.map((benefit) => (
                  <li key={benefit} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-ember"
                    />
                    {benefit}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={360}>
              <div className="mt-8 flex flex-wrap gap-3">
                {signedIn ? (
                  <ButtonLink href="/app" size="lg">
                    <span aria-hidden className="h-2 w-2 rounded-full bg-ivory" />
                    Book a class
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/signup" size="lg">
                    <span aria-hidden className="h-2 w-2 rounded-full bg-ivory" />
                    Book a class
                  </ButtonLink>
                )}
                <ButtonLink href="/locations" variant="ghost" size="lg">
                  See locations
                </ButtonLink>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* STATS — the record, in numbers */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-10 px-6 py-14 md:grid-cols-4 md:py-16">
          {academyStats.map((stat, i) => (
            <Reveal key={stat.label} delay={i * 90}>
              <div>
                <p className="font-display tnum text-4xl text-ivory md:text-5xl">
                  {stat.value}
                </p>
                <p className="label mt-2">{stat.label}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* PROGRAMS */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
        <Reveal>
          <p className="label mb-3">Programs</p>
          <h2 className="font-display mb-10 max-w-[22ch] text-3xl md:text-5xl">
            Two ways to get better
          </h2>
        </Reveal>
        <div className="grid gap-6 md:grid-cols-2">
          <Reveal delay={80}>
            <Link
              href="/pricing"
              className="group relative block aspect-[3/2] overflow-hidden rounded-[12px] border border-line"
            >
              <Image
                src={programGroup}
                alt="An evening group coaching session under stage lighting"
                fill
                placeholder="blur"
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              />
              <div className="scrim-card absolute inset-0" aria-hidden />
              <div className="absolute inset-x-0 bottom-0 p-6">
                <p className="label mb-1 !text-smoke">Group classes</p>
                <p className="font-display text-2xl text-ivory md:text-3xl">
                  From {groupFrom} a quarter
                </p>
              </div>
            </Link>
          </Reveal>
          <Reveal delay={220}>
            <Link
              href="/pricing"
              className="group relative block aspect-[3/2] overflow-hidden rounded-[12px] border border-line"
            >
              <Image
                src={programPrivate}
                alt="A private coaching session at a home table at dusk"
                fill
                placeholder="blur"
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              />
              <div className="scrim-card absolute inset-0" aria-hidden />
              <div className="absolute inset-x-0 bottom-0 p-6">
                <p className="label mb-1 !text-smoke">Private, at yours</p>
                <p className="font-display text-2xl text-ivory md:text-3xl">
                  {privatePlan
                    ? `${formatPrice(privatePlan.price_pence)} a quarter`
                    : "A coach at your door"}
                </p>
              </div>
            </Link>
          </Reveal>
        </div>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* WE COME TO YOU — locations served + how it works */}
      <WeComeToYou />

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* FIND US — live venues map */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
        <Reveal>
          <p className="label mb-3">Find us</p>
          <h2 className="font-display mb-10 max-w-[22ch] text-3xl md:text-5xl">
            Tables across Bengaluru
          </h2>
        </Reveal>
        <Reveal>
          <VenueMap venues={venues} />
        </Reveal>
        <Reveal>
          <ButtonLink href="/locations" variant="ghost" className="mt-10">
            See all locations
          </ButtonLink>
        </Reveal>
      </section>

      {/* PRICING banner */}
      <section className="relative overflow-hidden py-20 md:py-36">
        <Image
          src={textureBallLine}
          alt=""
          fill
          placeholder="blur"
          sizes="100vw"
          className="object-cover opacity-60"
          aria-hidden
        />
        <div className="absolute inset-0 bg-ink/60" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-6">
          <Reveal>
            <p className="label mb-3">Membership</p>
            <h2 className="font-display mb-10 max-w-[22ch] text-3xl md:text-5xl">
              Quarterly. Simple. No asterisks.
            </h2>
          </Reveal>
          <div className="grid gap-6 md:grid-cols-3">
            {plans.map((plan, i) => (
              <Reveal key={plan.id} delay={i * 120}>
                <div
                  className={`flex h-full flex-col rounded-[12px] border bg-ink-2 p-6 ${
                    i === 1 ? "border-ember" : "border-line"
                  }`}
                >
                  {i === 1 && <p className="label mb-2 !text-ember">Most popular</p>}
                  <p className="font-display text-xl text-ivory">{plan.name}</p>
                  <p className="font-display tnum mt-2 text-4xl text-ivory">
                    {formatPrice(plan.price_pence)}
                    <span className="ml-1 font-ui text-sm text-smoke">/ quarter</span>
                  </p>
                  <p className="mt-3 flex-1 text-sm text-smoke">{plan.description}</p>
                  <ButtonLink
                    href={`/signup?plan=${plan.id}`}
                    variant={i === 1 ? "primary" : "ghost"}
                    className="mt-6"
                  >
                    Choose {plan.name}
                  </ButtonLink>
                </div>
              </Reveal>
            ))}
            {plans.length === 0 && (
              <p className="text-smoke">
                Plans are being set up — check back shortly.
              </p>
            )}
          </div>
        </div>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* FOUNDER */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
        <div className="grid items-center gap-10 md:grid-cols-[380px_1fr] md:gap-16">
          <Reveal>
            <div className="relative aspect-[4/5] overflow-hidden rounded-[12px] border border-line">
              <Image
                src={founderClose}
                alt="Portrait of Stalin Prabhu C, founder and head coach"
                fill
                placeholder="blur"
                sizes="(min-width: 768px) 380px, 100vw"
                className="object-cover"
              />
            </div>
          </Reveal>
          <Reveal delay={150}>
            <p className="label mb-3">The founder</p>
            <h2 className="font-display mb-6 max-w-[20ch] text-3xl md:text-5xl">
              Stalin Prabhu C
            </h2>
            <ul className="mb-6 flex flex-wrap gap-1.5">
              {[
                "ITTF certified",
                "PTT certified",
                "17+ years",
                "National-level coach",
                "International tournaments",
              ].map((chip) => (
                <li
                  key={chip}
                  className="rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-2"
                >
                  {chip}
                </li>
              ))}
            </ul>
            <p className="max-w-[52ch] text-lg text-smoke">
              ITTF and Para Table Tennis certified, Stalin has coached at the
              national level for over seventeen years. He led India&apos;s
              Under-19 ISSO team at the world championships in Bahrain in
              2024, and coaches Karnataka&apos;s CISCE squads — Under-14
              through Under-19 — at the national table tennis championships.
            </p>
            <p className="mt-4 max-w-[52ch] text-smoke">
              His method is simple: precise mechanics, structured discipline,
              and a calm head under pressure come before trophies. He coaches
              to build character and a lifelong love for the sport — every
              drill and every session is intentional.
            </p>
            <p className="mt-4 max-w-[52ch] text-smoke">
              Frustrated by the gap between elite coaching and everyday access,
              Stalin built Sharwin on one bold idea: bring the coach to you.
              No expensive clubs, no long commutes — world-class training at
              your doorstep, on your schedule. Today, with over 1,000 students
              trained and a team of nine certified coaches, it&apos;s
              Bengaluru&apos;s most accessible table tennis academy.
            </p>
            <blockquote className="mt-6 border-l-2 border-ember pl-4">
              <p className="font-display text-xl text-ivory md:text-2xl">
                &ldquo;Every player deserves a coach who believes in them — not
                just at the table, but in life. That&apos;s what Sharwin stands
                for.&rdquo;
              </p>
            </blockquote>
            <ButtonLink href="/signup" className="mt-8">
              Start your journey
            </ButtonLink>
          </Reveal>
        </div>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* MISSION VIDEO — the coach, in his own words */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
        <Reveal>
          <p className="label mb-3">Straight from the source</p>
          <h2 className="font-display mb-4 max-w-[22ch] text-3xl md:text-5xl">
            Hear it from the coach
          </h2>
          <p className="mb-10 max-w-[56ch] text-lg text-smoke">
            Stalin on the philosophy, the vision, and why he built Sharwin the
            way he did — in his own words.
          </p>
        </Reveal>
        <Reveal>
          <div className="relative aspect-video overflow-hidden rounded-[12px] border border-line bg-ink-2">
            <video
              controls
              preload="none"
              poster="/images/founder-hall.jpg"
              className="h-full w-full object-cover"
            >
              <source src="/videos/founder-mission.mp4" type="video/mp4" />
              Your browser doesn&apos;t support embedded video.
            </video>
          </div>
        </Reveal>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* COACHES */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
        <Reveal>
          <p className="label mb-3">The coaches</p>
          <h2 className="font-display mb-10 max-w-[22ch] text-3xl md:text-5xl">
            One studio, one standard
          </h2>
        </Reveal>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {coaches.slice(0, 5).map((coach, i) => (
            <Reveal key={coach.slug} delay={i * 90}>
              <div>
                <div className="relative aspect-[4/5] overflow-hidden rounded-[12px] border border-line">
                  <Image
                    src={coach.image}
                    alt={`Portrait of coach ${coach.name}`}
                    fill
                    sizes="(min-width: 1024px) 20vw, 40vw"
                    className="object-cover"
                  />
                </div>
                <p className="mt-3 font-medium text-ivory">{coach.name}</p>
                {coach.credentials && coach.credentials.length > 0 ? (
                  <p className="mt-1 text-xs text-smoke">
                    {coach.credentials.join(" · ")}
                  </p>
                ) : null}
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <ButtonLink href="/coaches" variant="ghost" className="mt-10">
            Meet all the coaches
          </ButtonLink>
        </Reveal>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* TESTIMONIALS — student stories */}
      <Testimonials />

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* COMMUNITY — real tournament photos */}
      <section className="mx-auto max-w-6xl px-6 py-20 md:py-36">
        <Reveal>
          <p className="label mb-3">The academy</p>
          <h2 className="font-display mb-10 max-w-[24ch] text-3xl md:text-5xl">
            Tournaments, ladders, and a lot of table time
          </h2>
        </Reveal>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {communityPhotos.map((photo, i) => (
            <Reveal key={photo.n} delay={(i % 3) * 100}>
              <div className="group relative aspect-[3/2] overflow-hidden rounded-[12px] border border-line">
                <Image
                  src={`/images/tournament/Group${photo.n}.jpeg`}
                  alt={photo.caption ?? "Players at a Sharwin TTA tournament"}
                  fill
                  sizes="(min-width: 768px) 33vw, 50vw"
                  className="object-cover"
                />
                {photo.win && (
                  <div className="absolute right-3 top-3">
                    <Badge tone="ember" className="bg-ink/80 backdrop-blur">
                      Win
                    </Badge>
                  </div>
                )}
                {photo.caption && (
                  <>
                    <div className="scrim-card absolute inset-0" aria-hidden />
                    <p className="absolute inset-x-0 bottom-0 p-4 text-sm font-medium text-ivory">
                      {photo.caption}
                    </p>
                  </>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* SUMMER CAMP */}
      <SummerCamp />

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* JOIN OUR TEAM — hiring coaches */}
      <JoinTeam />

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 py-20 md:py-36">
        <Reveal>
          <p className="label mb-3">Questions</p>
          <h2 className="font-display mb-10 text-3xl md:text-5xl">Before you ask</h2>
        </Reveal>
        <Faq />
      </section>

      <SectionDivider className="mx-auto max-w-6xl px-6" />

      {/* CONTACT */}
      <ContactSection />

      {/* Sticky bottom CTA — phones only */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/95 p-3 backdrop-blur sm:hidden">
        <ButtonLink href={signedIn ? "/app" : "/signup"} className="w-full">
          {signedIn ? "Open your app" : "Find a class"}
        </ButtonLink>
      </div>
    </StageShell>
  );
}
