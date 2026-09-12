"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/");
        router.refresh();
      }}
      className="inline-flex min-h-11 items-center rounded-[8px] px-5 text-sm font-semibold text-fg-2 hover:text-err"
    >
      Sign out
    </button>
  );
}
