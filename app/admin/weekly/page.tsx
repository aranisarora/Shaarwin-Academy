import { redirect } from "next/navigation";

// Weekly classes is a view inside the Schedule tab now, not a tab of its own.
// Both names were time words that described each other — the schedule showed a
// seven-day window, the weekly list showed a Mon–Sun grid — so which one you
// wanted was never readable off the label. They are "This week" and "Timetable"
// now, one switch apart.
//
// Old links, bookmarks and stored notification URLs still land here.
export default async function AdminWeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}) {
  const { class: classId } = await searchParams;
  redirect(
    classId
      ? `/admin/schedule?view=timetable&class=${classId}`
      : "/admin/schedule?view=timetable"
  );
}
