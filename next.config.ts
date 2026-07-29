import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every signed-in route is dynamic (it reads the auth cookie), and each of
  // /app, /coach and /admin has a loading.tsx — which puts them all in the
  // `dynamic` client-cache bucket. That bucket defaults to 0s, so the shell
  // Next had already prefetched was thrown away the instant it arrived and
  // re-fetched through the proxy on every click. 30s means re-visiting a route
  // reuses the prefetched shell, which is what makes back/forward and
  // tab-switching feel instant from India.
  //
  // The cost is up to 30s of staleness on dashboard data. If a screen must be
  // fresh right after a mutation, call revalidatePath/revalidateTag in the
  // server action — don't lower this globally. Still flagged experimental in
  // Next 16.2.10; re-check on upgrade.
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  images: {
    remotePatterns: [
      // Coach portraits uploaded to Supabase Storage (public bucket).
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
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
      {
        // Coach "Clients" was renamed to "Players".
        source: "/coach/clients/:path*",
        destination: "/coach/players/:path*",
        permanent: true,
      },
      {
        source: "/coach/clients",
        destination: "/coach/players",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
