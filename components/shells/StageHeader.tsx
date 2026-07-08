"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import logo from "@/public/images/logo.png";

const nav = [
  { href: "/locations", label: "Locations" },
  { href: "/pricing", label: "Pricing" },
  { href: "/coaches", label: "Coaches" },
];

export function StageHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-200 ${
        scrolled
          ? "border-b border-line bg-ink/90 backdrop-blur"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          aria-label="Sharwin Table Tennis Academy — home"
          className="flex items-center gap-2.5"
        >
          <Image
            src={logo}
            alt=""
            aria-hidden
            priority
            className="h-10 w-auto md:h-11"
          />
          <span className="hidden font-display text-lg tracking-wide sm:inline">
            SHARWIN TABLE TENNIS ACADEMY
          </span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hidden min-h-11 items-center rounded-[8px] px-3 text-sm text-fg-2 transition-colors hover:text-fg sm:inline-flex"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded-[8px] px-3 text-sm text-fg-2 transition-colors hover:text-fg"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex min-h-11 items-center rounded-[8px] bg-ember px-4 text-sm font-semibold text-ivory transition-colors hover:bg-ember-2"
          >
            Find a class
          </Link>
        </nav>
      </div>
    </header>
  );
}
