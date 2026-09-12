"use client";

// Founder view of school access: one row per campus he has marked as a school
// in the Venues tab, each carrying the login that campus signs in with.
//
// There is no "create login" here, because there was never a decision to make: a
// campus marked as a school gets a login, so tapping the row hands one over and
// mints it first if this is the first time (see `openSchoolLoginCore`). The
// row's job is to share, not to provision.
//
// The sheet is three things to copy and two things to do. It used to explain
// itself at length — what the minted address was for, what the message said, why
// the link had to be opened in a private window — and none of that survived
// contact with the person using it, who already knows all of it and is looking
// for a password. So the prose is gone and the sheet is the credential.
//
// Two shapes here are load-bearing rather than cosmetic:
//
//   • Copy is per field. The founder is usually answering "what was it again?"
//     in a thread that already has the rest, so copying the whole message to get
//     one line out of it was the common case done the long way.
//   • "View as school" replaced "try the link in a private window". That hint
//     existed because he is signed in as the founder and `/login/school` sends
//     anyone with a session to their own home — so testing the handover meant
//     leaving the app. It is the same problem "view as coach" already solved, so
//     it now has the same answer, down to the banner (see lib/school-preview.ts).
//
// Every action runs from inside the sheet, and the sheet is a portal over a
// full-screen backdrop — so a failure written anywhere else on the page is a
// failure the founder cannot read. Errors land next to whichever control
// refused.

import { useRef, useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { EmptyState } from "@/components/ui/EmptyState";
import { isSyntheticEmail } from "@/lib/synthetic-email";
import { handoverText, instantLoginUrl } from "@/lib/school-handover";
import { academyToday, formatDateFull, utcToAcademyWall } from "@/lib/academy-time";
import { viewAsSchool } from "@/app/school/preview-actions";
import { openSchoolLogin, resetSchoolPassword } from "@/app/admin/schools/actions";

type School = {
  venueId: string;
  name: string;
  unit: string | null;
  classes: number;
  pupils: number;
  account: { userId: string; email: string } | null;
  lastSignInAt: string | null;
};

type Login = {
  userId: string;
  email: string;
  password: string | null;
  saved: boolean;
  lastSignInAt: string | null;
};

/** Which field the "Copied" flash is currently sitting on. */
type Field = "link" | "email" | "password";

const label = (s: School) => (s.unit ? `${s.name} · ${s.unit}` : s.name);

/** Whole days between two academy wall dates ("YYYY-MM-DD"). Pure calendar
 *  arithmetic — no timezone left in it by this point. */
function wallDaysBetween(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * "Never signed in" / "Last signed in 3 days ago".
 *
 * The never case is the one that matters and the one he will see first: no
 * school has ever signed in, so this line is how he learns that a handover
 * didn't land — which is a thing to chase, not a blank to skip over.
 *
 * Counted in academy days rather than elapsed hours, so "yesterday" means the
 * day before today in Bengaluru and not "26 hours ago". Doing the arithmetic in
 * a fixed timezone also keeps the server render and the browser render in
 * agreement, which subtracting two `Date.now()`s in different zones would not.
 */
function signInLine(iso: string | null): string {
  if (!iso) return "Never signed in";
  const days = wallDaysBetween(utcToAcademyWall(new Date(iso)).date, academyToday());
  if (days <= 0) return "Last signed in today";
  if (days === 1) return "Last signed in yesterday";
  if (days < 30) return `Last signed in ${days} days ago`;
  return `Last signed in on ${formatDateFull(iso)}`;
}

/** Line two of a row: what we actually know about the campus. A school signed
 *  but not yet timetabled reads "No classes yet", which is the truth and is
 *  something he can act on — the old screen simply hid it. */
function facts(s: School): string {
  const parts = [
    s.classes === 0 ? "No classes yet" : `${s.classes} class${s.classes === 1 ? "" : "es"}`,
    s.pupils === 0 ? "no pupils yet" : `${s.pupils} pupil${s.pupils === 1 ? "" : "s"}`,
  ];
  // A real address is worth showing on a row; the one we minted is plumbing.
  if (s.account && !isSyntheticEmail(s.account.email)) parts.push(s.account.email);
  return parts.join(" · ");
}

/** The copy affordance on a credential row. Text rather than a button so three
 *  of them stacked read as one panel and not as a keypad, but still 44px tall —
 *  this is the control he actually came for.
 *
 *  `what` names the field in the accessible name: sighted users get the pairing
 *  from the label beside it, and without this a screen reader announces three
 *  buttons all called "Copy". */
function CopyButton({
  what,
  done,
  onCopy,
}: {
  what: string;
  done: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={done ? `${what} copied` : `Copy ${what}`}
      className="min-h-11 shrink-0 px-1 text-sm text-fg-2 underline-offset-4 hover:underline"
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function SchoolManager({ schools }: { schools: School[] }) {
  // Held by id, not by value: opening a login re-renders the list, and a
  // captured row would keep showing the state it had before the action.
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = schools.find((s) => s.venueId === openId) ?? null;

  const [login, setLogin] = useState<Login | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<Field | null>(null);
  const [pending, startTransition] = useTransition();

  // How many times he has rotated this school's password without leaving the
  // sheet. Nothing displays it; it is the reset confirm's `key`. ConfirmAction
  // keeps `armed` in its own state and only ever clears it on "Keep" — which is
  // enough everywhere else, because every other confirmed action closes its
  // sheet and unmounts the thing. This one deliberately stays put to show the
  // new password, so without a remount the box sits open on "Reset it"
  // underneath the credential he is in the middle of sending, and the two-tap
  // guard on the most destructive control here has quietly become one tap.
  const [rotations, setRotations] = useState(0);

  const [sheetError, setSheetError] = useState<{
    at: "open" | "reset" | "preview";
    text: string;
  } | null>(null);

  const errorAt = (at: "reset" | "preview") =>
    sheetError?.at === at ? <p className="text-sm text-err">{sheetError.text}</p> : null;

  function load(venueId: string) {
    setSheetError(null);
    startTransition(async () => {
      const r = await openSchoolLogin(venueId);
      if (!r.ok || !r.login) {
        setSheetError({ at: "open", text: r.error ?? "Couldn't open this login." });
        return;
      }
      setLogin(r.login);
    });
  }

  function open(school: School) {
    setOpenId(school.venueId);
    setLogin(null);
    setRevealed(false);
    setCopied(null);
    setSheetError(null);
    load(school.venueId);
  }

  function reset() {
    if (!login) return;
    setSheetError(null);
    startTransition(async () => {
      const r = await resetSchoolPassword(login.userId);
      if (!r.ok || !r.login) {
        setSheetError({ at: "reset", text: r.error ?? "Couldn't set a new password." });
        return;
      }
      setLogin(r.login);
      // Straight to plaintext: the only reason to be here is to send the new
      // one, and everyone on the old one is already locked out.
      setRevealed(true);
      setCopied(null);
      // Re-arm the guard by handing the confirm a new identity.
      setRotations((n) => n + 1);
    });
  }

  function preview() {
    if (!login) return;
    setSheetError(null);
    startTransition(async () => {
      const ok = await viewAsSchool(login.userId);
      // Hard navigation: the preview cookie is set httpOnly by the server
      // action, so a soft router.push would re-render /school from the client
      // cache without it. A full load re-reads it.
      if (ok) window.location.assign("/school");
      else
        setSheetError({
          at: "preview",
          text: "Preview unavailable — only founders can view as a school.",
        });
    });
  }

  // One timer for all three fields, so copying the password while "Copied" is
  // still showing on the email moves the flash rather than racing it back off.
  const flash = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function copy(field: Field, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(field);
    if (flash.current) clearTimeout(flash.current);
    flash.current = setTimeout(() => setCopied(null), 2000);
  }

  if (schools.length === 0) {
    return (
      <EmptyState
        image="/images/empty-ivory.jpg"
        copy="No campus is marked as a school yet. Open the Venues tab, tap the campus and switch on “This venue is a school”."
        action={<ButtonLink href="/admin/venues">Go to Venues</ButtonLink>}
      />
    );
  }

  const share =
    selected && login?.password
      ? handoverText(label(selected), login.email, login.password)
      : null;

  // The link he copies is the one the message carries — built by the same
  // function, from the same two values, so the two can never drift apart.
  const instantUrl = login?.password
    ? instantLoginUrl(login.email, login.password)
    : null;

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {schools.map((s) => (
          <li key={s.venueId}>
            {/* The chevron the Coaches and Players lists already carry. Every
                row here opens a sheet, and this was the one list of the three
                that gave no sign of it — three lines of text in a box, which
                reads as a report rather than something to tap. */}
            <button
              onClick={() => open(s)}
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-surface"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="w-full truncate font-medium">{label(s)}</p>
                <p className="tnum w-full truncate text-xs text-fg-2">
                  {facts(s)}
                </p>
                <p
                  className={`w-full truncate text-xs ${
                    s.lastSignInAt ? "text-fg-2" : "text-ember"
                  }`}
                >
                  {signInLine(s.lastSignInAt)}
                </p>
              </div>
              <span aria-hidden className="shrink-0 text-fg-2">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Sheet
        open={selected !== null}
        onClose={() => setOpenId(null)}
        title={selected ? label(selected) : ""}
      >
        {selected && (
          <div className="flex flex-col gap-4">
            {!login && pending && (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            )}

            {!login && !pending && sheetError?.at === "open" && (
              <>
                <p className="text-sm text-err">{sheetError.text}</p>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => load(selected.venueId)}
                >
                  Try again
                </Button>
              </>
            )}

            {login && (
              <>
                <p
                  className={`text-sm ${
                    login.lastSignInAt ? "text-fg-2" : "text-ember"
                  }`}
                >
                  {signInLine(login.lastSignInAt)}
                </p>

                <div className="space-y-4 rounded-[12px] border border-line p-4">
                  {instantUrl && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="label">Sign-in link</p>
                        <CopyButton
                          what="sign-in link"
                          done={copied === "link"}
                          onCopy={() => copy("link", instantUrl)}
                        />
                      </div>
                      {/* Truncated on purpose: it is an opaque blob with a live
                          credential in it, there to be copied and not read. */}
                      <p className="truncate text-sm text-fg-2">{instantUrl}</p>
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="label">Email</p>
                      <CopyButton
                        what="email"
                        done={copied === "email"}
                        onCopy={() => copy("email", login.email)}
                      />
                    </div>
                    <p className="break-all text-sm">{login.email}</p>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="label">Password</p>
                      {login.password && (
                        <div className="flex shrink-0 items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setRevealed((r) => !r)}
                            className="min-h-11 px-1 text-sm text-fg-2 underline-offset-4 hover:underline"
                          >
                            {revealed ? "Hide" : "Show"}
                          </button>
                          <CopyButton
                            what="password"
                            done={copied === "password"}
                            onCopy={() => copy("password", login.password!)}
                          />
                        </div>
                      )}
                    </div>
                    {login.password ? (
                      <p className="break-all text-sm">
                        {revealed ? login.password : "••••••••••••"}
                      </p>
                    ) : (
                      <p className="text-sm text-fg-2">
                        None saved. Reset it below to get one you can send.
                      </p>
                    )}
                  </div>

                  {login.password && !login.saved && (
                    <p className="text-sm text-err">
                      We couldn&apos;t save this password — send it now, or reset
                      it and try again.
                    </p>
                  )}
                </div>

                {share && (
                  <ButtonLink
                    href={`https://wa.me/?text=${encodeURIComponent(share)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full"
                  >
                    Send on WhatsApp
                  </ButtonLink>
                )}

                {errorAt("preview")}
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={pending}
                  onClick={preview}
                >
                  View as school
                </Button>

                <div className="space-y-3 border-t border-line pt-4">
                  {errorAt("reset")}
                  {/* The only way to take access off a school, and so the only
                      destructive control here. "Remove the login" used to sit
                      under it doing a rounder version of the same job — and
                      undoing itself, since the next tap on the row mints a new
                      login anyway. */}
                  <ConfirmAction
                    key={rotations}
                    label="Reset the password"
                    confirmLabel="Reset it"
                    prompt="Everyone at the school stops being able to sign in with the old password, and every link you've sent stops working. You'll get a new password to send."
                    variant="ghost"
                    onConfirm={reset}
                    pending={pending}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
