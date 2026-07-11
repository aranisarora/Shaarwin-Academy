import { createClient } from "@/lib/supabase/server";
import { STATIC_COACHES, type StaticCoach } from "@/lib/coaches-static";

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

export async function getPlans(): Promise<Plan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("id,name,description,price_pence,group_sessions_per_week,private_minutes_per_cycle")
    .eq("active", true)
    .order("price_pence");
  return data ?? [];
}

export async function getProducts(): Promise<Product[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id,name,description,kind,price_pence,member_price_pence,grants_minutes,duration_minutes")
    .eq("active", true)
    .order("price_pence");
  return data ?? [];
}

export async function getVenues(): Promise<Venue[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("venues")
    .select("id,name,address,postcode,lat,lng,photo_url")
    .eq("active", true)
    .order("name");
  return data ?? [];
}

export async function getGroupClasses(): Promise<ClassRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("classes")
    .select("id,title,description,skill_level,capacity,duration_minutes,venue_id")
    .eq("active", true)
    .eq("class_type", "group")
    .order("title");
  return data ?? [];
}

export async function getUpcomingSessions(days = 14): Promise<SessionRow[]> {
  const supabase = await createClient();
  const until = new Date(Date.now() + days * 86400000).toISOString();
  const { data } = await supabase
    .from("class_sessions")
    .select("id,class_id,coach_id,starts_at,ends_at,status,capacity_override")
    .eq("status", "scheduled")
    .gt("starts_at", new Date().toISOString())
    .lt("starts_at", until)
    .order("starts_at");
  return data ?? [];
}

/** DB coaches merged over the static roster (DB bio/level wins; portraits static). */
export async function getCoaches(): Promise<StaticCoach[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coaches")
    .select("id,bio,active,profiles!inner(full_name,avatar_url)")
    .eq("active", true);

  if (!data || data.length === 0) return STATIC_COACHES;

  const bySlug = new Map(STATIC_COACHES.map((c) => [c.slug, { ...c }]));
  for (const row of data) {
    const profile = row.profiles as unknown as { full_name: string; avatar_url: string | null };
    const slug = profile.full_name.toLowerCase().split(" ")[0];
    const existing = bySlug.get(slug);
    if (existing) {
      existing.bio = row.bio ?? existing.bio;
    } else {
      bySlug.set(slug, {
        slug,
        name: profile.full_name,
        level: "",
        bio: row.bio ?? "",
        image: profile.avatar_url ?? "/images/empty-ink.jpg",
      });
    }
  }
  return [...bySlug.values()];
}

/** `pence` holds paise (minor unit of INR). ₹1,800,000 paise → "₹18,000". */
export { formatPrice } from "./format";

export const ACADEMY_TZ = "Asia/Kolkata";

export function formatSessionTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: ACADEMY_TZ,
  }).format(new Date(iso));
}

export function formatSessionDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: ACADEMY_TZ,
  }).format(new Date(iso));
}
