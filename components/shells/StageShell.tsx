import Image from "next/image";
import Link from "next/link";
import { StageHeader } from "./StageHeader";
import logo from "@/public/images/logo.png";

const footerCols = [
  {
    title: "Academy",
    links: [
      { href: "/locations", label: "Locations" },
      { href: "/coaches", label: "Coaches" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Log in" },
      { href: "/signup", label: "Sign up" },
      { href: "/app", label: "Member app" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/safeguarding", label: "Safeguarding" },
    ],
  },
];

/** Ink marketing shell: transparent header gaining ink+hairline on scroll, footer. */
export function StageShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-mood="stage" className="flex min-h-dvh flex-col bg-surface text-fg">
      <StageHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link href="/" className="inline-flex items-center">
              <Image
                src={logo}
                alt="Sharwin Table Tennis Academy"
                className="h-20 w-auto"
              />
            </Link>
            <p className="mt-3 max-w-[26ch] text-sm text-fg-2">
              Table tennis, taught properly. ITTF-certified coaching at your
              society, school, college or office — across Bengaluru.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-fg-2">
              <li>
                <a
                  href="https://wa.me/918431435758"
                  className="transition-colors hover:text-fg"
                >
                  WhatsApp: +91 84314 35758
                </a>
              </li>
              <li>
                <a
                  href="mailto:stalin@sharwinacademy.com"
                  className="transition-colors hover:text-fg"
                >
                  stalin@sharwinacademy.com
                </a>
              </li>
            </ul>
          </div>
          {footerCols.map((col) => (
            <div key={col.title}>
              <p className="label mb-4">{col.title}</p>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-sm text-fg-2 transition-colors hover:text-fg"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-line py-5 text-center text-xs text-fg-2">
          © {new Date().getFullYear()} Sharwin Table Tennis Academy, Bengaluru
          {" · "}Reg. No. 38/DOM/CE/0013/2026
        </div>
      </footer>
    </div>
  );
}
