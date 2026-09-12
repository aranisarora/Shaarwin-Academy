import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The household's players, listed as direct shortcuts nested under the Players
 * tab in the desktop rail. Rendered inside a Suspense boundary so the shell
 * chrome (and the /app loading skeleton) paints without waiting on this query.
 */
export async function PlayerRailLinks() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: players } = await supabase
    .from("players")
    .select("id,full_name")
    .eq("client_id", user.id)
    .order("created_at");

  if (!players || players.length === 0) return null;

  return (
    <ul className="mb-1 ml-5 mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2">
      {players.map((p) => (
        <li key={p.id}>
          <Link
            href={`/app/players/${p.id}`}
            className="flex min-h-9 items-center rounded-[8px] px-2 text-sm text-fg-2 transition-colors hover:bg-surface hover:text-fg"
          >
            {p.full_name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
