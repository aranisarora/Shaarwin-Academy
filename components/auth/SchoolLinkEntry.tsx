"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui/Spinner";
import { LINK_TOKEN_KEY, SCHOOL_LOGIN_PATH, unpack } from "@/lib/school-handover";

/**
 * Redeems a tap-to-enter link and gets out of the way.
 *
 * The credential arrives in the URL fragment, which is why this is a component
 * and not a route handler: a fragment is never sent to a server, so only the
 * page itself can read it. That is the property the whole link design rests on
 * — see `instantLoginUrl` for what it buys and what it costs.
 *
 * It holds no state of its own on purpose. Every outcome is a navigation:
 * signed in and gone, or forwarded to the ordinary school form, which is
 * already the right place to be for every way this can fail. There is nothing
 * for this screen to render except the fact that it is working.
 */
export function SchoolLinkEntry({ next }: { next?: string }) {
  const router = useRouter();
  const supabase = createClient();
  // Once. React re-invokes effects in development, and a second sign-in racing
  // the first would be a second audited login for one tap.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(
      window.location.hash.replace(/^#/, "")
    ).get(LINK_TOKEN_KEY);
    const credential = token ? unpack(token) : null;

    // Before anything else, and before any await: from here the live credential
    // is out of the address bar, and — because replaceState rewrites the current
    // entry rather than pushing a new one — out of this tab's history too. It
    // has already served its purpose by being read.
    window.history.replaceState(null, "", window.location.pathname);

    // A link carrying nothing we can read gets no explanation, because there is
    // nothing useful to say: the form is the answer to every version of it.
    if (!credential) {
      router.replace(SCHOOL_LOGIN_PATH);
      return;
    }

    supabase.auth
      .signInWithPassword(credential)
      .then(({ error }) => {
        if (error) {
          // Overwhelmingly this is a password rotated since the message was
          // sent. The email still tells us who they are, so it goes with them
          // and is prefilled on the form; the stale password does not, and must
          // not — a query string is exactly where it should never be.
          router.replace(
            `${SCHOOL_LOGIN_PATH}?link=stale&email=${encodeURIComponent(credential.email)}`
          );
          return;
        }
        // Hard navigate: the server needs the fresh auth cookie, and an RSC
        // fetch fires before the cookie is committed. A visitor who is not a
        // school gets corrected to their own home by the proxy on arrival.
        window.location.replace(next || "/school");
      })
      .catch(() => router.replace(`${SCHOOL_LOGIN_PATH}?link=stale`));
    // Once, on arrival, from the URL this page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <Spinner />
      <p className="text-fg-2">Signing you in…</p>
    </div>
  );
}
