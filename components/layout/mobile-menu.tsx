"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const navLinks = [
  { href: "/#gallery", label: "Gallery" },
  { href: "/#founder", label: "Our Story" },
  { href: "/#coaches", label: "Coaches" },
  { href: "/#benefits", label: "Why Us" },
  { href: "/#join-us", label: "Join Our Team" },
  { href: "/#contact", label: "Contact" },
];

export function MobileMenu({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Hamburger button — mobile only */}
      <button
        className="lg:hidden flex items-center justify-center w-9 h-9 rounded-md bg-muted text-foreground hover:bg-muted/80 transition-colors"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar — slides in from left */}
      <div
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-white border-r shadow-lg transform transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-16 border-b">
          <span className="text-sm font-bold text-primary">Menu</span>
          <button
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex flex-col px-2 py-3 gap-0.5">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="px-3 py-2.5 text-sm font-medium rounded-md text-foreground hover:bg-muted transition-colors"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}

          <div className="my-2 mx-3 border-t" />

          <Link
            href="/book"
            className="px-3 py-2.5 text-sm font-medium rounded-md text-foreground hover:bg-muted transition-colors"
            onClick={() => setOpen(false)}
          >
            Book a Class
          </Link>

          {isLoggedIn && (
            <Link
              href="/dashboard/bookings"
              className="px-3 py-2.5 text-sm font-medium rounded-md text-foreground hover:bg-muted transition-colors"
              onClick={() => setOpen(false)}
            >
              Manage Bookings
            </Link>
          )}

          {!isLoggedIn && (
            <Link
              href="/login"
              className="mx-1 mt-3 flex items-center justify-center px-3 py-2.5 text-sm font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={() => setOpen(false)}
            >
              Sign In
            </Link>
          )}
        </nav>
      </div>
    </>
  );
}
