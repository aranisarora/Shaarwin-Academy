import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // In development this checkout is a git worktree nested inside another
  // checkout of the same repo, which puts two lockfiles in scope: Next then
  // picks the OUTER one as the workspace root and compiles the outer tree's
  // files (its proxy.ts, its /app routes) into this build. Naming the root
  // explicitly pins the build to this directory. On Vercel there is only ever
  // one checkout, so this is a no-op there.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  // No remote images: every coach and venue photo is a file in public/, written
  // there by scripts/export-content.mjs. Nothing the site renders depends on
  // Supabase Storage being reachable any more.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "sharwin-tabletennisacademy.com" }],
        destination: "https://sharwinacademy.com/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.sharwin-tabletennisacademy.com" }],
        destination: "https://sharwinacademy.com/:path*",
        permanent: true,
      },
      // ── The app that used to live here ──
      //
      // /app, /coach, /admin and /school were the signed-in shells; /login and
      // /signup were their doors. All of it now happens in a WhatsApp thread.
      // These links are still in the wild — in months of notification history,
      // in already-approved WhatsApp templates, on phones' home screens and in
      // browser autocomplete — so they land on the timetable rather than a 404.
      //
      // Deliberately temporary (permanent: false): a permanent redirect is
      // cached by browsers forever, and if any of these paths is ever wanted
      // again, that cache cannot be recalled.
      ...["/login", "/signup", "/app", "/coach", "/admin", "/school"].flatMap(
        (source) => [
          { source, destination: "/schedule", permanent: false },
          {
            source: `${source}/:path*`,
            destination: "/schedule",
            permanent: false,
          },
        ]
      ),
    ];
  },
};

export default nextConfig;
