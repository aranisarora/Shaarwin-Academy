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
};

export const STATIC_COACHES: StaticCoach[] = [
  {
    slug: "samir",
    name: "Samir",
    level: "Elite",
    bio: "Former county number one. Calm, technical, relentless about footwork.",
    image: "/images/coach-samir.jpg",
  },
  {
    slug: "nandan",
    name: "Nandan",
    level: "Advanced",
    bio: "Attack-first coach. Loves teaching the third-ball game.",
    image: "/images/coach-nandan.jpg",
  },
  {
    slug: "sunil",
    name: "Sunil",
    level: "Advanced",
    bio: "ITTF certified, eight years coaching. High-tempo, adaptive sessions that keep you thinking as fast as you move.",
    image: "/images/coach-sunil.jpg",
  },
  {
    slug: "augustine",
    name: "Augustine",
    level: "Advanced",
    bio: "ITTF certified, seven years coaching. Breaks complex strokes into clean, learnable pieces — consistency wins matches, confidence wins championships.",
    image: "/images/coach-augustine.jpg",
  },
  {
    slug: "rushi",
    name: "Rushi",
    level: "Intermediate",
    bio: "High-energy sessions built around rally endurance and placement.",
    image: "/images/coach-rushi.jpg",
  },
  {
    slug: "purnendu",
    name: "Purnendu",
    level: "Advanced",
    bio: "ITTF and NIS certified, nine years coaching. Builds tournament players — fast tactical decisions and aggressive counter-loops.",
    image: "/images/coach-purnendu.jpg",
  },
  {
    slug: "sampath",
    name: "Sampath",
    level: "Intermediate",
    bio: "ITTF certified, seven years coaching. Footwork-first fundamentals — every point starts with the right mindset and a solid base.",
    image: "/images/coach-sampath.jpg",
  },
  {
    slug: "shreyangshu",
    name: "Shreyangshu",
    level: "Advanced",
    bio: "Tactician. Match-play sessions that feel like chess at speed.",
    image: "/images/coach-shreyangshu.jpg",
  },
  {
    slug: "nishchithh",
    name: "Nishchithh",
    level: "Intermediate",
    bio: "ITTF certified. A diagnostic eye for the small stuff — fixes stroke and footwork habits before they set. Master the basics and the rest follows.",
    image: "/images/coach-nishchithh.jpg",
  },
];
