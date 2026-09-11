/**
 * The academy's public reference data — venues, coaches, plans and products.
 *
 * There is no database behind this site any more. Everything here is read from
 * content/academy.json, which `node scripts/export-content.mjs` regenerates
 * from Sharwin's Supabase project by hand (see AGENTS.md). The readers stay
 * async so the pages that `await` them — and render them inside <Suspense> —
 * did not have to change shape when the source did.
 *
 * The live timetable is NOT here: it comes from bluetick's diary endpoint at
 * request time. See lib/bluetick.ts.
 */

import academy from "@/content/academy.json";

/** A coach as shown on the public /coaches page. */
export type PublicCoach = {
  slug: string;
  name: string;
  image: string;
  bio: string;
  quote?: string;
  credentials?: string[];
};

export type Plan = {
  name: string;
  description: string | null;
  price_pence: number;
  billing_interval_months: number | null;
  group_sessions_per_week: number | null;
  private_minutes_per_cycle: number;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  price_pence: number;
  member_price_pence: number | null;
  grants_minutes: number;
  duration_minutes: number | null;
};

export type Venue = {
  id: string;
  name: string;
  /** Which part of a complex — always render through venueDisplayName, or the
   *  three Adarsh Palm Retreat rows read as one repeated venue. */
  unit: string | null;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  notes: string | null;
  photo: string | null;
};

/** Shown when a coach has no portrait of their own. */
const COACH_FALLBACK_IMAGE = "/images/empty-ink.jpg";

const VENUES: Venue[] = academy.venues.map((v) => ({
  id: v.id,
  name: v.name,
  unit: v.unit,
  address: v.address,
  postcode: v.postcode,
  lat: v.lat,
  lng: v.lng,
  notes: v.notes,
  photo: v.photo,
}));

const COACHES: PublicCoach[] = academy.coaches.map((c) => ({
  slug: c.name.toLowerCase().split(" ")[0] || c.id,
  name: c.name,
  image: c.photo ?? COACH_FALLBACK_IMAGE,
  bio: c.bio ?? "",
  quote: c.quote ?? undefined,
  credentials: c.credentials ?? undefined,
}));

const PLANS: Plan[] = academy.plans;
const PRODUCTS: Product[] = academy.products;

export async function getVenues(): Promise<Venue[]> {
  return VENUES;
}

export async function getCoaches(): Promise<PublicCoach[]> {
  return COACHES;
}

export async function getPlans(): Promise<Plan[]> {
  return PLANS;
}

export async function getProducts(): Promise<Product[]> {
  return PRODUCTS;
}

/** `pence` holds paise (minor unit of INR). ₹1,800,000 paise → "₹18,000". */
export { formatPrice } from "./format";
