/**
 * Static coach roster — real people, real portraits (P1 pipeline edits).
 * Used as fallback wherever the coaches table has no row yet; DB rows win.
 */
export type StaticCoach = {
  slug: string;
  name: string;
  level: string;
  bio: string;
  image: string;
  /** Coaching philosophy in the coach's own words. */
  quote?: string;
  /** Certifications and playing honours, shown as pills on the coaches page. */
  credentials?: string[];
};

export const STATIC_COACHES: StaticCoach[] = [
  {
    slug: "samir",
    name: "Samir",
    level: "Elite",
    bio: "Former county number one. Calm, technical, relentless about footwork. Focuses on advanced spin, footwork patterns and custom game plans for tournament players.",
    image: "/images/coach-samir.jpg",
    quote: "Success on the table is built through dedication off the table.",
    credentials: ["6 years coaching", "ITTF certified", "State & National player"],
  },
  {
    slug: "nandan",
    name: "Nandan",
    level: "Advanced",
    bio: "Attack-first coach who loves teaching the third-ball game. Combines competitive experience with structured coaching — speed drills, match tactics and mental preparation.",
    image: "/images/coach-nandan.jpg",
    quote: "Play with courage, win with strategy.",
    credentials: ["4+ years coaching", "ITTF certified", "State & National player"],
  },
  {
    slug: "sunil",
    name: "Sunil",
    level: "Advanced",
    bio: "ITTF certified, eight years coaching. High-tempo, adaptive sessions that keep you thinking as fast as you move.",
    image: "/images/coach-sunil.jpg",
    quote: "The best players never stop learning — and neither do I.",
    credentials: ["8+ years coaching", "ITTF certified"],
  },
  {
    slug: "augustine",
    name: "Augustine",
    level: "Advanced",
    bio: "ITTF certified, seven years coaching. Breaks complex strokes into clean, learnable pieces — consistency wins matches, confidence wins championships.",
    image: "/images/coach-augustine.jpg",
    quote: "Consistency wins matches. Confidence wins championships.",
    credentials: ["7+ years coaching", "ITTF certified"],
  },
  {
    slug: "rushi",
    name: "Rushi",
    level: "Intermediate",
    bio: "High-energy sessions built around rally endurance and placement. Patient, structured, focused on ball control and reaction time for young talents and beginners.",
    image: "/images/coach-rushi.jpg",
    quote: "Mastering the basics is the first step to mastering the table.",
    credentials: ["3 years coaching", "ITTF certified", "State & National player"],
  },
  {
    slug: "purnendu",
    name: "Purnendu",
    level: "Advanced",
    bio: "ITTF and NIS certified, nine years coaching. Builds tournament players — fast tactical decisions and aggressive counter-loops.",
    image: "/images/coach-purnendu.jpg",
    quote: "Every player has a champion inside — my job is to bring it out.",
    credentials: ["9+ years coaching", "ITTF certified", "NIS certified"],
  },
  {
    slug: "sampath",
    name: "Sampath",
    level: "Intermediate",
    bio: "ITTF certified, seven years coaching. Footwork-first fundamentals — every point starts with the right mindset and a solid base.",
    image: "/images/coach-sampath.jpg",
    quote: "Every point starts with the right mindset.",
    credentials: ["7+ years coaching", "ITTF certified"],
  },
  {
    slug: "shreyangshu",
    name: "Shreyangshu",
    level: "Advanced",
    bio: "Tactician. Match-play sessions that feel like chess at speed. Focuses on offensive strategies and rapid transitions for players moving into competitive league play.",
    image: "/images/coach-shreyangshu.jpg",
    quote: "Turn every defence into a powerful counter-attack.",
    credentials: ["3+ years coaching", "State & National player"],
  },
  {
    slug: "nishchithh",
    name: "Nishchithh",
    level: "Intermediate",
    bio: "ITTF certified. A diagnostic eye for the small stuff — fixes stroke and footwork habits before they set. Master the basics and the rest follows.",
    image: "/images/coach-nishchithh.jpg",
    quote: "Master the basics, and the rest will follow.",
    credentials: ["4+ years coaching", "ITTF certified"],
  },
];
