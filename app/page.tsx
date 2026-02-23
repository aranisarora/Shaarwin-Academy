import Link from "next/link";
import Image from "next/image";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AnimateOnScroll } from "@/components/ui/animate-on-scroll";
import {
  CalendarDays,
  Users,
  Clock,
  Star,
  Quote,
  Trophy,
  ChevronRight,
  Award,
  Mail,
  MapPin,
  CheckCircle2,
  Link2,
  Home,
  MessageCircle,
} from "lucide-react";

const FOUNDER_IMAGE = "/images/stalin.jpeg";
const LOGO_IMAGE = "/images/Logo.jpeg";

const socialProofImages: Array<{ src: string; caption: string }> = [
<<<<<<< HEAD
  { src: "/images/Group1.jpeg", caption: "National Champions 2025" },
  { src: "/images/Group2.jpeg", caption: "State Level Winners" },
  { src: "/images/Group3.jpeg", caption: "District Tournament 2024" },
  { src: "/images/Group4.jpeg", caption: "15+ Tournament Titles" },
  { src: "/images/Group5.jpeg", caption: "Inter-Club Champions" },
  { src: "/images/Group6.jpeg", caption: "1000+ Students Trained" },
  { src: "/images/Group7.jpeg", caption: "Elite Squad Training" },
=======
  { src: "/images/Group1.jpeg", caption: "ISF U18 Gymnasiade – Bahrain, 2024" },
  { src: "/images/Group2.jpeg", caption: "ISF U18 Gymnasiade – Bahrain, 2024" },
  { src: "/images/Group3.jpeg", caption: "ISF U18 Gymnasiade – Bahrain, 2024" },
  { src: "/images/Group4.jpeg", caption: "ISF U18 Gymnasiade – Bahrain, 2024" },
  { src: "/images/Group5.jpeg", caption: "CISE Sports and games National Table Tennis 2022" },
  { src: "/images/Group6.jpeg", caption: "CISE Sports and games National Table Tennis 2022" },
  { src: "/images/Group7.jpeg", caption: "66th National school games competition" },
>>>>>>> 9e5f20040fea26f783859ddc40a4a817515ed4e5
];

const coaches = [
  {
    name: "Augustine",
    initials: "AU",
    image: "",
    qualifications: [
      "7+ years of coaching experience",
      "ITTF certified coach",
      "150+ students trained",
    ],
  },
  {
    name: "Jerald",
    initials: "JE",
    image: "",
    qualifications: [
      "7+ years of coaching experience",
      "ITTF certified coach",
      "NIS certified coach",
    ],
  },
  {
    name: "Mahaveer",
    initials: "MA",
    image: "",
    qualifications: [
      "7+ years of coaching experience",
      "ITTF certified coach",
      "150+ students trained",
    ],
  },
  {
    name: "Purnendu",
    initials: "PU",
    image: "",
    qualifications: [
      "7+ years of coaching experience",
      "ITTF certified coach",
      "150+ students trained",
    ],
  },
  {
    name: "Sambath",
    initials: "SA",
    image: "",
<<<<<<< HEAD
    qualifications: [
      "7+ years of coaching experience",
      "ITTF certified coach",
      "150+ students trained",
    ],
  },
  {
    name: "Sunil",
    initials: "SU",
    image: "",
    qualifications: [
      "7+ years of coaching experience",
      "ITTF certified coach",
      "150+ students trained",
    ],
=======
    specialty: "Mental Performance & Match Strategy",
    bio: "Sharwin's mental performance specialist integrates sports psychology principles into every session. Concentration drills, pressure simulation, and strategic game planning have helped countless students break through plateaus and compete with calm consistency.",
>>>>>>> 9e5f20040fea26f783859ddc40a4a817515ed4e5
  },
];

const testimonials = [
  {
    name: "Rajan K.",
    duration: "3 months",
    before:
      "Couldn't sustain a 10-shot rally. Struggled with basic footwork and felt completely lost on the table.",
    after:
      "Won my first club-level tournament. My footwork is unrecognisable — I'm confident chasing wide balls I used to miss entirely.",
    rating: 5,
  },
  {
    name: "Priya S.",
    duration: "4 months",
    before:
      "Played purely defensively out of fear. Fast topspin balls terrified me and I had no attacking game.",
    after:
      "I've built a confident, aggressive playstyle. Won two local matches last month and I'm no longer afraid of fast, heavy play.",
    rating: 5,
  },
  {
    name: "Arjun M.",
    duration: "6 months",
    before:
      "A complete beginner who had never held a paddle properly. Absolutely zero match experience.",
    after:
      "Competed in my first intra-club tournament and placed in the top half. The structured, patient coaching made all the difference.",
    rating: 5,
  },
  {
    name: "Divya R.",
    duration: "2 months",
    before:
      "Predictable serves and weak returns. Opponents easily read my game and exploited it every time.",
    after:
      "My win rate jumped from 20% to over 60%. Opponents now struggle to anticipate my serves — it has completely changed my game.",
    rating: 5,
  },
  {
    name: "Karthik V.",
    duration: "5 months",
    before:
      "I crumbled under match pressure even when technically superior to my opponents. Lost close games repeatedly.",
    after:
      "I'm calmer, sharper, and far more consistent in matches. The mental training rewired how I approach competition entirely.",
    rating: 5,
  },
  {
    name: "Sneha L.",
    duration: "8 months",
<<<<<<< HEAD
    before:
      "Joined purely to stay active. No real ambition to compete — just wanted some exercise.",
    after:
      "Now a passionate competitive player representing my office team in inter-corporate tournaments. Sharwin Table Tennis Academy changed everything.",
=======
    coach: "Multiple Coaches",
    before: "Joined purely to stay active. No real ambition to compete — just wanted some exercise.",
    after: "Now a passionate competitive player representing my office team in inter-corporate tournaments. Sharwin changed everything.",
>>>>>>> 9e5f20040fea26f783859ddc40a4a817515ed4e5
    rating: 5,
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">

        {/* ═══════════════════════════════════════════════
            HERO / COVER
        ═══════════════════════════════════════════════ */}
        <section
          id="home"
          className="relative overflow-hidden bg-gradient-to-br from-red-800 via-red-700 to-blue-950 text-white min-h-[92vh] flex items-center"
        >
          {/* Background video texture */}
          <video
            className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-luminosity pointer-events-none"
            src="/images/herovideo2.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="none"
          />
          {/* Decorative TT image far right */}
          <div className="absolute right-0 top-0 bottom-0 w-1/4 opacity-[0.06] hidden xl:block pointer-events-none">
            <Image src="/images/Group1.jpeg" alt="" fill className="object-cover" sizes="25vw" />
          </div>

          <div className="relative container mx-auto px-4 py-16 lg:py-20">
            <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">

              {/* ── Left: Write-up ── */}
              <div className="text-center lg:text-left order-2 lg:order-1 space-y-5">
                <div className="hero-anim-1 inline-flex items-center gap-2 rounded-full border border-white/25 px-4 py-1.5 text-sm font-medium text-white/80">
                  <Trophy className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                  Bangalore&apos;s Premier Table Tennis Academy
                </div>

                <h1 className="hero-anim-2 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl leading-[1.1]">
                  Train with the Best.
                  <br />
                  <span className="text-yellow-400">Play at Your Peak.</span>
                </h1>

                <p className="hero-anim-3 mx-auto lg:mx-0 max-w-lg text-lg text-white/80 leading-relaxed">
                  Sharwin Table Tennis Academy brings ITTF-certified coaching directly to you — at your
                  home, society, or community hall. Expert coaches, structured programs, and real
                  results for every skill level.
                </p>

                {/* Key benefits bullets */}
                <ul className="hero-anim-3 mx-auto lg:mx-0 max-w-sm space-y-2 text-sm text-white/75 text-left">
                  {[
                    "Expert ITTF & PTT certified coaches",
                    "Group classes & private 1-on-1 sessions",
                    "We come to your location — no travel needed",
                    "Beginners, competitive players & everyone in between",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>

                {/* Stats */}
                <div className="hero-anim-4 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg mx-auto lg:mx-0 pt-1">
                  {[
                    { value: "1000+", label: "Students" },
                    { value: "6",     label: "Coaches" },
                    { value: "15+",   label: "Years" },
                    { value: "350+",  label: "Tournaments" },
                  ].map((s) => (
                    <div key={s.label} className="bg-white/10 rounded-xl px-3 py-3 text-center">
                      <div className="text-2xl font-bold text-yellow-400">{s.value}</div>
                      <div className="text-[11px] text-white/65 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* CTAs */}
                <div className="hero-anim-5 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start pt-1">
                  <Button
                    asChild
                    size="lg"
                    className="bg-yellow-400 text-yellow-950 hover:bg-yellow-300 font-bold min-w-[180px]"
                  >
                    <Link href="/book">Book a Class</Link>
                  </Button>
                  <Button
                    asChild
                    size="lg"
                    className="border border-white/40 bg-transparent text-white hover:bg-white/10 min-w-[180px]"
                  >
                    <Link href="#coaches">Meet the Coaches</Link>
                  </Button>
                </div>
              </div>

<<<<<<< HEAD
              {/* ── Right: Logo ── */}
              <div className="hero-anim-logo flex justify-center lg:justify-end order-1 lg:order-2">
                <div className="relative">
                  <div className="w-56 h-56 sm:w-64 sm:h-64 lg:w-80 lg:h-80 rounded-full overflow-hidden border-4 border-white/20 shadow-2xl">
                    <Image
                      src={LOGO_IMAGE}
                      alt="Sharwin Table Tennis Academy"
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 224px, (max-width: 1024px) 256px, 320px"
                      priority
                    />
                  </div>
                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-yellow-950 rounded-xl px-4 py-2 shadow-lg text-sm font-bold flex items-center gap-1.5 whitespace-nowrap">
                    <Trophy className="h-4 w-4 shrink-0" /> 15+ Titles Won
                  </div>
=======
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
>>>>>>> 9e5f20040fea26f783859ddc40a4a817515ed4e5
                </div>
              </div>
            </div>

            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            GALLERY CAROUSEL
        ═══════════════════════════════════════════════ */}
        <section id="gallery" className="py-14 bg-slate-50 border-t-4 border-primary overflow-hidden">
          <AnimateOnScroll className="container mx-auto px-4 text-center mb-8">
            <div className="text-sm font-semibold uppercase tracking-widest text-primary mb-2">
              Our Community
            </div>
            <h2 className="text-3xl font-bold">
              <a
                href="#gallery"
                className="group/h inline-flex items-center justify-center gap-2 hover:text-primary transition-colors"
              >
                Life at Sharwin Table Tennis Academy
                <Link2 className="h-5 w-5 opacity-0 group-hover/h:opacity-40 transition-opacity shrink-0" />
              </a>
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto text-sm">
              Tournament victories, group training, and proud moments from our community.{" "}
              <span className="text-muted-foreground/60">Hover to pause.</span>
            </p>
          </AnimateOnScroll>

          {/* Row 1 — scrolls left */}
          <div className="pause-on-hover overflow-hidden mb-3">
            <div
              className="marquee-left flex gap-3"
              style={{ "--marquee-dur": "36s" } as React.CSSProperties}
            >
              {[...socialProofImages, ...socialProofImages].map((img, i) => (
                <div
                  key={i}
                  className="relative w-72 h-48 flex-shrink-0 rounded-xl overflow-hidden group shadow-md"
                >
                  <Image
                    src={img.src}
                    alt={img.caption}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    sizes="288px"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent flex items-end p-3">
                    <span className="text-white text-sm font-semibold drop-shadow">{img.caption}</span>
                  </div>
                  <div className="absolute top-2 right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                    <Trophy className="h-2.5 w-2.5" /> Win
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Row 2 — scrolls right */}
          <div className="pause-on-hover overflow-hidden">
            <div
              className="marquee-right flex gap-3"
              style={{ "--marquee-dur": "48s" } as React.CSSProperties}
            >
              {[
<<<<<<< HEAD
                ...socialProofImages.slice(3),
                ...socialProofImages.slice(0, 3),
                ...socialProofImages.slice(3),
                ...socialProofImages.slice(0, 3),
              ].map((img, i) => (
                <div
                  key={i}
                  className="relative w-72 h-48 flex-shrink-0 rounded-xl overflow-hidden group shadow-md"
                >
                  <Image
                    src={img.src}
                    alt={img.caption}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    sizes="288px"
                  />
=======
                { value: "1000+", label: "Students Trained" },
                { value: "5",    label: "Expert Coaches" },
                { value: "7+",   label: "Years of Excellence" },
                { value: "50+",  label: "Tournaments Entered" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-4xl font-bold">{stat.value}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
>>>>>>> 9e5f20040fea26f783859ddc40a4a817515ed4e5
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            FOUNDER
        ═══════════════════════════════════════════════ */}
        <section id="founder" className="relative py-24 md:py-32 bg-blue-950 text-white border-t-4 border-blue-700 overflow-hidden">

          {/* ── Layered faded background images of Stalin ── */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute -top-20 -left-12 w-[480px] h-[680px] opacity-[0.07] rotate-[-6deg] blur-[1px] hidden md:block">
              <Image src={FOUNDER_IMAGE} alt="" fill className="object-cover object-top" sizes="480px" />
            </div>
            <div className="absolute top-0 right-0 w-[340px] h-full opacity-[0.05] hidden lg:block">
              <Image src={FOUNDER_IMAGE} alt="" fill className="object-cover object-center" sizes="340px" />
            </div>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[280px] h-[380px] opacity-[0.04] blur-[3px] hidden sm:block">
              <Image src={FOUNDER_IMAGE} alt="" fill className="object-cover object-bottom" sizes="280px" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-blue-950/96 via-blue-950/85 to-blue-950/92" />
          </div>

          <div className="relative container mx-auto px-4 md:px-8">

            {/* ── Section header ── */}
            <AnimateOnScroll className="text-center mb-16 md:mb-20 max-w-2xl mx-auto">
              <div className="text-sm font-semibold uppercase tracking-widest text-blue-300 mb-3">
                Our Story
              </div>
              <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-5">
                <a
                  href="#founder"
                  className="group/h inline-flex items-center justify-center gap-2 hover:text-blue-200 transition-colors"
                >
                  The Man Behind the Mission
                  <Link2 className="h-5 w-5 opacity-0 group-hover/h:opacity-40 transition-opacity shrink-0" />
                </a>
              </h2>
              <p className="text-blue-200/65 text-base md:text-lg leading-relaxed">
                Over 15 years of unwavering commitment to a single belief — that world-class
                table tennis coaching should be within reach of every player, at every level,
                wherever they are.
              </p>
            </AnimateOnScroll>

            {/* ── Photo + write-up grid ── */}
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-12 lg:gap-16 xl:gap-20 items-start max-w-5xl mx-auto">

              {/* Left — Portrait photo + certifications */}
              <AnimateOnScroll variant="fade" className="flex flex-col items-center lg:items-start gap-6">
                <div
                  className="relative w-full max-w-[300px] md:max-w-[340px] mx-auto lg:mx-0 rounded-3xl overflow-hidden border-4 border-blue-600/50 shadow-2xl"
                  style={{ aspectRatio: "3/4" }}
                >
                  <Image
                    src={FOUNDER_IMAGE}
                    alt="Stalin — Founder & Head Coach"
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 300px, 360px"
                  />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent px-5 py-5">
                    <div className="font-bold text-white text-xl leading-tight">Stalin</div>
                    <div className="text-blue-200 text-sm mt-0.5">Founder &amp; Head Coach</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 justify-center lg:justify-start max-w-[340px]">
                  {[
                    "ITTF Certified",
                    "PTT Certified",
                    "15+ Years Experience",
                    "National Level Coach",
                    "International Tournaments",
                  ].map((cert) => (
                    <span
                      key={cert}
                      className="inline-flex items-center gap-1.5 bg-blue-800/60 border border-blue-600/40 rounded-full px-3 py-1.5 text-xs font-medium text-blue-200"
                    >
                      <Award className="h-3 w-3 shrink-0" /> {cert}
                    </span>
                  ))}
                </div>
              </AnimateOnScroll>

              {/* Right — Write-up */}
              <AnimateOnScroll delay={150} className="space-y-6">
                <div>
                  <div className="text-sm font-semibold uppercase tracking-widest text-blue-300 mb-2">
                    15+ Years of Excellence
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold leading-tight">
                    A Mission to Make Table Tennis Accessible to All
                  </h3>
                </div>

                <div className="space-y-4 text-blue-100/80 leading-relaxed text-sm sm:text-base">
                  <p>
                    <span className="font-semibold text-white">Stalin</span>, founder of Sharwin Table
                    Tennis Academy, is an ITTF and PTT (Paralympic Table Tennis) certified coach with
                    over 15 years of dedicated coaching and team management experience.
                  </p>
                  <p>
                    He has led teams at national and international levels — including India&apos;s U19
                    ISSO team at an international tournament in Bahrain, and Karnataka&apos;s CISCE U14,
                    U17, and U19 teams at the National Table Tennis Tournament.
                  </p>
                  <p>
                    His coaching philosophy is rooted in patience, precision, and an unshakeable belief
                    in every player&apos;s potential. He doesn&apos;t coach for trophies — he coaches to
                    build character, discipline, and a lifelong love for the sport. Every drill,
                    every session, every push is intentional.
                  </p>
                  <p>
                    Frustrated by the gap between elite coaching and everyday access, Stalin founded
                    Sharwin Table Tennis Academy with a bold idea: bring the coach to you. No expensive
                    clubs, no long commutes, no barriers — just world-class training at your doorstep,
                    on your schedule.
                  </p>
                  <p>
                    Today, with over 1,000 students trained and a team of 6 certified coaches, Sharwin
                    Table Tennis Academy stands as Bangalore&apos;s most trusted and accessible table
                    tennis institution — and the mission is far from over.
                  </p>
                </div>

                <blockquote className="border-l-4 border-yellow-400 pl-5 py-1">
                  <p className="text-white/90 italic text-sm sm:text-base leading-relaxed">
                    &ldquo;Every player deserves a coach who believes in them — not just at the table,
                    but in life. That&rsquo;s what Sharwin stands for.&rdquo;
                  </p>
                  <cite className="text-blue-300 text-xs mt-2 block not-italic">
                    — Stalin, Founder &amp; Head Coach
                  </cite>
                </blockquote>

                <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-white">
                  <Link href="/book">
                    Start Your Journey <ChevronRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </AnimateOnScroll>

            </div>

            {/* ── Stats bar ── */}
            <AnimateOnScroll delay={150} className="mt-20 md:mt-24">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
                {[
                  { value: "15+",    label: "Years of Coaching" },
                  { value: "1,000+", label: "Students Trained" },
                  { value: "350+",   label: "Tournaments Mentored" },
                  { value: "2",      label: "International Deployments" },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="text-center bg-blue-900/50 border border-blue-700/40 rounded-2xl px-4 py-6 md:py-8"
                  >
                    <div className="text-3xl md:text-4xl font-bold text-yellow-400">{stat.value}</div>
                    <div className="text-blue-300/75 text-xs mt-1.5 leading-snug">{stat.label}</div>
                  </div>
                ))}
              </div>
            </AnimateOnScroll>

          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            MISSION VIDEO
        ═══════════════════════════════════════════════ */}
        <section id="mission-video" className="relative py-24 md:py-28 bg-slate-900 text-white border-t-4 border-slate-700 overflow-hidden">
          {/* Subtle bg texture */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.04]">
            <Image src="/images/Group1.jpeg" alt="" fill className="object-cover" sizes="100vw" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/90 via-slate-900/80 to-slate-900/90 pointer-events-none" />

          <div className="relative container mx-auto px-4 md:px-8">
            <AnimateOnScroll className="text-center mb-12 md:mb-14 max-w-xl mx-auto">
              <div className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-3">
                Straight From the Source
              </div>
              <h2 className="text-3xl md:text-4xl font-bold leading-tight mb-4">
                Hear It From the Coach
              </h2>
              <p className="text-slate-400 text-sm md:text-base leading-relaxed">
                Stalin explains the philosophy, the vision, and why he built Sharwin Table Tennis
                Academy the way he did — in his own words.
              </p>
            </AnimateOnScroll>

            <AnimateOnScroll delay={100} className="flex justify-center">
              <div
                className="relative rounded-2xl overflow-hidden border-2 border-slate-600/60 shadow-[0_0_80px_rgba(0,0,0,0.6)] bg-black w-full max-w-[280px] sm:max-w-[320px]"
                style={{ aspectRatio: "9/16" }}
              >
                <video
                  src="/images/HeroVideo.mp4"
                  className="absolute inset-0 w-full h-full object-cover"
                  controls
                  playsInline
                  preload="metadata"
                  poster={FOUNDER_IMAGE}
                />
              </div>
            </AnimateOnScroll>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            TESTIMONIALS
        ═══════════════════════════════════════════════ */}
        <section id="testimonials" className="py-14 border-t-4 border-red-200 bg-red-50 overflow-hidden">
          <AnimateOnScroll className="container mx-auto px-4 text-center mb-8">
            <div className="text-sm font-semibold uppercase tracking-widest text-primary mb-2">
              Student Stories
            </div>
<<<<<<< HEAD
            <h2 className="text-3xl font-bold">
              <a
                href="#testimonials"
                className="group/h inline-flex items-center justify-center gap-2 hover:text-primary transition-colors"
              >
                Real Results. Real Players.
                <Link2 className="h-5 w-5 opacity-0 group-hover/h:opacity-30 transition-opacity shrink-0" />
              </a>
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto text-sm">
              From complete beginners to competitive athletes — see how Sharwin Table Tennis Academy
              has transformed games across the board.{" "}
              <span className="text-muted-foreground/60">Hover to pause.</span>
=======
            <h2 className="text-4xl font-bold">Real Results. Real Players.</h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              From complete beginners to competitive athletes — see how Sharwin Academy
              has transformed games across the board.
>>>>>>> 9e5f20040fea26f783859ddc40a4a817515ed4e5
            </p>
          </AnimateOnScroll>

          <div className="pause-on-hover overflow-hidden">
            <div
              className="marquee-left flex gap-5 px-4"
              style={{ "--marquee-dur": "55s" } as React.CSSProperties}
            >
              {[...testimonials, ...testimonials].map((t, i) => (
                <Card
                  key={i}
                  className="border border-red-100 shadow-sm w-[320px] flex-shrink-0 bg-white"
                >
                  <CardContent className="pt-5 pb-5 px-5 flex flex-col h-full">
                    <div className="flex gap-0.5 mb-3">
                      {Array.from({ length: t.rating }).map((_, j) => (
                        <Star key={j} className="h-3.5 w-3.5 fill-current text-yellow-500" />
                      ))}
                    </div>
                    <div className="space-y-2 flex-1">
                      <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                          Before
                        </div>
                        <p className="text-xs text-muted-foreground leading-snug">{t.before}</p>
                      </div>
                      <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1">
                          After
                        </div>
                        <p className="text-xs leading-snug">{t.after}</p>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm">{t.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {t.duration} · Sharwin Table Tennis Academy
                        </div>
                      </div>
                      <Quote className="h-4 w-4 text-muted-foreground/25 shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

<<<<<<< HEAD
        {/* ═══════════════════════════════════════════════
            COACHES
        ═══════════════════════════════════════════════ */}
        <section id="coaches" className="py-14 border-t-4 border-primary bg-white">
          <div className="container mx-auto px-4">
            <AnimateOnScroll className="text-center mb-10">
              <div className="text-sm font-semibold uppercase tracking-widest text-primary mb-2">
=======
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
>>>>>>> 9e5f20040fea26f783859ddc40a4a817515ed4e5
                Expert Coaching Team
              </div>
              <h2 className="text-3xl font-bold">
                <a
                  href="#coaches"
                  className="group/h inline-flex items-center justify-center gap-2 hover:text-primary transition-colors"
                >
                  Meet Your Coaches
                  <Link2 className="h-5 w-5 opacity-0 group-hover/h:opacity-30 transition-opacity shrink-0" />
                </a>
              </h2>
              <p className="mt-3 text-muted-foreground max-w-xl mx-auto text-sm">
                Six dedicated professionals with a genuine passion for developing the next generation
                of table tennis players.
              </p>
            </AnimateOnScroll>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {coaches.map((coach, idx) => (
                <AnimateOnScroll key={coach.name} delay={idx * 80}>
                  <Card className="overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 h-full">
                    <CardContent className="p-0">
                      <div className="h-32 bg-gradient-to-br from-red-700 to-blue-900 relative overflow-hidden flex items-center justify-center">
                        {coach.image ? (
                          <Image
                            src={coach.image}
                            alt={`Coach ${coach.name}`}
                            fill
                            className="object-cover object-top"
                            sizes="(max-width: 768px) 100vw, 33vw"
                          />
                        ) : (
                          <div className="h-16 w-16 rounded-full bg-white/15 border-4 border-white/25 flex items-center justify-center shadow-lg">
                            <span className="text-xl font-bold text-white">{coach.initials}</span>
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="text-base font-bold">Coach: {coach.name}</h3>
                          <Award className="h-4 w-4 text-primary/40 shrink-0 mt-0.5" />
                        </div>
                        <ul className="space-y-1.5">
                          {coach.qualifications.map((q) => (
                            <li key={q} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                              {q}
                            </li>
                          ))}
                        </ul>
                      </div>
<<<<<<< HEAD
                    </CardContent>
                  </Card>
                </AnimateOnScroll>
=======
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
>>>>>>> 9e5f20040fea26f783859ddc40a4a817515ed4e5
              ))}
            </div>

<<<<<<< HEAD
            <AnimateOnScroll className="text-center mt-10">
              <Button asChild size="lg">
                <Link href="/book">Book a Class</Link>
              </Button>
            </AnimateOnScroll>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            WHY SHARWIN
        ═══════════════════════════════════════════════ */}
        <section id="benefits" className="py-14 border-t-4 border-blue-800 bg-slate-50">
          <div className="container mx-auto px-4">
            <AnimateOnScroll className="text-center mb-10">
              <div className="text-sm font-semibold uppercase tracking-widest text-primary mb-2">
                Why Choose Us
              </div>
              <h2 className="text-3xl font-bold">
                <a
                  href="#benefits"
                  className="group/h inline-flex items-center justify-center gap-2 hover:text-primary transition-colors"
                >
                  Why Sharwin Table Tennis Academy?
                  <Link2 className="h-5 w-5 opacity-0 group-hover/h:opacity-30 transition-opacity shrink-0" />
                </a>
              </h2>
            </AnimateOnScroll>

            {/* Featured: We Come to You */}
            <AnimateOnScroll>
              <div className="relative bg-gradient-to-br from-blue-700 to-blue-950 text-white rounded-2xl p-8 mb-6 overflow-hidden text-center shadow-xl">
                <div className="absolute inset-0 opacity-[0.07] pointer-events-none">
                  <Image src="/images/Group4.jpeg" alt="" fill className="object-cover" sizes="100vw" />
                </div>
                <div className="relative">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-yellow-400/20 mb-4">
                    <Home className="h-8 w-8 text-yellow-400" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">We Come to You</h3>
                  <p className="text-blue-100 max-w-2xl mx-auto text-base leading-relaxed">
                    No need to travel. Our expert coaches come to your home, society, or community hall
                    across Bangalore. Professional table tennis coaching, delivered to your doorstep —
                    on your schedule.
                  </p>
                  <Button
                    asChild
                    size="lg"
                    className="mt-5 bg-yellow-400 text-yellow-950 hover:bg-yellow-300 font-bold"
                  >
                    <Link href="/book">Book a Class</Link>
                  </Button>
                </div>
              </div>
            </AnimateOnScroll>

            <div className="grid gap-5 md:grid-cols-3">
              {[
                {
                  icon: <Users className="h-7 w-7 text-primary" />,
                  title: "Group Classes",
                  desc: "Batch sessions with flexible schedules throughout the week.",
                },
                {
                  icon: <Clock className="h-7 w-7 text-primary" />,
                  title: "Private Sessions",
                  desc: "One-on-one coaching tailored entirely to your goals and availability.",
                },
                {
                  icon: <CalendarDays className="h-7 w-7 text-primary" />,
                  title: "Easy Scheduling",
                  desc: "Book and manage sessions online — synced with Google Calendar automatically.",
                },
              ].map((f, idx) => (
                <AnimateOnScroll key={f.title} delay={idx * 100}>
                  <Card className="border border-gray-100 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 bg-white">
                    <CardContent className="pt-5 pb-5">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/8 mb-3">
                        {f.icon}
                      </div>
                      <h3 className="font-semibold text-base mb-1">{f.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                    </CardContent>
                  </Card>
                </AnimateOnScroll>
              ))}
=======
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
>>>>>>> 9e5f20040fea26f783859ddc40a4a817515ed4e5
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════
            CONTACT
        ═══════════════════════════════════════════════ */}
        <section
          id="contact"
          className="py-16 bg-gradient-to-br from-red-700 to-red-800 text-white border-t-4 border-red-600 overflow-hidden relative"
        >
          <div className="absolute inset-0 opacity-[0.06] pointer-events-none">
            <Image src="/images/Group5.jpeg" alt="" fill className="object-cover" sizes="100vw" />
          </div>

          <div className="relative container mx-auto px-4 text-center">
            <AnimateOnScroll>
              <div className="text-sm font-semibold uppercase tracking-widest text-red-200 mb-2">
                Get in Touch
              </div>
              <h2 className="text-3xl font-bold mb-3">
                <a
                  href="#contact"
                  className="group/h inline-flex items-center justify-center gap-2 hover:text-red-100 transition-colors"
                >
                  Contact Us
                  <Link2 className="h-5 w-5 opacity-0 group-hover/h:opacity-40 transition-opacity shrink-0" />
                </a>
              </h2>
              <p className="text-white/80 max-w-md mx-auto mb-10">
                Ready to start? Reach out and we&apos;ll come to you.
              </p>
            </AnimateOnScroll>

            <AnimateOnScroll delay={100}>
              <div className="grid sm:grid-cols-3 gap-4 max-w-xl mx-auto mb-10">
                {/* WhatsApp */}
                <a
                  href="https://wa.me/91XXXXXXXXXX"
                  className="flex flex-col items-center gap-2 p-5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center shadow-md group-hover:bg-green-400 transition-colors">
                    <MessageCircle className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm">WhatsApp</div>
                    {/* TODO: Replace with actual WhatsApp number */}
                    <div className="text-white/65 text-xs mt-0.5">+91 XXXXX XXXXX</div>
                  </div>
                </a>

                {/* Email */}
                <a
                  href="mailto:info@sharwintt.com"
                  className="flex flex-col items-center gap-2 p-5 rounded-xl bg-white/10 hover:bg-white/20 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center shadow-md group-hover:bg-blue-400 transition-colors">
                    <Mail className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm">Email</div>
                    {/* TODO: Replace with actual email */}
                    <div className="text-white/65 text-xs mt-0.5">info@sharwintt.com</div>
                  </div>
                </a>

                {/* Location */}
                <div className="flex flex-col items-center gap-2 p-5 rounded-xl bg-white/10">
                  <div className="w-12 h-12 rounded-full bg-yellow-500 flex items-center justify-center shadow-md">
                    <MapPin className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm">Location</div>
                    <div className="text-white/65 text-xs mt-0.5">Bangalore, Karnataka</div>
                  </div>
                </div>
              </div>
            </AnimateOnScroll>

            <AnimateOnScroll delay={200}>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  asChild
                  size="lg"
                  className="bg-white text-red-700 hover:bg-white/90 font-bold min-w-[200px]"
                >
                  <Link href="/book">Book a Class</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  className="bg-white/15 text-white border border-white/50 hover:bg-white/25 min-w-[200px]"
                >
                  <Link href="/login">Sign In</Link>
                </Button>
              </div>
            </AnimateOnScroll>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}
