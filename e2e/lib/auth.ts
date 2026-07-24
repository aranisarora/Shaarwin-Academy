// Mint a Playwright storage state for ANY seeded role, on demand.
//
// Seeded users have real bcrypt passwords (SeedPass!2026, set in seed.sql), so
// "becoming a role" locally is just a password sign-in against the local stack
// — no OTP inbox, no admin-API token forgery, no stale hand-captured state.
//
// The one thing we refuse to guess is the cookie name/format @supabase/ssr
// expects. So instead of hand-rolling `sb-<ref>-auth-token` + base64 chunking,
// we drive the *real* @supabase/ssr client with an in-memory cookie jar and let
// it write the cookies itself — then hand exactly those to Playwright. Whatever
// the installed ssr version does, we match it by construction.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, ANON_KEY, assertLocalSupabase } from "./env";

// Project-root relative (see env.ts note on avoiding import.meta.url).
const authDir = join(process.cwd(), "e2e", ".auth");

export const SEED_PASSWORD = "SeedPass!2026";

// Known seed personas. Any other role name falls through to an explicit email,
// so adding a role is a seed row + a fixture line — no change here.
const ROLE_EMAILS: Record<string, string> = {
  client: "client-a@sharwin.example",
  "client-b": "client-b@sharwin.example",
  coach: "samir@sharwin.example",
  founder: "founder@sharwin.example",
};

// The app under test runs on localhost, so browser cookies live on this domain.
// (Independent of the Supabase URL host, which only decides the cookie *name*.)
const APP_COOKIE_DOMAIN = process.env.E2E_APP_HOST || "localhost";

type PwCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
};

export type StorageState = { cookies: PwCookie[]; origins: [] };

function resolveEmail(role: string): string {
  if (role.includes("@")) return role; // explicit email passed through
  const email = ROLE_EMAILS[role];
  if (!email) {
    throw new Error(
      `Unknown role "${role}". Pass a seeded email, or add it to ROLE_EMAILS.`
    );
  }
  return email;
}

/**
 * Sign a seeded user in and return a Playwright storage state carrying the
 * @supabase/ssr auth cookies. Also written to e2e/.auth/local-<role>.json for
 * reuse / debugging.
 */
export async function getStorageState(
  role: string,
  password: string = SEED_PASSWORD
): Promise<StorageState> {
  assertLocalSupabase();
  const email = resolveEmail(role);

  // In-memory cookie jar the ssr client reads from and writes to.
  const jar = new Map<string, { name: string; value: string }>();
  const supabase = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar.values()],
      setAll: (toSet) => {
        for (const { name, value } of toSet) {
          if (value === "") jar.delete(name);
          else jar.set(name, { name, value });
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  }
  if (jar.size === 0) {
    throw new Error(`No auth cookies were written for ${email} — sign-in produced no session.`);
  }

  const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const state: StorageState = {
    cookies: [...jar.values()].map((c) => ({
      name: c.name,
      value: c.value,
      domain: APP_COOKIE_DOMAIN,
      path: "/",
      expires: oneYear,
      httpOnly: false, // the browser supabase client reads these from JS
      secure: false, // http://localhost
      sameSite: "Lax",
    })),
    origins: [],
  };

  mkdirSync(authDir, { recursive: true });
  const safe = role.replace(/[^a-z0-9-]+/gi, "_");
  writeFileSync(join(authDir, `local-${safe}.json`), JSON.stringify(state, null, 2));
  return state;
}
