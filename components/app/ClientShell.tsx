import Link from "next/link";
import { StudioShell } from "@/components/shells/StudioShell";

const tabs = [
  { href: "/app", label: "Home", icon: "●" },
  { href: "/app/book", label: "Book", icon: "◆" },
  { href: "/app/schedule", label: "Schedule", icon: "▦" },
  { href: "/app/membership", label: "More", icon: "≡" },
];

export function ClientShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <StudioShell
      title={title}
      tabs={tabs}
      actions={
        <>
          {actions}
          <Link
            href="/app/profile"
            className="flex min-h-11 items-center rounded-[8px] border border-line px-4 text-sm font-medium text-fg-2 transition-colors hover:border-ember hover:text-ember"
          >
            Profile
          </Link>
        </>
      }
    >
      {children}
    </StudioShell>
  );
}
