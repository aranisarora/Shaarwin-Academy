"use client";

// Founder view of school access: one row per campus he has marked as a school
// in the Venues tab, each carrying the login that campus signs in with.
//
// There is no "create login" here any more, because there was never a decision
// to make: a campus marked as a school gets a login, so tapping the row hands
// one over and mints it first if this is the first time (see
// `openSchoolLoginCore`). The row's job is to share, not to provision.
//
// And the password is no longer shown once and lost. It is kept encrypted in
// the vault and read back on every open, unchanged — because several people at
// one school use it, and re-issuing it to answer "what was it again?" would
// lock out every one of them. Rotation still exists; it is a separate control
// with a confirm on it, which is the right shape for something that takes
// access away from people who are mid-term.
//
// Every action in this file runs from inside the sheet, and the sheet is a
// portal over a full-screen backdrop — so a failure written anywhere else on
// the page is a failure the founder cannot read. Errors land next to whichever
// control refused.

import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { EmptyState } from "@/components/ui/EmptyState";
import { isSyntheticEmail } from "@/lib/synthetic-email";
import { handoverText, schoolLoginUrl } from "@/lib/school-handover";
import { academyToday, formatDateFull, utcToAcademyWall } from "@/lib/academy-time";
import {
  openSchoolLogin,
  removeSchoolAccount,
  resetSchoolPassword,
} from "@/app/admin/schools/actions";

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

export function SchoolManager({ schools }: { schools: School[] }) {
  // Held by id, not by value: opening or removing a login re-renders the list,
  // and a captured row would keep showing the state it had before the action.
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = schools.find((s) => s.venueId === openId) ?? null;

  const [login, setLogin] = useState<Login | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
    at: "open" | "reset" | "remove";
    text: string;
  } | null>(null);

  const errorAt = (at: "reset" | "remove") =>
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
    setPreview(false);
    setCopied(false);
    setMessage(null);
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
      setPreview(false);
      setCopied(false);
      // Re-arm the guard by handing the confirm a new identity.
      setRotations((n) => n + 1);
    });
  }

  function remove() {
    if (!login) return;
    setSheetError(null);
    startTransition(async () => {
      const r = await removeSchoolAccount(login.userId);
      if (r.ok) {
        setMessage("Login removed.");
        setOpenId(null);
      } else {
        setSheetError({ at: "remove", text: r.error ?? "Couldn't remove it." });
      }
    });
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  return (
    <div className="space-y-4">
      {message && <p className="text-sm text-fg-2">{message}</p>}

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {schools.map((s) => (
          <li key={s.venueId}>
            <button
              onClick={() => open(s)}
              className="flex w-full flex-col items-start gap-0.5 px-4 py-4 text-left hover:bg-surface"
            >
              <p className="w-full truncate font-medium">{label(s)}</p>
              <p className="tnum w-full truncate text-xs text-fg-2">{facts(s)}</p>
              <p
                className={`w-full truncate text-xs ${
                  s.lastSignInAt ? "text-fg-2" : "text-ember"
                }`}
              >
                {signInLine(s.lastSignInAt)}
              </p>
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
            <p className="tnum text-sm text-fg-2">{facts(selected)}</p>

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
                  <div className="space-y-1">
                    <p className="label">Email</p>
                    <p className="break-all text-sm">{login.email}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="label">Password</p>
                    {login.password ? (
                      <div className="flex items-center justify-between gap-3">
                        <p className="break-all text-sm">
                          {revealed ? login.password : "••••••••••••"}
                        </p>
                        <button
                          type="button"
                          onClick={() => setRevealed((r) => !r)}
                          className="min-h-11 shrink-0 px-1 text-sm text-fg-2 underline-offset-4 hover:underline"
                        >
                          {revealed ? "Hide" : "Show"}
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-fg-2">
                        We have no password saved for this login. Whatever the
                        school is using still works — but to send it again you
                        have to reset it below.
                      </p>
                    )}
                  </div>

                  {isSyntheticEmail(login.email) && (
                    <p className="text-sm text-fg-2">
                      That address isn&apos;t a real inbox and nothing is ever
                      sent to it. The password is the whole login, which is what
                      lets several people at the school share one.
                    </p>
                  )}

                  {login.password && !login.saved && (
                    <p className="text-sm text-err">
                      We couldn&apos;t save this password, so it won&apos;t be
                      here next time. Send it now, or reset it and try again.
                    </p>
                  )}
                </div>

                {share && (
                  <div className="space-y-2">
                    <p className="label">Send to the school</p>
                    <div className="flex flex-wrap gap-2">
                      <ButtonLink
                        href={`https://wa.me/?text=${encodeURIComponent(share)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-fit flex-1 basis-40"
                      >
                        Send on WhatsApp
                      </ButtonLink>
                      <Button
                        variant="ghost"
                        className="min-w-fit flex-1 basis-32"
                        onClick={() => copy(share)}
                      >
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <p className="text-sm text-fg-2">
                      The message carries a link that opens the school&apos;s
                      sign-in page with this email already filled in. Only the
                      password has to be typed.
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <button
                        type="button"
                        onClick={() => setPreview((p) => !p)}
                        className="text-sm text-fg-2 underline-offset-4 hover:underline"
                      >
                        {preview ? "Hide the message" : "See the message"}
                      </button>
                      {/* Opening it himself is the only way to know the handover
                          works before a school finds out that it doesn't. */}
                      <a
                        href={schoolLoginUrl(login.email)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-fg-2 underline-offset-4 hover:underline"
                      >
                        Try the link
                      </a>
                    </div>
                    {preview && (
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded-[12px] border border-line bg-surface px-4 py-3 text-sm">
                        {share}
                      </pre>
                    )}
                  </div>
                )}

                <div className="space-y-3 border-t border-line pt-4">
                  {errorAt("reset")}
                  <ConfirmAction
                    key={rotations}
                    label="Reset the password"
                    confirmLabel="Reset it"
                    prompt="Everyone at the school stops being able to sign in with the old password, including anyone mid-term. You'll get a new one to send. This is also how you take access off someone who has left."
                    variant="ghost"
                    onConfirm={reset}
                    pending={pending}
                  />
                  {errorAt("remove")}
                  <ConfirmAction
                    label="Remove the login"
                    confirmLabel="Remove it"
                    prompt="The school loses access immediately. Its pupils and their history are untouched."
                    variant="subtle"
                    onConfirm={remove}
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
