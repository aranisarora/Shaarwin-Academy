"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const navLinks = [
  { href: "/#gallery", label: "Gallery" },
  { href: "/#founder", label: "Our Story" },
  { href: "/#coaches", label: "Coaches" },
  { href: "/#benefits", label: "Why Us" },
  { href: "/#contact", label: "Contact" },
];

export function MobileMenu({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="lg:hidden flex items-center justify-center p-2 rounded-md text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 z-50 h-full w-72 bg-background shadow-xl transform transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <span className="text-base font-bold text-primary">
            Sharwin Table Tennis Academy
          </span>
          <button
            className="p-2 rounded-md text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex flex-col p-4 gap-1">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="px-3 py-3 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}

          <div className="my-3 border-t" />

          <Link
            href="/book"
            className="px-3 py-3 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => setOpen(false)}
          >
            Book a Class
          </Link>

          {isLoggedIn && (
            <Link
              href="/dashboard/bookings"
              className="px-3 py-3 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={() => setOpen(false)}
            >
              Manage Bookings
            </Link>
          )}
        </nav>
      </div>
    </>
  );
}
