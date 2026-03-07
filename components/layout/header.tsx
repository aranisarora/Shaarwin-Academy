import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileMenu } from "@/components/layout/mobile-menu";

export async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <MobileMenu isLoggedIn={!!user} />
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image
              src="/images/Logo.jpeg"
              alt="Sharwin Table Tennis Academy"
              width={36}
              height={36}
              className="rounded-full object-cover"
            />
            <span className="text-base font-bold tracking-tight text-primary hidden sm:block">
              Sharwin Table Tennis Academy
            </span>
            <span className="text-base font-bold tracking-tight text-primary sm:hidden">
              Sharwin Table Tennis Academy
            </span>
          </Link>
        </div>

        {/* Section navigation — desktop only */}
        <nav className="hidden lg:flex items-center gap-5 text-sm">
          <a href="/#gallery" className="text-muted-foreground hover:text-foreground transition-colors">
            Gallery
          </a>
          <a href="/#founder" className="text-muted-foreground hover:text-foreground transition-colors">
            Our Story
          </a>
          <a href="/#coaches" className="text-muted-foreground hover:text-foreground transition-colors">
            Coaches
          </a>
          <a href="/#benefits" className="text-muted-foreground hover:text-foreground transition-colors">
            Why Us
          </a>
          <a href="/#contact" className="text-muted-foreground hover:text-foreground transition-colors">
            Contact
          </a>
        </nav>

        <nav className="flex items-center gap-3">
          {user && (
            <Link
              href="/dashboard/bookings"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block"
            >
              Manage Bookings
            </Link>
          )}
          <Link
            href="/book"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden md:block"
          >
            Book a Class
          </Link>
          {user ? (
            <UserMenu user={user} />
          ) : (
            <Button asChild size="sm" className="hidden md:flex">
              <Link href="/login">Sign In</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
