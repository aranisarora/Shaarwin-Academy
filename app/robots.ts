import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      // Everything here is public. The old disallow list named /app, /coach and
      // /admin — routes that no longer exist; they are now redirects to
      // /schedule, which is itself indexable.
      allow: "/",
      // The timetable's ?from= links generate an unbounded number of week URLs.
      // The bare page is the one worth indexing.
      disallow: ["/schedule?"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
