import Link from "next/link";
import Image from "next/image";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CalendarDays,
  Users,
  Clock,
  MapPin,
  Star,
  Quote,
  Trophy,
  ChevronRight,
  Award,
} from "lucide-react";

const FOUNDER_IMAGE = "/images/stalin.jpeg";

const socialProofImages: Array<{ src: string; caption: string }> = [
  { src: "/images/Group1.jpeg", caption: "ISF U18 Gymnasiade – Bahrain, 2024" },
  { src: "/images/Group2.jpeg", caption: "ISF U18 Gymnasiade – Bahrain, 2024" },
  { src: "/images/Group3.jpeg", caption: "ISF U18 Gymnasiade – Bahrain, 2024" },
  { src: "/images/Group4.jpeg", caption: "ISF U18 Gymnasiade – Bahrain, 2024" },
  { src: "/images/Group5.jpeg", caption: "CISE Sports and games National Table Tennis 2022" },
  { src: "/images/Group6.jpeg", caption: "CISE Sports and games National Table Tennis 2022" },
  { src: "/images/Group7.jpeg", caption: "66th National school games competition" },
];

const coaches = [
  {
    name: "Augustine",
    initials: "AU",
    image: "",
    specialty: "Footwork & Movement",
    bio: "A seasoned coach with over 7 years of experience, Augustine specialises in footwork mechanics and court positioning. His methodical approach has helped players at every level dramatically improve their agility and table coverage. Over 150 students trained — many representing their districts and states.",
  },
  {
    name: "Jerald",
    initials: "JE",
    image: "",
    specialty: "Offensive Techniques",
    bio: "With 7 years of coaching and a former state-level competitor background, Jerald brings authentic tournament experience to every session. He has a rare ability to identify each player's natural strengths and amplify them strategically — ideal for intermediate and advanced players.",
  },
  {
    name: "Mahaveer",
    initials: "MA",
    image: "",
    specialty: "Defensive Play & Fundamentals",
    bio: "Renowned for patient, detail-oriented teaching, Mahaveer excels at building solid foundational habits that serve players throughout their careers. His structured programs blend technical drills with match simulations for match-ready confidence from day one.",
  },
  {
    name: "Purnendu",
    initials: "PU",
    image: "",
    specialty: "Serve, Return & Spin Mechanics",
    bio: "A specialist in serve-and-return strategy with 7+ years of experience. Celebrated for deep knowledge of spin mechanics and placement precision. His coaching philosophy centres on outsmarting opponents — invaluable for players wanting a complete, nuanced style.",
  },
  {
    name: "Sambath",
    initials: "SA",
    image: "",
    specialty: "Mental Performance & Match Strategy",
    bio: "Sharwin's mental performance specialist integrates sports psychology principles into every session. Concentration drills, pressure simulation, and strategic game planning have helped countless students break through plateaus and compete with calm consistency.",
  },
];

const testimonials = [
  {
    name: "Rajan K.",
    duration: "3 months",
    coach: "Augustine",
    before: "Couldn't sustain a 10-shot rally. Struggled with basic footwork and felt completely lost on the table.",
    after: "Won my first club-level tournament. My footwork is unrecognisable — I'm confident chasing wide balls I used to miss entirely.",
    rating: 5,
  },
  {
    name: "Priya S.",
    duration: "4 months",
    coach: "Jerald",
    before: "Played purely defensively out of fear. Fast topspin balls terrified me and I had no attacking game.",
    after: "I've built a confident, aggressive playstyle. Won two local matches last month and I'm no longer afraid of fast, heavy play.",
    rating: 5,
  },
  {
    name: "Arjun M.",
    duration: "6 months",
    coach: "Mahaveer",
    before: "A complete beginner who had never held a paddle properly. Absolutely zero match experience.",
    after: "Competed in my first intra-club tournament and placed in the top half. The structured, patient coaching made all the difference.",
    rating: 5,
  },
  {
    name: "Divya R.",
    duration: "2 months",
    coach: "Purnendu",
    before: "Predictable serves and weak returns. Opponents easily read my game and exploited it every time.",
    after: "My win rate jumped from 20% to over 60%. Opponents now struggle to anticipate my serves — it has completely changed my game.",
    rating: 5,
  },
  {
    name: "Karthik V.",
    duration: "5 months",
    coach: "Sambath",
    before: "I crumbled under match pressure even when technically superior to my opponents. Lost close games repeatedly.",
    after: "I'm calmer, sharper, and far more consistent in matches. The mental training rewired how I approach competition entirely.",
    rating: 5,
  },
  {
    name: "Sneha L.",
    duration: "8 months",
    coach: "Multiple Coaches",
    before: "Joined purely to stay active. No real ambition to compete — just wanted some exercise.",
    after: "Now a passionate competitive player representing my office team in inter-corporate tournaments. Sharwin changed everything.",
    rating: 5,
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">

        {/* ── Hero ── */}
        <section className="relative bg-primary text-primary-foreground overflow-hidden">
          <div className="container mx-auto px-4 py-16 lg:py-24">
            <div className="grid lg:grid-cols-2 gap-12 items-center">

              {/* Text + CTAs */}
              <div className="text-center lg:text-left order-2 lg:order-1">
                <div className="inline-block rounded-full border border-primary-foreground/20 px-4 py-1.5 text-sm font-medium mb-6 text-primary-foreground/80">
                  Bangalore's Premier Table Tennis Academy
                </div>
                <h1 className="text-5xl font-bold tracking-tight sm:text-6xl leading-tight">
                  Train with the Best.
                  <br />
                  <span className="opacity-60">Play at Your Peak.</span>
                </h1>
                <p className="mx-auto lg:mx-0 mt-6 max-w-lg text-lg text-primary-foreground/70">
                  Expert coaches. Structured programs. Real results — for beginners
                  finding their footing and competitors chasing their next trophy.
                </p>
                <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                  <Button asChild size="lg" variant="secondary" className="min-w-[200px]">
                    <Link href="/book">Book a Free Trial</Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    variant="outline"
                    className="min-w-[200px] border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                  >
                    <Link href="#coaches">Meet the Coaches</Link>
                  </Button>
                </div>
              </div>

              {/* Portrait Video */}
              <div className="flex justify-center lg:justify-end order-1 lg:order-2">
              <div className="relative w-[220px] sm:w-[260px] lg:w-[300px]">
                <div className="aspect-[9/16] rounded-3xl overflow-hidden border-4 border-primary-foreground/20 shadow-2xl bg-black">
                  <video
                    src="/images/herovideo.mp4"
                    autoPlay
                    muted // Required for autoplay to work in 99% of browsers
                    loop
                    playsInline // Required for iOS/Safari autoplay
                    controls // This gives you the MP4 UI (play, pause, volume, seek)
                    preload="auto"
                    className="w-full h-full object-cover cursor-pointer"
                  >
                    {/* Fallback for very old browsers */}
                    Your browser does not support the video tag.
                  </video>
                </div>

                {/* Floating Badge */}
                <div className="absolute -bottom-3 -left-4 bg-yellow-400 text-yellow-900 rounded-xl px-4 py-2 shadow-lg text-sm font-bold flex items-center gap-1.5 z-10">
                  <Trophy className="h-4 w-4" /> 15+ Titles Won
                </div>
              </div>
            </div>

            </div>
          </div>
        </section>

        {/* ── Social Proof Ribbon ── */}
        <section className="bg-muted/40 border-b py-5 overflow-hidden">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Tournament Wins &nbsp;·&nbsp; State Champions &nbsp;·&nbsp; Proud Moments
          </p>
          <div className="pause-on-hover overflow-hidden">
            <div
              className="marquee-track flex gap-4"
              style={{ animation: "marquee 28s linear infinite", width: "max-content" }}
            >
              {[...socialProofImages, ...socialProofImages].map((img, i) => (
                <div
                  key={i}
                  className="relative w-60 h-40 flex-shrink-0 rounded-xl overflow-hidden shadow-md group"
                >
                  <Image
                    src={img.src}
                    alt={img.caption}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    sizes="240px"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent flex items-end p-3">
                    <span className="text-white text-sm font-semibold">{img.caption}</span>
                  </div>
                  <div className="absolute top-2 right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                    <Trophy className="h-2.5 w-2.5" /> Win
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Stats Strip ── */}
        <section className="border-b bg-background">
          <div className="container mx-auto px-4 py-10">
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
              {[
                { value: "1000+", label: "Students Trained" },
                { value: "5",    label: "Expert Coaches" },
                { value: "7+",   label: "Years of Excellence" },
                { value: "50+",  label: "Tournaments Entered" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-4xl font-bold">{stat.value}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Testimonials Carousel ── */}
        <section className="py-20 border-t bg-muted/50">
          <div className="container mx-auto px-4 text-center mb-10">
            <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Student Stories
            </div>
            <h2 className="text-4xl font-bold">Real Results. Real Players.</h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              From complete beginners to competitive athletes — see how Sharwin Academy
              has transformed games across the board.
            </p>
          </div>

          <div className="pause-on-hover overflow-hidden">
            <div
              className="marquee-track flex gap-6 px-6"
              style={{ animation: "marquee 55s linear infinite", width: "max-content" }}
            >
              {[...testimonials, ...testimonials].map((t, i) => (
                <Card key={i} className="border-0 shadow-sm w-[340px] flex-shrink-0">
                  <CardContent className="pt-5 pb-5 px-5 flex flex-col h-full">
                    <div className="flex gap-0.5 mb-3">
                      {Array.from({ length: t.rating }).map((_, j) => (
                        <Star key={j} className="h-4 w-4 fill-current text-yellow-500" />
                      ))}
                    </div>
                    <div className="space-y-2 flex-1">
                      <div className="rounded-lg bg-muted/70 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Before</div>
                        <p className="text-sm text-muted-foreground leading-snug">{t.before}</p>
                      </div>
                      <div className="rounded-lg bg-primary/5 border border-primary/10 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1">After</div>
                        <p className="text-sm leading-snug">{t.after}</p>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.duration} · Coach {t.coach}</div>
                      </div>
                      <Quote className="h-5 w-5 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── Why Sharwin ── */}
        <section className="border-t bg-background py-20">
          <div className="container mx-auto px-4">
            <h2 className="mb-3 text-center text-3xl font-bold">Why Sharwin Academy?</h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
              Expert coaching, flexible scheduling, and a supportive community —
              everything you need to grow as a player.
            </p>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: <Users className="h-8 w-8 text-primary" />,
                  title: "Group Classes",
                  desc: "Batch sessions at multiple locations with flexible schedules throughout the week.",
                },
                {
                  icon: <Clock className="h-8 w-8 text-primary" />,
                  title: "Private Sessions",
                  desc: "One-on-one coaching with custom timing that fits your schedule perfectly.",
                },
                {
                  icon: <CalendarDays className="h-8 w-8 text-primary" />,
                  title: "Easy Scheduling",
                  desc: "Manage bookings, reschedule, or mark absence — synced with Google Calendar.",
                },
                {
                  icon: <MapPin className="h-8 w-8 text-primary" />,
                  title: "Multiple Locations",
                  desc: "Choose from various locations across the city for convenient access.",
                },
              ].map((f) => (
                <Card key={f.title} className="border-0 shadow-sm">
                  <CardContent className="pt-6">
                    {f.icon}
                    <h3 className="mt-4 font-semibold text-lg">{f.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── Coaches ── */}
        <section id="coaches" className="py-24 border-t bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Expert Coaching Team
              </div>
              <h2 className="text-4xl font-bold">Meet Your Coaches</h2>
              <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
                Five dedicated professionals, each bringing unique expertise and a genuine
                passion for developing the next generation of players.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {coaches.map((coach) => (
                <Card
                  key={coach.name}
                  className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow"
                >
                  <CardContent className="p-0">
                    <div className="h-44 bg-gradient-to-br from-muted to-muted/40 relative overflow-hidden flex items-center justify-center">
                      {coach.image ? (
                        <Image
                          src={coach.image}
                          alt={coach.name}
                          fill
                          className="object-cover object-top"
                          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        />
                      ) : (
                        <div className="h-20 w-20 rounded-full bg-background border-4 border-background shadow-md flex items-center justify-center">
                          <span className="text-xl font-bold text-primary/50">{coach.initials}</span>
                        </div>
                      )}
                    </div>
                    <div className="p-5">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="text-lg font-bold">{coach.name}</h3>
                        <Award className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                      </div>
                      <div className="text-sm font-medium text-primary mb-3">{coach.specialty}</div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{coach.bio}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}

              <Card className="overflow-hidden border-2 border-dashed flex items-center justify-center min-h-[200px]">
                <CardContent className="text-center p-8">
                  <Trophy className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-semibold text-lg mb-2">Ready to Train?</h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    Book a session with any of our expert coaches and start your journey today.
                  </p>
                  <Button asChild>
                    <Link href="/book">Book Now</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ── Gallery ── */}
        <section className="py-20 border-t overflow-hidden">
          <div className="container mx-auto px-4 text-center mb-10">
            <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Our Community
            </div>
            <h2 className="text-4xl font-bold">Life at Sharwin Academy</h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              Tournament victories, group sessions, and memorable moments from
              our vibrant community of players.
            </p>
          </div>

          {/* Row 1 — left scroll */}
          <div className="pause-on-hover overflow-hidden mb-3">
            <div
              className="marquee-track flex gap-3"
              style={{ animation: "marquee 38s linear infinite", width: "max-content" }}
            >
              {[...socialProofImages, ...socialProofImages].map((img, i) => (
                <div
                  key={i}
                  className="relative w-72 h-48 flex-shrink-0 rounded-xl overflow-hidden group shadow-sm"
                >
                  <Image
                    src={img.src}
                    alt={img.caption}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    sizes="288px"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Row 2 — right scroll */}
          <div className="pause-on-hover overflow-hidden">
            <div
              className="marquee-track flex gap-3"
              style={{ animation: "marquee-reverse 48s linear infinite", width: "max-content" }}
            >
              {[...socialProofImages.slice(3), ...socialProofImages.slice(0, 3), ...socialProofImages.slice(3), ...socialProofImages.slice(0, 3)].map((img, i) => (
                <div
                  key={i}
                  className="relative w-72 h-48 flex-shrink-0 rounded-xl overflow-hidden group shadow-sm"
                >
                  <Image
                    src={img.src}
                    alt={img.caption}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    sizes="288px"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Founder ── */}
        <section className="py-20 border-t bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="grid gap-16 lg:grid-cols-2 items-center">
              <div className="flex justify-center lg:justify-end">
                <div className="relative">
                  <div className="h-72 w-72 rounded-2xl bg-muted overflow-hidden relative">
                    {FOUNDER_IMAGE ? (
                      <Image
                        src={FOUNDER_IMAGE}
                        alt="Stalin Prabu — Founder & Head Coach"
                        fill
                        className="object-cover"
                        sizes="288px"
                      />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
                        <span className="text-8xl font-bold text-primary/20 select-none">SP</span>
                      </div>
                    )}
                  </div>
                  <div className="absolute -bottom-4 -right-4 bg-primary text-primary-foreground rounded-xl px-5 py-3 shadow-lg">
                    <div className="text-sm font-semibold">Founder & Head Coach</div>
                    <div className="text-xs opacity-70 mt-0.5">Sharwin Academy</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  Our Story
                </div>
                <h2 className="text-3xl font-bold mb-6 leading-tight">
                  A Mission to Make Table Tennis Accessible to All
                </h2>
                <div className="space-y-4 text-muted-foreground leading-relaxed">
                  <p>
                    <span className="font-semibold text-foreground">Stalin Prabu</span>,
                    founder of Sharwin Academy, began his journey captivated by the speed,
                    precision, and strategy of table tennis. Noticing that quality coaching
                    was limited and often inaccessible, he set out to change that.
                  </p>
                  <p>
                    Today, Sharwin is home to five dedicated coaches, a thriving community
                    of passionate students, and a philosophy built on discipline, encouragement,
                    and measurable progress. Every session is designed not just to improve
                    your game — but to deepen your love for it.
                  </p>
                </div>
                <div className="mt-8">
                  <Button asChild size="lg">
                    <Link href="/book">
                      Start Your Journey <ChevronRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="bg-primary text-primary-foreground py-24">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold mb-4">Your First Rally Starts Here.</h2>
            <p className="text-primary-foreground/70 max-w-lg mx-auto mb-10 text-lg">
              Whether you're picking up a paddle for the first time or returning to sharpen
              your competitive edge — Sharwin Academy has a program for you.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" variant="secondary" className="min-w-[220px]">
                <Link href="/book">Book a Class</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="min-w-[220px] border-primary-foreground/30 text-secondary-foreground hover:bg-primary-foreground/10"
              >
                <Link href="/login">Sign In to Your Account</Link>
              </Button>
            </div>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}
