"use client";

// Founder view of school access: one row per campus he has marked as a school
// in the Venues tab, each with the login it hands to that school's staff.
//
// The credential is shown ONCE, on the screen that created it. There is no way
// to read a password back afterwards — Supabase stores a hash — so the copy and
// WhatsApp affordances live here, next to the only moment the plaintext exists.
// If it's lost, the answer is "reset it", which is one button away.
//
// Everything a school's row can do now happens inside its sheet. The row used
// to carry Reset password and Remove side by side, which is how an armed
// confirm — a whole sentence of prompt — ended up wider than the card holding
// it. A sheet has room for the prompt and room for the explanation, and the row
// goes back to saying what it knows.

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { EmptyState } from "@/components/ui/EmptyState";
import { isSyntheticEmail } from "@/lib/synthetic-email";
import {
  createSchoolAccount,
  removeSchoolAccount,
  resetSchoolPassword,
} from "@/app/admin/schools/actions";

type School = {
  venueId: string;
  name: string;
  unit: string | null;
  classes: number;
  pupils: number;
  account: { userId: string; fullName: string; email: string } | null;
  mintedEmail: string;
};

type Handover = { school: string; email: string; password: string };

const label = (s: School) => (s.unit ? `${s.name} · ${s.unit}` : s.name);

/** Line two of a row: what we actually know about the campus. A school signed
 *  but not yet timetabled reads "No classes yet", which is the truth and is
 *  something he can act on — the old screen simply hid it. */
function facts(s: School): string {
  const parts = [
    s.classes === 0 ? "No classes yet" : `${s.classes} class${s.classes === 1 ? "" : "es"}`,
    s.pupils === 0 ? "no pupils yet" : `${s.pupils} pupil${s.pupils === 1 ? "" : "s"}`,
  ];
  // A real address is worth showing; the one we minted is plumbing.
  if (s.account && !isSyntheticEmail(s.account.email)) parts.push(s.account.email);
  return parts.join(" · ");
}

/** The message the founder actually sends. Kept in one place so the copied text
 *  and the WhatsApp text can never drift apart. */
function handoverText(h: Handover, origin: string): string {
  return [
    `Sharwin Academy — ${h.school}`,
    "",
    "You can see your pupils' progress here:",
    `${origin}/login`,
    "",
    `Email: ${h.email}`,
    `Password: ${h.password}`,
    "",
    'Choose "Log in with a password" on that page.',
  ].join("\n");
}

export function SchoolManager({ schools }: { schools: School[] }) {
  // Held by id, not by value: creating or removing a login re-renders the list,
  // and a captured row would keep showing the state it had before the action.
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = schools.find((s) => s.venueId === openId) ?? null;

  const [useRealEmail, setUseRealEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [handover, setHandover] = useState<Handover | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  // Every one of these three actions runs from inside the open sheet, and the
  // sheet is a portal over a full-screen backdrop — so a failure written to
  // `message`, which renders in the page body underneath, is a failure the
  // founder never sees. It matters most on create: the email field is folded
  // behind a disclosure now, and "An account already uses that email." is the
  // only thing that would tell him why. `message` keeps the outcomes that close
  // the sheet first; this sits next to whichever control refused.
  const [sheetError, setSheetError] = useState<{
    at: "create" | "reset" | "remove";
    text: string;
  } | null>(null);

  const errorAt = (at: "create" | "reset" | "remove") =>
    sheetError?.at === at ? <p className="text-sm text-err">{sheetError.text}</p> : null;

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  function open(school: School) {
    setOpenId(school.venueId);
    setUseRealEmail(false);
    setEmail("");
    setMessage(null);
    setSheetError(null);
  }

  function create(school: School) {
    setSheetError(null);
    startTransition(async () => {
      const r = await createSchoolAccount({
        venueId: school.venueId,
        email: useRealEmail ? email.trim() || undefined : undefined,
      });
      if (!r.ok || !r.credentials) {
        setSheetError({ at: "create", text: r.error ?? "Couldn't create the login." });
        return;
      }
      setHandover({
        school: label(school),
        email: r.credentials.email,
        password: r.credentials.password,
      });
      setOpenId(null);
    });
  }

  function reset(school: School) {
    if (!school.account) return;
    setSheetError(null);
    startTransition(async () => {
      const r = await resetSchoolPassword(school.account!.userId);
      if (!r.ok || !r.credentials) {
        setSheetError({ at: "reset", text: r.error ?? "Couldn't reset the password." });
        return;
      }
      setHandover({
        school: label(school),
        email: r.credentials.email,
        password: r.credentials.password,
      });
      setOpenId(null);
    });
  }

  function remove(school: School) {
    if (!school.account) return;
    setSheetError(null);
    startTransition(async () => {
      const r = await removeSchoolAccount(school.account!.userId);
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

  return (
    <div className="space-y-4">
      {message && <p className="text-sm text-fg-2">{message}</p>}

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {schools.map((s) => (
          <li key={s.venueId}>
            <button
              onClick={() => open(s)}
              className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-surface"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{label(s)}</p>
                <p className="tnum truncate text-xs text-fg-2">{facts(s)}</p>
              </div>
              <Badge tone={s.account ? "ok" : "ember"} className="shrink-0">
                {s.account ? "Has login" : "No login"}
              </Badge>
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

            {selected.account ? (
              <>
                <div className="space-y-1 rounded-[12px] border border-line p-4">
                  <p className="label">Signs in with</p>
                  {isSyntheticEmail(selected.account.email) ? (
                    <p className="text-sm text-fg-2">
                      An address we made up for this campus. Nothing is ever sent
                      to it — the password is the whole login, which is what lets
                      several people at the school share it.
                    </p>
                  ) : (
                    <p className="break-all text-sm">{selected.account.email}</p>
                  )}
                </div>
                {errorAt("reset")}
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => reset(selected)}
                  disabled={pending}
                >
                  {pending ? <Spinner /> : "Reset password"}
                </Button>
                <p className="-mt-2 text-sm text-fg-2">
                  Also how you take access off someone who has left: the
                  credential is shared, so changing it changes it for everyone.
                </p>
                {errorAt("remove")}
                <ConfirmAction
                  label="Remove the login"
                  confirmLabel="Remove it"
                  prompt="The school loses access immediately. Its pupils and their history are untouched."
                  onConfirm={() => remove(selected)}
                  pending={pending}
                />
              </>
            ) : (
              <>
                <p className="text-sm text-fg-2">
                  This creates a read-only login for the school — it sees its own
                  pupils and can change nothing. You&apos;ll get the password on
                  the next screen, once.
                </p>
                {useRealEmail ? (
                  <>
                    <Input
                      label="School's email address"
                      type="email"
                      placeholder="sports@school.edu.in"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setUseRealEmail(false)}
                      className="self-start text-sm text-fg-2 underline-offset-4 hover:underline"
                    >
                      Use the address we make up instead
                    </button>
                  </>
                ) : (
                  <>
                    <div className="space-y-1 rounded-[12px] border border-line p-4">
                      <p className="label">It will sign in with something like</p>
                      <p className="break-all text-sm">{selected.mintedEmail}</p>
                      <p className="text-sm text-fg-2">
                        If another campus already holds that exact address we add
                        a few characters, and the next screen shows the one we
                        used. Nothing is ever sent there. The password is the
                        whole login, which is what lets several people at the
                        school share it.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUseRealEmail(true)}
                      className="self-start text-sm text-fg-2 underline-offset-4 hover:underline"
                    >
                      Use a real email address instead
                    </button>
                  </>
                )}
                {errorAt("create")}
                <Button
                  className="w-full"
                  onClick={() => create(selected)}
                  disabled={pending || (useRealEmail && !email.trim())}
                >
                  {pending ? <Spinner /> : "Create login"}
                </Button>
              </>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={handover !== null}
        onClose={() => setHandover(null)}
        title="Send this to the school"
      >
        {handover && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-fg-2">
              This password is shown once and can&apos;t be looked up later. Send it
              now — if it goes missing, reset it and send a new one.
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-[12px] border border-line bg-surface px-4 py-3 text-sm">
              {handoverText(handover, origin)}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => copy(handoverText(handover, origin))}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(handoverText(handover, origin))}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="ghost">Send on WhatsApp</Button>
              </a>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
