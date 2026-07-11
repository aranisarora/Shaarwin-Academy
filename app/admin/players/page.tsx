import { redirect } from "next/navigation";

// Players merged into the Clients tab — one hub for people, two views.
export default function AdminPlayersPage() {
  redirect("/admin/clients?view=players");
}
