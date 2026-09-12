// One row of "this needs you". Every row names the thing, says when or who,
// and opens the exact item — never a generic list the founder then has to
// search. It was written out inline five times on the old Today page, which is
// how one of the five ended up with a red badge on a neutral border.
//
// `urgent` drives BOTH the border and the badge, so that can't drift again.
// Per the colour contract in globals.css, red means "you must act now" — a
// class with nobody to teach it, a payment that has failed, a family waiting
// to be let in. Anything you merely want to look at stays neutral.

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";

export function AttentionRow({
  href,
  title,
  detail,
  action,
  urgent = false,
}: {
  href: string;
  title: React.ReactNode;
  /** When, where, who — the line that saves opening it to find out. */
  detail?: React.ReactNode;
  /** The badge: "Assign", "Review", "Open". */
  action: string;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-3 rounded-[12px] border bg-surface-2 px-4 py-3 hover:bg-surface ${
        urgent ? "border-err" : "border-line"
      }`}
    >
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        {detail && <span className="tnum block text-sm text-fg-2">{detail}</span>}
      </span>
      <Badge tone={urgent ? "err" : "neutral"}>{action}</Badge>
    </Link>
  );
}
