import Link from "next/link";
import { Header } from "@/components/layout/header";
import { CalendarDays, BookOpen } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="hidden w-64 border-r bg-muted/30 md:block">
          <nav className="space-y-1 p-4">
            <Link
              href="/dashboard/bookings"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <CalendarDays className="h-4 w-4" />
              My Bookings
            </Link>
            <Link
              href="/book"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <BookOpen className="h-4 w-4" />
              Book a Class
            </Link>
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
