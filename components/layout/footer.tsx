import Link from "next/link";
import Image from "next/image";
import { BRAND_NAME } from "@/config/operating-hours";
import { MessageCircle, Mail, MapPin } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-blue-950 text-white border-t-4 border-primary">
      <div className="container mx-auto px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 mb-8">

          {/* Brand */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/20 shrink-0">
                <Image
                  src="/images/Logo.jpeg"
                  alt={BRAND_NAME}
                  width={40}
                  height={40}
                  className="object-cover w-full h-full"
                />
              </div>
              <span className="font-bold text-base leading-tight">{BRAND_NAME}</span>
            </div>
            <p className="text-blue-200/70 text-sm leading-relaxed max-w-xs">
              ITTF-certified coaching brought directly to you. Expert coaches, structured
              programs, and real results for players of every level.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-blue-300 mb-3">
              Navigate
            </h4>
            <ul className="space-y-2 text-sm text-blue-200/70">
              {[
                { href: "/#gallery", label: "Gallery" },
                { href: "/#founder", label: "Our Story" },
                { href: "/#coaches", label: "Coaches" },
                { href: "/#benefits", label: "Why Us" },
                { href: "/#contact", label: "Contact" },
                { href: "/book", label: "Book a Class" },
              ].map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="hover:text-white transition-colors">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-blue-300 mb-3">
              Contact
            </h4>
            <ul className="space-y-3 text-sm text-blue-200/70">
              <li>
                <a
                  href="https://wa.me/91XXXXXXXXXX"
                  className="flex items-center gap-2 hover:text-white transition-colors"
                >
                  <MessageCircle className="h-4 w-4 text-green-400 shrink-0" />
                  {/* TODO: Replace with actual number */}
                  +91 XXXXX XXXXX
                </a>
              </li>
              <li>
                <a
                  href="mailto:info@sharwintt.com"
                  className="flex items-center gap-2 hover:text-white transition-colors"
                >
                  <Mail className="h-4 w-4 text-blue-400 shrink-0" />
                  {/* TODO: Replace with actual email */}
                  info@sharwintt.com
                </a>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                Bangalore, Karnataka
              </li>
            </ul>
          </div>

        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-blue-200/50">
          <p>&copy; {new Date().getFullYear()} {BRAND_NAME}. All rights reserved.</p>
          <div className="flex gap-5">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
