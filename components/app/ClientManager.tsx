"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { grantCompSubscription, adjustCredits } from "@/app/admin/actions";
import {
  addClientInvite,
  deletePendingClient,
  savePendingClient,
  updateClient,
  setClientBlocked,
  setClientArchived,
  reviewSignupRequest,
} from "@/app/admin/players/actions";

export type PendingClientRow = {
  id: string;
  phone: string;
  name: string;
  notes: string;
  planId: string;
};

type ClientRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  disputed: boolean;
  archived: boolean;
  approvalStatus: "pending" | "approved" | "denied";
  createdAt: string;
  subStatus: string | null;
  planName: string | null;
  ltvPence: number;
  noShowCount: number;
  attendedCount: number;
  students: { id: string; name: string; level: string }[];
};

/** WhatsApp-provisioned accounts carry a synthetic @sharwin.local email that
 *  should never surface in the UI — the phone number is the real identity. */
function isPhoneOnly(email: string): boolean {
  return email.endsWith("@sharwin.local") || email === "";
}

/** Auto-provisioned accounts carry placeholder names until the person fills
 *  in their profile — treat those as "no name yet". */
function isRealName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n !== "" && n !== "there" && n !== "player";
}

function displayName(c: { name: string; phone: string | null }): string {
  if (isRealName(c.name)) return c.name;
  return c.phone ?? "New client";
}

function contactLine(c: { email: string; phone: string | null }): string {
  if (!isPhoneOnly(c.email)) return c.email;
  return c.phone ? `${c.phone} · WhatsApp` : "Signed up by phone";
}

export function ClientManager({
  clients,
  plans,
  pending: pendingInvites,
}: {
  clients: ClientRow[];
  plans: { id: string; name: string }[];
  pending: PendingClientRow[];
}) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<ClientRow | null>(null);
  // Add / edit-pending invite sheets (pre-registered clients by phone).
  const [inviteMode, setInviteMode] = useState<"add" | "edit" | null>(null);
  const [inviteId, setInviteId] = useState<string | null>(null);
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteNotes, setInviteNotes] = useState("");
  const [invitePlanId, setInvitePlanId] = useState("");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteSaved, setInviteSaved] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const archivedCount = clients.filter((c) => c.archived).length;
  // Closed-membership signup requests waiting on the founder: they've submitted
  // the form (so we have a phone) but aren't approved yet. Phone-less pendings
  // (signed up, never requested) are intentionally omitted — no action to take.
  const requests = clients.filter(
    (c) => c.approvalStatus === "pending" && c.phone && !c.archived
  );

  function review(clientId: string, approve: boolean) {
    startTransition(async () => {
      const r = await reviewSignupRequest(clientId, approve);
      setMessage(r.ok ? (approve ? "Approved." : "Request denied.") : (r.error ?? "Failed."));
      if (r.ok && selected?.id === clientId) {
        setSelected({ ...selected, approvalStatus: approve ? "approved" : "denied" });
      }
    });
  }

  const filtered = clients.filter(
    (c) =>
      (showArchived || !c.archived) &&
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
        (!isPhoneOnly(c.email) &&
          c.email.toLowerCase().includes(search.toLowerCase())) ||
        (c.phone ?? "").includes(search.trim()))
  );

  function open(c: ClientRow) {
    setSelected(c);
    setName(c.name);
    setPhone(c.phone ?? "");
    setMessage(null);
    setDelta("");
    setNote("");
  }

  function openAddInvite() {
    setInviteMode("add");
    setInviteId(null);
    setInvitePhone("");
    setInviteName("");
    setInviteNotes("");
    setInvitePlanId("");
    setInviteMessage(null);
    setInviteSaved(false);
  }

  function openEditInvite(p: PendingClientRow) {
    setInviteMode("edit");
    setInviteId(p.id);
    setInvitePhone(p.phone);
    setInviteName(p.name);
    setInviteNotes(p.notes);
    setInvitePlanId(p.planId);
    setInviteMessage(null);
    setInviteSaved(false);
  }

  function submitInvite() {
    startTransition(async () => {
      const details = {
        phone: invitePhone,
        fullName: inviteName,
        notes: inviteNotes,
        planId: invitePlanId,
      };
      const r =
        inviteMode === "edit" && inviteId
          ? await savePendingClient(inviteId, details)
          : await addClientInvite(details);
      if (r.ok) {
        if (inviteMode === "edit") setInviteMode(null);
        else setInviteSaved(true);
      } else {
        setInviteMessage(r.error ?? "Failed.");
      }
    });
  }

  function removeInvite() {
    if (!inviteId) return;
    if (!window.confirm("Remove this client? Their account won't connect when they sign up."))
      return;
    startTransition(async () => {
      const r = await deletePendingClient(inviteId);
      if (r.ok) setInviteMode(null);
      else setInviteMessage(r.error ?? "Failed.");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg-2">
          Clients sign themselves up on the website — everyone appears here automatically.
        </p>
        <Button onClick={openAddInvite}>Add client</Button>
      </div>

      {/* ── Signup requests awaiting approval ── */}
      {requests.length > 0 && (
        <div className="space-y-2">
          <p className="label">Access requests</p>
          <ul className="divide-y divide-line rounded-[12px] border border-ember/40 bg-surface-2">
            {requests.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{displayName(c)}</p>
                  <p className="truncate text-sm text-fg-2">
                    {!isPhoneOnly(c.email) ? `${c.email} · ` : ""}
                    {c.phone}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button disabled={pending} onClick={() => review(c.id, true)}>
                    Approve
                  </Button>
                  <Button variant="ghost" disabled={pending} onClick={() => review(c.id, false)}>
                    Deny
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-sm text-fg-2">
            Approve to send them the onboarding link. Denied requests stay reversible below.
          </p>
        </div>
      )}
      <Input
        placeholder="Search clients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {archivedCount > 0 && (
        <label className="flex items-center gap-2 text-sm text-fg-2">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 accent-[var(--ember)]"
          />
          Show archived ({archivedCount})
        </label>
      )}

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {filtered.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => open(c)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
            >
              <div>
                <p className="font-medium">
                  {displayName(c)}
                  {c.approvalStatus === "pending" && (
                    <Badge className="ml-2" tone="ember">
                      Pending
                    </Badge>
                  )}
                  {c.approvalStatus === "denied" && (
                    <Badge className="ml-2" tone="err">
                      Denied
                    </Badge>
                  )}
                  {c.disputed && (
                    <Badge className="ml-2" tone="err">
                      Blocked
                    </Badge>
                  )}
                  {c.archived && <Badge className="ml-2">Archived</Badge>}
                </p>
                <p className="text-sm text-fg-2">{contactLine(c)}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {c.subStatus ? (
                  <Badge tone={c.subStatus === "past_due" ? "err" : "ok"}>
                    {c.planName ?? c.subStatus}
                  </Badge>
                ) : (
                  <Badge>no plan</Badge>
                )}
                <span className="tnum text-xs text-fg-2">
                  paid £{(c.ltvPence / 100).toFixed(0)}
                  {c.attendedCount > 0 && ` · ${c.attendedCount} attended`}
                  {c.noShowCount > 0 && ` · ${c.noShowCount} no-shows`}
                </span>
                {c.students.length > 1 && (
                  <span className="text-xs text-fg-2">
                    {c.students.length} students
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-fg-2">No matches.</li>
        )}
      </ul>

      {/* ── Pre-registered clients waiting to sign up ── */}
      {pendingInvites.length > 0 && (
        <div className="space-y-2">
          <p className="label">Added by you — waiting to sign up</p>
          <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
            {pendingInvites.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <button onClick={() => openEditInvite(p)} className="text-left hover:text-ember">
                    <p className="font-medium">{p.name || p.phone}</p>
                    <p className="text-sm text-fg-2">
                      {p.phone}
                      {p.planId &&
                        ` · free ${plans.find((pl) => pl.id === p.planId)?.name ?? "plan"} on signup`}
                    </p>
                  </button>
                  <Badge tone="ember">Awaiting signup</Badge>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-sm text-fg-2">
            When they sign up (or message the WhatsApp assistant) from their number, their
            account connects automatically.
          </p>
        </div>
      )}

      {/* ── Add / edit a pre-registered client ── */}
      <Sheet
        open={inviteMode !== null}
        onClose={() => setInviteMode(null)}
        title={inviteMode === "edit" ? "Edit client" : "Add a client"}
      >
        {inviteSaved ? (
          <div className="space-y-4">
            <p className="text-sm text-fg-2">
              Saved. When {inviteName.trim() || "they"} sign up on the website or message the
              WhatsApp assistant from {invitePhone || "that number"}, their account connects
              automatically and appears in your client list.
            </p>
            <Button variant="ghost" onClick={() => setInviteMode(null)} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-fg-2">
              {inviteMode === "edit"
                ? "They haven't signed up yet. These details apply automatically when they do."
                : "Enter their phone number. When they sign up or message the WhatsApp assistant from it, their account connects automatically."}
            </p>
            <Input
              label="Phone"
              value={invitePhone}
              onChange={(e) => setInvitePhone(e.target.value)}
              placeholder="+91…"
              hint="Their WhatsApp number — this is how we recognise them."
            />
            <Input
              label="Full name"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Optional"
            />
            <Input
              label="Notes"
              value={inviteNotes}
              onChange={(e) => setInviteNotes(e.target.value)}
              placeholder="Optional — e.g. trains Tuesdays, intermediate"
              hint="Saved onto their student record when they join."
            />
            <Select
              label="Free plan"
              value={invitePlanId}
              onChange={(e) => setInvitePlanId(e.target.value)}
              hint="Optional — they get this plan free (30 days, no card) the moment their account connects."
            >
              <option value="">No free plan</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button onClick={submitInvite} disabled={pending || !invitePhone.trim()} className="w-full">
              {pending ? <Spinner /> : inviteMode === "edit" ? "Save client" : "Add client"}
            </Button>
            {inviteMode === "edit" && (
              <Button variant="destructive" disabled={pending} className="w-full" onClick={removeInvite}>
                Remove client
              </Button>
            )}
            {inviteMessage && <p className="text-sm text-err">{inviteMessage}</p>}
          </div>
        )}
      </Sheet>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? displayName(selected) : undefined}
      >
        {selected && (
          <div className="space-y-6">
            <p className="tnum text-sm text-fg-2">
              Client since{" "}
              {new Date(selected.createdAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}{" "}
              · paid £{(selected.ltvPence / 100).toFixed(0)} · {selected.attendedCount}{" "}
              attended · {selected.noShowCount} no-shows
            </p>

            <div className="space-y-3 rounded-[12px] border border-line p-4">
              <p className="label">Students</p>
              {selected.students.length === 0 ? (
                <p className="text-sm text-fg-2">No students on this account yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {selected.students.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/admin/players/${s.id}`}
                        className="group flex items-center justify-between gap-3 py-2.5"
                      >
                        <div>
                          <p className="font-medium group-hover:text-ember">{s.name}</p>
                          <p className="text-xs text-fg-2">{s.level}</p>
                        </div>
                        <span className="text-fg-2" aria-hidden>
                          ›
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-fg-2">
                Tap a student for notes, attendance and stats.
              </p>
            </div>

            <div className="space-y-3 rounded-[12px] border border-line p-4">
              <p className="label">Contact details</p>
              <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input
                label="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
              />
              <p className="text-sm text-fg-2">
                {isPhoneOnly(selected.email)
                  ? "No email — they use WhatsApp."
                  : selected.email}
              </p>
              <Button
                variant="ghost"
                disabled={pending || !name.trim()}
                onClick={() =>
                  startTransition(async () => {
                    const r = await updateClient(selected.id, name, phone);
                    setMessage(r.ok ? "Details saved." : (r.error ?? "Failed."));
                  })
                }
                className="w-full"
              >
                {pending ? <Spinner /> : "Save details"}
              </Button>
            </div>

            <div className="space-y-3 rounded-[12px] border border-line p-4">
              <p className="label">Give a free plan</p>
              <Select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                hint="They get this plan free for 90 days — no card needed."
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                disabled={pending || !planId}
                onClick={() =>
                  startTransition(async () => {
                    const r = await grantCompSubscription(selected.id, planId);
                    setMessage(r.ok ? "Free plan added — lasts 90 days." : (r.error ?? "Failed."));
                  })
                }
                className="w-full"
              >
                {pending ? <Spinner /> : "Give free plan"}
              </Button>
            </div>

            <div className="space-y-3 rounded-[12px] border border-line p-4">
              <p className="label">Private-lesson minutes</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="+60 or -30"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                />
                <Input
                  placeholder="Why? e.g. goodwill"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <p className="text-sm text-fg-2">
                Add minutes with + or take them away with −. Example: +60 gives them one extra
                hour of private lessons.
              </p>
              <Button
                variant="ghost"
                disabled={pending || !delta}
                onClick={() =>
                  startTransition(async () => {
                    const r = await adjustCredits(selected.id, Number(delta), note);
                    setMessage(r.ok ? "Minutes updated." : (r.error ?? "Failed."));
                  })
                }
                className="w-full"
              >
                {pending ? <Spinner /> : "Update minutes"}
              </Button>
            </div>

            {selected.approvalStatus !== "approved" && (
              <div className="space-y-3 rounded-[12px] border border-ember/40 p-4">
                <p className="label">Membership access</p>
                <p className="text-sm text-fg-2">
                  {selected.approvalStatus === "pending"
                    ? "This person is waiting for approval to access the academy."
                    : "You denied this request. You can still approve them."}
                </p>
                <div className="flex gap-2">
                  <Button
                    disabled={pending}
                    className="flex-1"
                    onClick={() => review(selected.id, true)}
                  >
                    {pending ? <Spinner /> : selected.approvalStatus === "denied" ? "Approve anyway" : "Approve"}
                  </Button>
                  {selected.approvalStatus === "pending" && (
                    <Button
                      variant="ghost"
                      disabled={pending}
                      className="flex-1"
                      onClick={() => review(selected.id, false)}
                    >
                      Deny
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3 rounded-[12px] border border-line p-4">
              <p className="label">Account</p>
              <Button
                variant="ghost"
                disabled={pending}
                className="w-full"
                onClick={() => {
                  const msg = selected.disputed
                    ? "Let this client book sessions again?"
                    : "Block this client from booking? Use this for payment disputes. They can still sign in.";
                  if (!window.confirm(msg)) return;
                  startTransition(async () => {
                    const r = await setClientBlocked(selected.id, !selected.disputed);
                    setMessage(
                      r.ok
                        ? selected.disputed
                          ? "Client can book again."
                          : "Client blocked from booking."
                        : (r.error ?? "Failed.")
                    );
                    if (r.ok) setSelected({ ...selected, disputed: !selected.disputed });
                  });
                }}
              >
                {selected.disputed ? "Unblock bookings" : "Block bookings"}
              </Button>
              <Button
                variant={selected.archived ? "ghost" : "destructive"}
                disabled={pending}
                className="w-full"
                onClick={() => {
                  const msg = selected.archived
                    ? "Bring this client back to your list?"
                    : "Archive this client? They disappear from your list but nothing is deleted — you can bring them back anytime.";
                  if (!window.confirm(msg)) return;
                  startTransition(async () => {
                    const r = await setClientArchived(selected.id, !selected.archived);
                    setMessage(
                      r.ok
                        ? selected.archived
                          ? "Client restored."
                          : "Client archived."
                        : (r.error ?? "Failed.")
                    );
                    if (r.ok) setSelected(null);
                  });
                }}
              >
                {selected.archived ? "Restore client" : "Archive client"}
              </Button>
            </div>

            {message && <p className="text-sm text-fg-2">{message}</p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}
