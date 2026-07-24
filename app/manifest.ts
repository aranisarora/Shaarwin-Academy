import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sharwin Table Tennis Academy",
    short_name: "Sharwin TTA",
    description: "Book table tennis classes and private coaching.",
    start_url: "/app",
    display: "standalone",
    background_color: "#F4F1EA",
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
