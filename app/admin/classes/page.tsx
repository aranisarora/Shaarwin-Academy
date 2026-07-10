import { redirect } from "next/navigation";

// Classes merged into the calendar — one page for the schedule and the weekly
// classes behind it. Kept as a redirect so old links and bookmarks still work.
export default function AdminClassesPage() {
  redirect("/admin/calendar");
}
