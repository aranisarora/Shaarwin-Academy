/**
 * Student stories restored from the previous site. Each card shows the arc
 * from where a player started to where they are now — kept to two short lines
 * so the section reads clean rather than as a before/after sales matrix.
 */
export type Testimonial = {
  name: string;
  duration: string;
  before: string;
  after: string;
};

export const TESTIMONIALS: Testimonial[] = [
  {
    name: "Rajan K.",
    duration: "1 year",
    before:
      "Couldn't sustain a ten-shot rally. Basic footwork was a struggle and I felt lost at the table.",
    after:
      "Won my first club-level tournament. My footwork is unrecognisable — I chase down wide balls I used to miss entirely.",
  },
  {
    name: "Priya S.",
    duration: "9 months",
    before:
      "Played purely defensively out of fear. Fast topspin terrified me and I had no attacking game.",
    after:
      "Built a confident, aggressive playstyle. Won two local matches last month and I'm no longer afraid of heavy play.",
  },
  {
    name: "Arjun M.",
    duration: "1 year",
    before:
      "A complete beginner who'd never held a paddle properly. Zero match experience.",
    after:
      "Competed in my first intra-club tournament and placed in the top half. The structured, patient coaching made the difference.",
  },
  {
    name: "Divya R.",
    duration: "2 years",
    before:
      "Predictable serves and weak returns. Opponents read my game and exploited it every time.",
    after:
      "My win rate jumped from 20% to over 60%. Opponents now struggle to anticipate my serves — it changed my game.",
  },
  {
    name: "Karthik V.",
    duration: "1.5 years",
    before:
      "I crumbled under match pressure even when I was the better player. Lost close games repeatedly.",
    after:
      "Calmer, sharper, far more consistent. The mental side of the coaching rewired how I approach competition.",
  },
  {
    name: "Sneha L.",
    duration: "1 year",
    before:
      "Joined purely to stay active. No ambition to compete — just wanted some exercise.",
    after:
      "Now a competitive player representing my office team in inter-corporate tournaments. It changed everything.",
  },
];
