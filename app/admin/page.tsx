import { redirect } from "next/navigation";

// "Today" is gone. It led with today's classes — which was, row for row, the
// Schedule's first day through the same card, only worse: its cards were links,
// so opening one meant landing on the Schedule and THEN opening the sheet, two
// steps for what is one step there.
//
// Its one unique half, the needs-you list, is now the top of Alerts. The KPI
// strip only ever linked to Billing, which has the real numbers.
//
// Kept as a redirect: this is the founder's home route, it is where the role
// gate sends him on sign-in, and it is stored in notification URLs.
export default function AdminHomePage() {
  redirect("/admin/schedule");
}
