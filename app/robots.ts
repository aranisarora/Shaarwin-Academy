import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /schedule is the founder's page, behind a key (lib/schedule-gate.ts).
      // It says noindex itself; this keeps a crawler from even asking. /app,
      // /coach and /admin redirect there and need no line of their own.
      disallow: ["/schedule"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
