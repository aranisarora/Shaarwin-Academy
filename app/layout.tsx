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
    images: [{ url: "/images/og-card.jpg", width: 1920, height: 1005 }],
    locale: "en_GB",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0C0F",
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
