"use client";

// Founder view of school access: one row per campus that runs school classes,
// each with the login it hands to that school's staff.
//
// The credential is shown ONCE, on the screen that created it. There is no way
// to read a password back afterwards — Supabase stores a hash — so the copy and
// WhatsApp affordances live here, next to the only moment the plaintext exists.
// If it's lost, the answer is "reset it", which is one button away.

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createSchoolAccount,
  removeSchoolAccount,
  resetSchoolPassword,
} from "@/app/admin/schools/actions";

type School = {
  venueId: string;
  name: string;
  unit: string | null;
  pupils: number;
  account: { userId: string; fullName: string; email: string } | null;
};

type Handover = { school: string; email: string; password: string };

const label = (s: School) => (s.unit ? `${s.name} · ${s.unit}` : s.name);

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
  const [adding, setAdding] = useState<School | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [handover, setHandover] = useState<Handover | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  function openAdd(school: School) {
    setAdding(school);
    setFullName(`${school.name} — sports office`);
    setEmail("");
    setMessage(null);
  }

  function submit() {
    if (!adding || !fullName.trim()) return;
    startTransition(async () => {
      const r = await createSchoolAccount({
        venueId: adding.venueId,
        fullName: fullName.trim(),
        email: email.trim() || undefined,
      });
      if (!r.ok || !r.credentials) {
        setMessage(r.error ?? "Couldn't create the login.");
        return;
      }
      setHandover({
        school: label(adding),
        email: r.credentials.email,
        password: r.credentials.password,
      });
      setAdding(null);
    });
  }

  function reset(school: School) {
    if (!school.account) return;
    startTransition(async () => {
      const r = await resetSchoolPassword(school.account!.userId);
      if (!r.ok || !r.credentials) {
        setMessage(r.error ?? "Couldn't reset the password.");
        return;
      }
      setHandover({
        school: label(school),
        email: r.credentials.email,
        password: r.credentials.password,
      });
    });
  }

  function remove(school: School) {
    if (!school.account) return;
    startTransition(async () => {
      const r = await removeSchoolAccount(school.account!.userId);
      setMessage(r.ok ? "Login removed." : (r.error ?? "Couldn't remove it."));
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
        copy="Schools appear here once a class is marked as a school class and given a venue."
      />
    );
  }

  return (
    <div className="space-y-4">
      {message && <p className="text-sm text-fg-2">{message}</p>}

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {schools.map((s) => (
          <li key={s.venueId} className="flex items-center justify-between gap-3 px-4 py-4">
            <div className="min-w-0">
              <p className="font-medium">{label(s)}</p>
              <p className="tnum text-xs text-fg-2">
                {s.pupils} pupil{s.pupils === 1 ? "" : "s"}
                {s.account ? ` · ${s.account.email}` : " · no login yet"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {s.account ? (
                <>
                  <Badge>Has login</Badge>
                  <Button variant="ghost" onClick={() => reset(s)} disabled={pending}>
                    Reset password
                  </Button>
                  <ConfirmAction
                    label="Remove"
                    confirmLabel="Remove the login"
                    prompt="The school loses access immediately. Its pupils and their history are untouched."
                    onConfirm={() => remove(s)}
                    pending={pending}
                    fullWidth={false}
                  />
                </>
              ) : (
                <Button onClick={() => openAdd(s)} disabled={pending}>
                  Create login
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Sheet
        open={adding !== null}
        onClose={() => setAdding(null)}
        title={adding ? `Login for ${label(adding)}` : ""}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Account name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <Input
            label="Email (optional)"
            type="email"
            placeholder="we'll make one up if you leave this blank"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="text-sm text-fg-2">
            Leave the email blank and we mint an address for the school. Nothing
            is ever sent to it — the login works on the password alone, which is
            what lets several people at the school share it. Give a real address
            only if the school asks for one.
          </p>
          <Button onClick={submit} disabled={pending || !fullName.trim()}>
            {pending ? <Spinner /> : "Create login"}
          </Button>
        </div>
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
