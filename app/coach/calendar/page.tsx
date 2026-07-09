import { redirect } from "next/navigation";

// The calendar was merged into the single coach schedule at /coach. Kept as a
// redirect so existing notification deep-links (/coach/calendar) still land.
export default function CoachCalendarRedirect() {
  redirect("/coach");
}
