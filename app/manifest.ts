import type { MetadataRoute } from "next";

/**
 * There is no installable app any more — this is a marketing site with a public
 * timetable. The manifest stays so an added-to-home-screen shortcut gets the
 * academy's icon and name rather than a screenshot of the page, but it opens at
 * the front door and wears the site's own ink chrome.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sharwin Table Tennis Academy",
    short_name: "Sharwin TTA",
    description:
      "Table tennis coaching across Bengaluru — classes, coaches and this week's schedule.",
    start_url: "/",
    display: "browser",
    background_color: "#0B0C0F",
    theme_color: "#0B0C0F",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
