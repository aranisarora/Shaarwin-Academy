import Link from "next/link";
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

const coaches = [
  {
    name: "Augustine",
    initials: "AU",
    specialty: "Footwork & Movement",
    bio: "A seasoned coach with over 7 years of professional experience, Augustine specialises in footwork mechanics and court positioning. His methodical approach to movement training has helped players at every level dramatically improve their agility and table coverage. Holding a national-level coaching certification, Augustine has trained over 150 students — many of whom have gone on to represent their districts and states in competitive tournaments.",
  },
  {
    name: "Jerald",
    initials: "JE",
    specialty: "Offensive Techniques",
    bio: "With 7 years of professional coaching experience, Jerald is celebrated for his deep expertise in attacking strokes and power play. A former state-level competitor himself, he brings authentic tournament experience to every training session. Jerald has a rare ability to identify each player's natural strengths and amplify them strategically, making him especially effective for intermediate and advanced players aiming to elevate their attacking game.",
  },
  {
    name: "Mahaveer",
    initials: "MA",
    specialty: "Defensive Play & Fundamentals",
    bio: "Mahaveer brings 7 years of dedicated coaching experience with a strong focus on defensive consistency and technical fundamentals. Renowned for his patient, detail-oriented teaching style, he excels at building solid foundational habits in beginners that serve them throughout their careers. His structured programs blend technical drills with match simulations, ensuring students develop both skill and match-ready confidence from day one.",
  },
  {
    name: "Purnendu",
    initials: "PU",
    specialty: "Serve, Return & Spin Mechanics",
    bio: "A specialist in serve-and-return strategy, Purnendu has 7+ years of coaching experience spanning recreational players to competitive athletes. He is particularly celebrated for his deep knowledge of spin mechanics, placement precision, and reading the opponent's game. Purnendu's coaching philosophy centres on outsmarting opponents rather than outpowering them — making his sessions invaluable for players who want to develop a complete, nuanced style.",
  },
  {
    name: "Sambath",
    initials: "SA",
    specialty: "Mental Performance & Match Strategy",
    bio: "Sambath is the academy's mental performance and match strategy specialist, with 7 years of experience integrating sports psychology principles into table tennis coaching. He understands that top-level play is as much mental as it is physical. His sessions incorporate concentration drills, pressure simulation, and strategic game planning — helping countless students break through performance plateaus and compete with calm, consistent confidence.",
  },
];

const testimonials = [
  {
    name: "Rajan K.",
    duration: "3 months",
    coach: "Augustine",
    before:
      "Couldn't sustain a 10-shot rally. Struggled with basic footwork and felt completely lost on the table.",
    after:
      "Won my first club-level tournament. My footwork is unrecognisable — I'm confident chasing wide balls I used to miss entirely.",
    rating: 5,
  },
  {
    name: "Priya S.",
    duration: "4 months",
    coach: "Jerald",
    before:
      "Played purely defensively out of fear. Fast topspin balls terrified me and I had no attacking game to speak of.",
    after:
      "I've built a confident, aggressive playstyle. Won two local matches last month and I'm no longer afraid of fast, heavy play.",
    rating: 5,
  },
  {
    name: "Arjun M.",
    duration: "6 months",
    coach: "Mahaveer",
    before:
      "A complete beginner who had never held a paddle properly. Absolutely zero match experience.",
    after:
      "Competed in my first intra-club tournament and placed in the top half. The structured, patient coaching made all the difference.",
    rating: 5,
  },
  {
    name: "Divya R.",
    duration: "2 months",
    coach: "Purnendu",
    before:
      "Predictable serves and weak returns. Opponents easily read my game and exploited it every time.",
    after:
      "My win rate jumped from 20% to over 60%. Opponents now struggle to anticipate my serves — it has completely changed my game.",
    rating: 5,
  },
  {
    name: "Karthik V.",
    duration: "5 months",
    coach: "Sambath",
    before:
      "I crumbled under match pressure even when technically superior to my opponents. Lost close games repeatedly.",
    after:
      "I'm calmer, sharper, and far more consistent in matches. The mental training rewired how I approach competition entirely.",
    rating: 5,
  },
  {
    name: "Sneha L.",
    duration: "8 months",
    coach: "Multiple Coaches",
    before:
      "Joined purely to stay active. No real ambition to compete — just wanted some exercise.",
    after:
      "Now a passionate competitive player representing my office team in inter-corporate tournaments. Shaarwin Academy changed everything.",
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
          <div className="container mx-auto px-4 py-28 text-center relative z-10">
            <div className="inline-block rounded-full border border-primary-foreground/20 px-4 py-1.5 text-sm font-medium mb-6 text-primary-foreground/80">
              Bangalore's Premier Table Tennis Academy
            </div>
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl leading-tight">
              Train with the Best.
              <br />
              <span className="opacity-60">Play at Your Peak.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-primary-foreground/70">
              Join Shaarwin Academy — where passionate coaches and structured
              programs transform beginners into competitors and competitors into
              champions.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="min-w-[200px]"
              >
                <Link href="/book">Book a Free Trial</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="min-w-[200px] border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
              >
                <Link href="#coaches">Meet the Coaches</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* ── Stats Strip ── */}
        <section className="border-b bg-muted/30">
          <div className="container mx-auto px-4 py-10">
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
              {[
                { value: "200+", label: "Students Trained" },
                { value: "5", label: "Expert Coaches" },
                { value: "7+", label: "Years of Excellence" },
                { value: "50+", label: "Tournaments Entered" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-4xl font-bold">{stat.value}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Founder ── */}
        <section className="py-24">
          <div className="container mx-auto px-4">
            <div className="grid gap-16 lg:grid-cols-2 items-center">
              {/* Avatar */}
              <div className="flex justify-center lg:justify-end">
                <div className="relative">
                  <div className="h-80 w-80 rounded-2xl bg-muted overflow-hidden flex items-center justify-center">
                    <div className="h-full w-full bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
                      <span className="text-8xl font-bold text-primary/20 select-none">
                        SP
                      </span>
                    </div>
                  </div>
                  <div className="absolute -bottom-4 -right-4 bg-primary text-primary-foreground rounded-xl px-5 py-3 shadow-lg">
                    <div className="text-sm font-semibold">
                      Founder & Head Coach
                    </div>
                    <div className="text-xs opacity-70 mt-0.5">
                      Shaarwin Academy
                    </div>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div>
                <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  Our Story
                </div>
                <h2 className="text-4xl font-bold mb-6 leading-tight">
                  A Mission to Make Table Tennis Accessible to All
                </h2>
                <div className="space-y-4 text-muted-foreground leading-relaxed">
                  <p>
                    <span className="font-semibold text-foreground">
                      Stalin Prabu
                    </span>
                    , founder of Shaarwin Academy, began his table tennis
                    journey as a young player captivated by the speed,
                    precision, and strategy of the sport. Over the years, he
                    noticed a gap — quality coaching was limited, often
                    inaccessible to those who didn't already know where to look.
                  </p>
                  <p>
                    That realisation became a mission. Stalin founded Shaarwin
                    Academy with a single goal: to bring structured,
                    world-class table tennis coaching to players of all ages and
                    backgrounds — whether they're beginners finding their
                    footing or competitive players chasing their next trophy.
                  </p>
                  <p>
                    Today, Shaarwin Academy is home to a team of five dedicated
                    coaches, a thriving community of passionate students, and a
                    coaching philosophy built on discipline, encouragement, and
                    measurable progress. Every session is designed not just to
                    improve your game — but to deepen your love for it.
                  </p>
                </div>
                <div className="mt-8">
                  <Button asChild size="lg">
                    <Link href="/book">
                      Start Your Journey{" "}
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Why Shaarwin ── */}
        <section className="border-t bg-muted/50 py-20">
          <div className="container mx-auto px-4">
            <h2 className="mb-3 text-center text-3xl font-bold">
              Why Shaarwin Academy?
            </h2>
            <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
              Expert coaching, flexible scheduling, and a supportive community
              — everything you need to grow as a player.
            </p>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: <Users className="h-8 w-8 text-primary" />,
                  title: "Group Classes",
                  desc: "Join batch sessions at multiple locations with flexible schedules throughout the week.",
                },
                {
                  icon: <Clock className="h-8 w-8 text-primary" />,
                  title: "Private Sessions",
                  desc: "Book one-on-one sessions with custom timing that fits your schedule perfectly.",
                },
                {
                  icon: <CalendarDays className="h-8 w-8 text-primary" />,
                  title: "Easy Scheduling",
                  desc: "Manage bookings, reschedule, or mark absence — all synced with Google Calendar.",
                },
                {
                  icon: <MapPin className="h-8 w-8 text-primary" />,
                  title: "Multiple Locations",
                  desc: "Choose from various locations across the city for convenient access to coaching.",
                },
              ].map((feature) => (
                <Card key={feature.title} className="border-0 shadow-sm">
                  <CardContent className="pt-6">
                    {feature.icon}
                    <h3 className="mt-4 font-semibold text-lg">
                      {feature.title}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {feature.desc}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── Coaches ── */}
        <section id="coaches" className="py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Expert Coaching Team
              </div>
              <h2 className="text-4xl font-bold">Meet Your Coaches</h2>
              <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
                Five dedicated professionals, each bringing unique expertise and
                a genuine passion for developing the next generation of table
                tennis players.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {coaches.map((coach) => (
                <Card
                  key={coach.name}
                  className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow"
                >
                  <CardContent className="p-0">
                    {/* Photo placeholder */}
                    <div className="h-48 bg-gradient-to-br from-muted to-muted/40 flex items-center justify-center">
                      <div className="h-24 w-24 rounded-full bg-background border-4 border-background shadow-md flex items-center justify-center">
                        <span className="text-2xl font-bold text-primary/50">
                          {coach.initials}
                        </span>
                      </div>
                    </div>
                    {/* Info */}
                    <div className="p-6">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="text-xl font-bold">{coach.name}</h3>
                        <Award className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                      </div>
                      <div className="text-sm font-medium text-primary mb-3">
                        {coach.specialty}
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {coach.bio}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* CTA card */}
              <Card className="overflow-hidden border-2 border-dashed flex items-center justify-center min-h-[200px]">
                <CardContent className="text-center p-8">
                  <Trophy className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-semibold text-lg mb-2">
                    Ready to Train?
                  </h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    Book a session with any of our expert coaches and start your
                    journey today.
                  </p>
                  <Button asChild>
                    <Link href="/book">Book Now</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* ── Testimonials ── */}
        <section className="bg-muted/50 border-t py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Student Stories
              </div>
              <h2 className="text-4xl font-bold">Real Results. Real Players.</h2>
              <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
                From complete beginners to competitive athletes — see how
                Shaarwin Academy has transformed the game for students across
                the board.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {testimonials.map((t) => (
                <Card key={t.name} className="border-0 shadow-sm">
                  <CardContent className="pt-6 pb-6 px-6 flex flex-col h-full">
                    {/* Stars */}
                    <div className="flex gap-0.5 mb-4">
                      {Array.from({ length: t.rating }).map((_, i) => (
                        <Star
                          key={i}
                          className="h-4 w-4 fill-current text-yellow-500"
                        />
                      ))}
                    </div>

                    {/* Before / After */}
                    <div className="space-y-3 flex-1">
                      <div className="rounded-lg bg-muted/70 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                          Before
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {t.before}
                        </p>
                      </div>
                      <div className="rounded-lg bg-primary/5 border border-primary/10 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">
                          After
                        </div>
                        <p className="text-sm">{t.after}</p>
                      </div>
                    </div>

                    {/* Attribution */}
                    <div className="mt-5 pt-4 border-t flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm">{t.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.duration} · Coach {t.coach}
                        </div>
                      </div>
                      <Quote className="h-6 w-6 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="bg-primary text-primary-foreground py-24">
          <div className="container mx-auto px-4 text-center">
            <h2 className="text-4xl font-bold mb-4">
              Your First Rally Starts Here.
            </h2>
            <p className="text-primary-foreground/70 max-w-lg mx-auto mb-10 text-lg">
              Whether you're picking up a paddle for the very first time or
              returning to sharpen your competitive edge — Shaarwin Academy has
              a program for you.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="min-w-[220px]"
              >
                <Link href="/book">Book a Free Trial Class</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="min-w-[220px] border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
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
