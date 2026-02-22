import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/layout/user-menu";
import { BRAND_NAME } from "@/config/operating-hours";

export async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight">
            {BRAND_NAME}
          </span>
        </Link>

        <nav className="flex items-center gap-4">
          <Link
            href="/book"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Book a Class
          </Link>
          {user ? (
            <UserMenu user={user} />
          ) : (
            <Button asChild size="sm">
              <Link href="/login">Sign In</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
