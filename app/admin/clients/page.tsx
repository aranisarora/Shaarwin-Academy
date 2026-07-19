import { redirect } from "next/navigation";

// Clients was renamed to Players (with an Account holders view). Old links —
// including notification URLs stored in the database — still land here.
export default function AdminClientsPage() {
  redirect("/admin/players?view=clients");
}
