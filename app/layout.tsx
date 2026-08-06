import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Sharwin Table Tennis Academy — Bengaluru",
    template: "%s — Sharwin Table Tennis Academy",
  },
  description:
    "ITTF-certified coaching at your society, school, college or office. Play faster. Think faster.",
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    title: "Sharwin Table Tennis Academy — Bengaluru",
    description:
      "ITTF-certified coaching at your society, school, college or office. Play faster. Think faster.",
    url: siteUrl,
    siteName: "Sharwin Table Tennis Academy",
    images: [
      {
        url: "/images/og-logo.jpg",
        width: 1200,
        height: 630,
        alt: "Sharwin Table Tennis Academy",
      },
    ],
    locale: "en_GB",
    type: "website",
  },
  // Installed on a home screen this stops being a website. `title` is the label
  // under the icon — without it iOS falls back to the full page title, which is
  // four words too long to fit. The status bar stays "default" (dark text on our
  // own ivory) rather than black-translucent: nothing in the shell reserves a
  // top inset yet, and a translucent bar would slide the header under the clock.
  appleWebApp: {
    capable: true,
    title: "Sharwin TTA",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // viewportFit is the whole ballgame. Next only emits `viewport-fit=cover` when
  // this is set, and without it every env(safe-area-inset-*) in the codebase
  // resolves to 0px — the tab bar's inset, the FAB's offset, the sheet's bottom
  // padding, all of it silently dead, and the app letterboxed inside black bars
  // on a notched phone instead of running edge to edge.
  viewportFit: "cover",
  // The signed-in shell is ivory from top to bottom and there is no dark mode to
  // switch to, so say so: otherwise iOS renders native pickers and form controls
  // in dark styling against light chrome.
  colorScheme: "light",
  // Ink, because this root is shared with the dark marketing site — the landing
  // page, /login, /coaches, /colleges, /locations, the legal pages and 404 all
  // render the stage. Ivory here would paint an ivory address bar above a black
  // hero on the first screen a stranger ever sees. The four signed-in layouts
  // (/app, /coach, /admin, /school) each export their own themeColor; a nested
  // viewport export merges over this one, so everything else here still reaches
  // them.
  themeColor: "#0B0C0F",
  // Android shrinks the layout viewport for us when the keyboard opens, so a
  // sheet's Save button rides up with it instead of hiding underneath. iOS
  // ignores this — Sheet.tsx measures visualViewport itself for that.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-GB"
      className={`${fraunces.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
