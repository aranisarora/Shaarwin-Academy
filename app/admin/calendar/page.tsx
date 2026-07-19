import { redirect } from "next/navigation";

// The calendar was renamed to Schedule. Old links (including notification URLs
// stored in the database) still land here, so keep a redirect.
export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  redirect(week ? `/admin/schedule?week=${week}` : "/admin/schedule");
}
