"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { InfoTip } from "@/components/ui/InfoTip";
import {
  addCoach,
  deletePendingCoach,
  saveCoach,
  savePendingCoach,
  setCoachActive,
} from "@/app/admin/coaches/actions";

export type CoachRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  bio: string;
  travelRadiusKm: number;
  maxTeachableLevel: string;
  tier: number;
  dbsChecked: boolean;
  active: boolean;
};

export type PendingCoachRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  bio: string;
  travelRadiusKm: number;
  maxTeachableLevel: string;
  tier: number;
  dbsChecked: boolean;
};

const LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const;

type Form = {
  name: string;
  email: string;
  phone: string;
  bio: string;
  tier: number;
  maxTeachableLevel: string;
  travelRadiusKm: number;
  dbsChecked: boolean;
};

const EMPTY_FORM: Form = {
  name: "",
  email: "",
  phone: "",
  bio: "",
  tier: 1,
  maxTeachableLevel: "advanced",
  travelRadiusKm: 10,
  dbsChecked: false,
};

function toForm(c: CoachRow | PendingCoachRow): Form {
  return {
    name: c.name,
    email: c.email,
    phone: c.phone,
    bio: c.bio,
    tier: c.tier,
    maxTeachableLevel: c.maxTeachableLevel,
    travelRadiusKm: c.travelRadiusKm,
    dbsChecked: c.dbsChecked,
  };
}

type Mode = "add" | "edit" | "pending" | null;

export function CoachManager({
  coaches,
  pending,
}: {
  coaches: CoachRow[];
  pending: PendingCoachRow[];
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [editActive, setEditActive] = useState(true);
  const [addResult, setAddResult] = useState<{ pending: boolean; name: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  function close() {
    setMode(null);
    setAddResult(null);
    setSheetMessage(null);
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setAddResult(null);
    setSheetMessage(null);
    setMode("add");
  }

  function openEdit(c: CoachRow) {
    setForm(toForm(c));
    setEditId(c.id);
    setEditActive(c.active);
    setSheetMessage(null);
    setMode("edit");
  }

  function openPending(p: PendingCoachRow) {
    setForm(toForm(p));
    setEditId(p.id);
    setSheetMessage(null);
    setMode("pending");
  }

  async function copyLink() {
    const url = `${window.location.origin}/signup`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Signup link copied — send it to your coach.");
    } catch {
      setMessage(url);
    }
  }

  function submitAdd() {
    startTransition(async () => {
      const r = await addCoach({
        fullName: form.name,
        email: form.email,
        phone: form.phone,
        bio: form.bio,
        tier: Number(form.tier),
        maxTeachableLevel: form.maxTeachableLevel,
        travelRadiusKm: Number(form.travelRadiusKm),
        dbsChecked: form.dbsChecked,
      });
      if (r.ok) {
        setAddResult({ pending: Boolean(r.pending), name: form.name.trim() });
      } else {
        setSheetMessage(r.error ?? "Couldn't add the coach.");
      }
    });
  }

  function submitEdit() {
    if (!editId) return;
    startTransition(async () => {
      const r = await saveCoach({
        id: editId,
        bio: form.bio,
        travelRadiusKm: Number(form.travelRadiusKm),
        maxTeachableLevel: form.maxTeachableLevel,
        tier: Number(form.tier),
        dbsChecked: form.dbsChecked,
        fullName: form.name,
        phone: form.phone,
      });
      if (r.ok) {
        setMessage("Coach saved.");
        close();
      } else {
        setSheetMessage(r.error ?? "Save failed.");
      }
    });
  }

  function submitPending() {
    if (!editId) return;
    startTransition(async () => {
      const r = await savePendingCoach(editId, {
        fullName: form.name,
        email: form.email,
        phone: form.phone,
        bio: form.bio,
        tier: Number(form.tier),
        maxTeachableLevel: form.maxTeachableLevel,
        travelRadiusKm: Number(form.travelRadiusKm),
        dbsChecked: form.dbsChecked,
      });
      if (r.ok) {
        setMessage("Invite saved.");
        close();
      } else {
        setSheetMessage(r.error ?? "Save failed.");
      }
    });
  }

  function revokePending() {
    if (!editId) return;
    if (!window.confirm("Remove this invite? They won't become a coach when they sign up.")) return;
    startTransition(async () => {
      const r = await deletePendingCoach(editId);
      if (r.ok) {
        setMessage("Invite removed.");
        close();
      } else {
        setSheetMessage(r.error ?? "Failed.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="label">Coaches</p>
        <Button onClick={openAdd}>Add a coach</Button>
      </div>
      {message && <p className="text-sm text-fg-2">{message}</p>}

      <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
        {coaches.map((c) => (
          <li key={c.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <button onClick={() => openEdit(c)} className="text-left hover:text-ember">
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-fg-2">
                  {c.email} · travels up to {c.travelRadiusKm} km
                </p>
              </button>
              <div className="flex flex-col items-end gap-1.5">
                <Badge tone={c.active ? "ok" : "err"}>{c.active ? "working" : "paused"}</Badge>
                <Badge tone={c.dbsChecked ? "ok" : "err"}>
                  {c.dbsChecked ? "Background check ✓" : "No background check"}
                </Badge>
              </div>
            </div>
          </li>
        ))}
        {coaches.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-fg-2">
            No coaches yet — tap “Add a coach” to get started.
          </li>
        )}
      </ul>

      {/* ── Pending invites ── */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="label">Invited — waiting to sign up</p>
          <ul className="divide-y divide-line rounded-[12px] border border-line bg-surface-2">
            {pending.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <button onClick={() => openPending(p)} className="text-left hover:text-ember">
                    <p className="font-medium">{p.name || p.email}</p>
                    <p className="text-sm text-fg-2">{p.email}</p>
                  </button>
                  <Badge tone="ember">Awaiting signup</Badge>
                </div>
              </li>
            ))}
          </ul>
          <button onClick={copyLink} className="text-sm text-ember hover:underline">
            Copy signup link to send
          </button>
        </div>
      )}

      {/* ── Add coach ── */}
      <Sheet open={mode === "add"} onClose={close} title="Add a coach">
        {addResult ? (
          <div className="space-y-4">
            <p className="text-sm text-fg-2">
              {addResult.pending
                ? `Saved. When ${addResult.name || "they"} sign up on the website with that email, their account becomes a coach automatically.`
                : `${addResult.name || "They"} is now a coach — tap their name to fine-tune details.`}
            </p>
            {addResult.pending && (
              <Button onClick={copyLink} className="w-full">
                Copy signup link to send
              </Button>
            )}
            <Button variant="ghost" onClick={close} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-fg-2">
              Enter their details. If they already have an account they become a coach right
              away; otherwise they become a coach the moment they sign up with this email.
            </p>
            <DetailFields form={form} onChange={patch} emailMode="edit" />
            <Button onClick={submitAdd} disabled={isPending} className="w-full">
              {isPending ? <Spinner /> : "Add coach"}
            </Button>
            {sheetMessage && <p className="text-sm text-err">{sheetMessage}</p>}
          </div>
        )}
      </Sheet>

      {/* ── Edit coach ── */}
      <Sheet open={mode === "edit"} onClose={close} title={form.name}>
        <div className="space-y-4">
          <DetailFields form={form} onChange={patch} emailMode="readonly" />
          <Button onClick={submitEdit} disabled={isPending} className="w-full">
            {isPending ? <Spinner /> : "Save coach"}
          </Button>
          <Button
            variant={editActive ? "destructive" : "ghost"}
            disabled={isPending}
            className="w-full"
            onClick={() => {
              if (!editId) return;
              const msg = editActive
                ? "Pause this coach? They stop getting new sessions. Sessions already on their calendar stay until you reassign them."
                : "Put this coach back to work?";
              if (!window.confirm(msg)) return;
              startTransition(async () => {
                const r = await setCoachActive(editId, !editActive);
                if (r.ok) {
                  setMessage(editActive ? "Coach paused." : "Coach is back.");
                  close();
                } else {
                  setSheetMessage(r.error ?? "Failed.");
                }
              });
            }}
          >
            {editActive ? "Pause coach" : "Unpause coach"}
          </Button>
          {sheetMessage && <p className="text-sm text-err">{sheetMessage}</p>}
        </div>
      </Sheet>

      {/* ── Edit pending invite ── */}
      <Sheet open={mode === "pending"} onClose={close} title="Edit invite">
        <div className="space-y-4">
          <p className="text-sm text-fg-2">
            They haven’t signed up yet. These details apply automatically when they do.
          </p>
          <DetailFields form={form} onChange={patch} emailMode="edit" />
          <Button onClick={submitPending} disabled={isPending} className="w-full">
            {isPending ? <Spinner /> : "Save invite"}
          </Button>
          <Button variant="destructive" disabled={isPending} className="w-full" onClick={revokePending}>
            Remove invite
          </Button>
          {sheetMessage && <p className="text-sm text-err">{sheetMessage}</p>}
        </div>
      </Sheet>
    </div>
  );
}

function DetailFields({
  form,
  onChange,
  emailMode,
}: {
  form: Form;
  onChange: (patch: Partial<Form>) => void;
  emailMode: "edit" | "readonly";
}) {
  return (
    <>
      <Input
        label="Full name"
        value={form.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Coach's name"
      />
      {emailMode === "edit" ? (
        <Input
          label="Email"
          type="email"
          hint="They become a coach when they sign up with this email."
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="name@example.com"
        />
      ) : (
        <div>
          <p className="label">Email</p>
          <p className="text-sm text-fg-2">{form.email}</p>
        </div>
      )}
      <Input
        label="Phone"
        hint="Lets them use the WhatsApp assistant from this number."
        value={form.phone}
        onChange={(e) => onChange({ phone: e.target.value })}
        placeholder="+91…"
      />
      <Input
        label="Short bio"
        value={form.bio}
        onChange={(e) => onChange({ bio: e.target.value })}
        placeholder="A line or two shown to clients"
      />
      <Input
        label="Travels up to (km)"
        type="number"
        min={1}
        hint="How far they'll go for home sessions."
        value={form.travelRadiusKm}
        onChange={(e) => onChange({ travelRadiusKm: Number(e.target.value) })}
      />
      <Select
        label="Can teach up to"
        hint="They won't be given classes above this level."
        value={form.maxTeachableLevel}
        onChange={(e) => onChange({ maxTeachableLevel: e.target.value })}
      >
        {LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </Select>
      <Select
        label="Seniority"
        hint="When two coaches fit equally, the more senior one is picked."
        value={form.tier}
        onChange={(e) => onChange({ tier: Number(e.target.value) })}
      >
        <option value={1}>Junior</option>
        <option value={2}>Senior</option>
        <option value={3}>Head coach</option>
      </Select>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={form.dbsChecked}
          onChange={(e) => onChange({ dbsChecked: e.target.checked })}
          className="h-5 w-5 accent-[var(--ember)]"
        />
        Background check verified
        <InfoTip text="Needed before they can coach anyone under 18. Tick this once you've seen their certificate." />
      </label>
    </>
  );
}
