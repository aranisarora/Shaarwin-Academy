import Link from "next/link";
import { StageShell } from "@/components/shells/StageShell";

/**
 * The frame every way-in shares: log in, sign up, and the school's own screen.
 *
 * It exists because those three pages had drifted into three copies of the same
 * wrapper, and because the ordering is a decision worth making once. The form is
 * the task, so it comes second — straight after a single line of context — and
 * every "actually, I'm somewhere else" link goes below it, past a hairline.
 *
 * That ordering is the fix for the thing this restructure was really about. The
 * way into a school account used to be a small underlined word at the very
 * bottom of the login form, under the Google button: the least prominent control
 * on the page, aimed at the audience least likely to go hunting for it. Now each
 * audience has a screen, and the links between them are a labelled set at the
 * foot of all three rather than one stray button in the middle of one.
 */
export function AuthLayout({
  title,
  lead,
  notice,
  children,
  alternatives,
}: {
  title: string;
  /** One line under the heading. Context, not instructions — the form says what
   *  to do, and a paragraph above it just delays reading that. */
  lead?: React.ReactNode;
  /** Something that went wrong before this render — a failed OAuth hop, a
   *  bounce. Sits above the form because it explains why the form is here. */
  notice?: React.ReactNode;
  children: React.ReactNode;
  /** The other ways in. Rendered under a hairline, so they read as "not this
   *  one" rather than as steps in the form. */
  alternatives?: React.ReactNode;
}) {
  return (
    <StageShell>
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-6 pb-20 pt-32">
        <h1 className="font-display mb-2 text-4xl">{title}</h1>
        {lead && <p className="mb-8 text-fg-2">{lead}</p>}
        {notice && (
          <p className="mb-6 rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
            {notice}
          </p>
        )}
        {children}
        {alternatives && (
          <div className="mt-8 space-y-3 border-t border-line pt-6 text-sm text-fg-2">
            {alternatives}
          </div>
        )}
      </div>
    </StageShell>
  );
}

/**
 * One row of the `alternatives` block: a plain statement of who it is for, then
 * the link. Written as two parts rather than one sentence with a link buried in
 * it, because the question ("are you a school?") is what someone scans for, and
 * the answer is what they tap.
 */
export function AuthAlternative({
  question,
  href,
  label,
}: {
  question: string;
  href: string;
  label: string;
}) {
  const className = "text-ember underline-offset-4 hover:underline";
  // One of these rows is a wa.me link, which is a real navigation off the site
  // and not a route — `next/link` would prefetch a URL it cannot render.
  const external = href.startsWith("http") || href.startsWith("mailto:");
  return (
    <p>
      {question}{" "}
      {external ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
        >
          {label}
        </a>
      ) : (
        <Link href={href} className={className}>
          {label}
        </Link>
      )}
    </p>
  );
}
