import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    ];
  },
};

export default nextConfig;
