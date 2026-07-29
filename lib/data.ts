import { unstable_cache } from "next/cache";
import { createClient as createPublicClient } from "@supabase/supabase-js";

/**
 * Cookie-less anon client for public reference data. `unstable_cache` callbacks
 * can't read cookies (a dynamic data source), and this data is public-read, so
 * the cached readers below use a plain anon client instead of the SSR one.
 */
function publicClient() {
  return createPublicClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * One row of `public.public_coach_roster()` — the RLS-safe coach projection.
 * `full_name` and the base coordinates are NOT NULL on their source columns, so
 * they are narrowed here even though a RETURNS TABLE column is always nullable.
 */
export type CoachRosterRow = {
  id: string;
  full_name: string;
  bio: string | null;
  quote: string | null;
  credentials: string[] | null;
  photo_url: string | null;
  base_lat: number;
  base_lng: number;
};

/** A coach as shown on the public /coaches page — sourced entirely from the DB. */
export type PublicCoach = {
  slug: string;
  name: string;
  image: string;
  bio: string;
  quote?: string;
  credentials?: string[];
};

export type Plan = {
  id: string;
  name: string;
  description: string | null;
  price_pence: number;
  group_sessions_per_week: number | null;
  private_minutes_per_cycle: number;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  kind: "group_dropin" | "private_oneoff" | "private_intro";
  price_pence: number;
  member_price_pence: number | null;
  grants_minutes: number;
  duration_minutes: number | null;
};

export type Venue = {
  id: string;
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  photo_url: string | null;
};

export type ClassRow = {
  id: string;
  title: string;
  description: string | null;
  skill_level: string;
  capacity: number;
  duration_minutes: number;
  venue_id: string | null;
};

export type SessionRow = {
  id: string;
  class_id: string;
  coach_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  capacity_override: number | null;
};

export const getPlans = unstable_cache(
  async (): Promise<Plan[]> => {
    const supabase = publicClient();
    const { data } = await supabase
      .from("plans")
      .select("id,name,description,price_pence,group_sessions_per_week,private_minutes_per_cycle")
      .eq("active", true)
      .order("price_pence");
    return data ?? [];
  },
  ["reference:plans"],
  { revalidate: 3600, tags: ["plans"] }
);

export const getProducts = unstable_cache(
  async (): Promise<Product[]> => {
    const supabase = publicClient();
    const { data } = await supabase
      .from("products")
      .select("id,name,description,kind,price_pence,member_price_pence,grants_minutes,duration_minutes")
      .eq("active", true)
      .order("price_pence");
    return data ?? [];
  },
  ["reference:products"],
  { revalidate: 3600, tags: ["products"] }
);

export const getVenues = unstable_cache(
  async (): Promise<Venue[]> => {
    const supabase = publicClient();
    const { data } = await supabase
      .from("venues")
      .select("id,name,address,postcode,lat,lng,photo_url")
      .eq("active", true)
      .order("name");
    return data ?? [];
  },
  ["reference:venues"],
  { revalidate: 3600, tags: ["venues"] }
);

export const getGroupClasses = unstable_cache(
  async (): Promise<ClassRow[]> => {
    const supabase = publicClient();
    const { data } = await supabase
      .from("classes")
      .select("id,title,description,skill_level,capacity,duration_minutes,venue_id")
      .eq("active", true)
      .eq("class_type", "group")
      .order("title");
    return data ?? [];
  },
  ["reference:group-classes"],
  { revalidate: 3600, tags: ["classes"] }
);

// Time-windowed, so cached briefly (10 min) rather than the hour used for the
// near-static reference data. Only powers the public /locations page.
export const getUpcomingSessions = unstable_cache(
  async (days = 14): Promise<SessionRow[]> => {
    const supabase = publicClient();
    const until = new Date(Date.now() + days * 86400000).toISOString();
    const { data } = await supabase
      .from("class_sessions")
      .select("id,class_id,coach_id,starts_at,ends_at,status,capacity_override")
      .eq("status", "scheduled")
      .gt("starts_at", new Date().toISOString())
      .lt("starts_at", until)
      .order("starts_at");
    return data ?? [];
  },
  ["reference:upcoming-sessions"],
  { revalidate: 600, tags: ["classes"] }
);

/** The public coaching roster — active coaches, straight from the DB. */
export const getCoaches = unstable_cache(
  async (): Promise<PublicCoach[]> => {
    const supabase = publicClient();
    // Read through the definer-rights roster function rather than joining
    // `profiles` directly: RLS keeps `profiles` owner-only, so an anon join
    // returns nothing. See migration 0040_public_coach_roster.sql.
    const { data } = await supabase.rpc("public_coach_roster");

    if (!data) return [];

    return (data as CoachRosterRow[]).map((row) => {
      const firstName = row.full_name.toLowerCase().split(" ")[0];
      return {
        slug: firstName || row.id,
        name: row.full_name,
        image: row.photo_url ?? "/images/empty-ink.jpg",
        bio: row.bio ?? "",
        quote: row.quote ?? undefined,
        credentials: row.credentials ?? undefined,
      };
    });
  },
  ["reference:coaches"],
  { revalidate: 3600, tags: ["coaches"] }
);

/** `pence` holds paise (minor unit of INR). ₹1,800,000 paise → "₹18,000". */
export { formatPrice } from "./format";

// Session time formatting lives in lib/academy-time.ts — this module imports
// the server Supabase client, so client components can't reach it.
