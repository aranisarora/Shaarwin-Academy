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
  updateClient,
  setClientBlocked,
  setClientArchived,
} from "@/app/admin/clients/actions";

type ClientRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  disputed: boolean;
  archived: boolean;
  createdAt: string;
  subStatus: string | null;
  planName: string | null;
  ltvPence: number;
  noShowCount: number;
  attendedCount: number;
  students: { id: string; name: string; level: string }[];
};

export function ClientManager({
  clients,
  plans,
}: {
  clients: ClientRow[];
  plans: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const archivedCount = clients.filter((c) => c.archived).length;
  const filtered = clients.filter(
    (c) =>
      (showArchived || !c.archived) &&
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.email.toLowerCase().includes(search.toLowerCase()))
  );

  function open(c: ClientRow) {
    setSelected(c);
    setName(c.name);
    setPhone(c.phone ?? "");
    setMessage(null);
    setDelta("");
    setNote("");
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-2">
        Clients sign themselves up on the website — everyone appears here automatically.
      </p>
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
                  {c.name}
                  {c.disputed && (
                    <Badge className="ml-2" tone="err">
                      Blocked
                    </Badge>
                  )}
                  {c.archived && <Badge className="ml-2">Archived</Badge>}
                </p>
                <p className="text-sm text-fg-2">{c.email}</p>
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

      <Sheet open={selected !== null} onClose={() => setSelected(null)} title={selected?.name}>
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
                        href={`/admin/clients/${s.id}`}
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
              <p className="text-sm text-fg-2">{selected.email}</p>
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
