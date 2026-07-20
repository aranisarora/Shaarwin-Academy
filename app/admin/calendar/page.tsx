import { redirect } from "next/navigation";

// The calendar was renamed to Schedule. Old links (including notification URLs
// stored in the database) still land here, so keep a redirect.
export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; week?: string }>;
}) {
  const { date, week } = await searchParams;
  if (date) redirect(`/admin/schedule?date=${date}`);
  // Legacy links used a week offset; the schedule page still understands it.
  if (week) redirect(`/admin/schedule?week=${week}`);
  redirect("/admin/schedule");
}
