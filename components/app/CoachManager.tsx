"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Spinner } from "@/components/ui/Spinner";
import { AddressSearch, type GeocodeHit } from "@/components/app/AddressSearch";
import { LocationPinMap } from "@/components/app/LocationPinMap";
import {
  addCoach,
  deleteCoach,
  deletePendingCoach,
  generateCoachPhoto,
  saveCoach,
  savePendingCoach,
  setCoachActive,
} from "@/app/admin/coaches/actions";
import { viewAsCoach } from "@/app/coach/preview-actions";

export type CoachRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  bio: string;
  quote: string;
  credentials: string[];
  photoUrl: string;
  baseAddress: string;
  baseLat: number;
  baseLng: number;
  active: boolean;
};

export type PendingCoachRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  bio: string;
  baseAddress: string;
  baseLat: number;
  baseLng: number;
};

type Form = {
  name: string;
  email: string;
  phone: string;
  bio: string;
  // Public-profile fields (edit mode only). credentials is edited as a
  // comma-separated string and split on save.
  quote: string;
  credentials: string;
  baseAddress: string;
  baseLat: number;
  baseLng: number;
};

const EMPTY_FORM: Form = {
  name: "",
  email: "",
  phone: "",
  bio: "",
  quote: "",
  credentials: "",
  baseAddress: "",
  baseLat: 12.9716,
  baseLng: 77.5946,
};

function toForm(c: CoachRow | PendingCoachRow): Form {
  return {
    name: c.name,
    email: c.email,
    phone: c.phone,
    bio: c.bio,
    quote: "quote" in c ? c.quote : "",
    credentials: "credentials" in c ? c.credentials.join(", ") : "",
    baseAddress: c.baseAddress,
    baseLat: c.baseLat,
    baseLng: c.baseLng,
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
  // Address typeahead state lives here so it resets correctly each time a
  // sheet opens (the sheets stay mounted between opens).
  const [addrQuery, setAddrQuery] = useState("");
  const [addrSelected, setAddrSelected] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editActive, setEditActive] = useState(true);
  const [addResult, setAddResult] = useState<{ pending: boolean; name: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  // Photo preview + generation state (edit mode).
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Reassign-on-remove state (edit mode).
  const [replacementId, setReplacementId] = useState("");
  const [isPending, startTransition] = useTransition();

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  function changeAddrQuery(q: string) {
    setAddrQuery(q);
    setAddrSelected(false);
    patch({ baseAddress: q });
  }

  function pickAddress(hit: GeocodeHit) {
    setAddrQuery(hit.place_name);
    setAddrSelected(true);
    patch({
      baseAddress: hit.place_name,
      baseLat: hit.center[1],
      baseLng: hit.center[0],
    });
  }

  function close() {
    // Don't let the panel close mid-generation — the preview would be lost and
    // a late result could land on the next coach you open.
    if (uploadingPhoto) {
      setSheetMessage("Hang on — still standardizing the photo.");
      return;
    }
    setMode(null);
    setAddResult(null);
    setSheetMessage(null);
    setReplacementId("");
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setAddrQuery("");
    setAddrSelected(false);
    setAddResult(null);
    setSheetMessage(null);
    setMode("add");
  }

  function openEdit(c: CoachRow) {
    setForm(toForm(c));
    setAddrQuery(c.baseAddress);
    setAddrSelected(c.baseAddress.length > 0);
    setEditId(c.id);
    setEditActive(c.active);
    setPhotoUrl(c.photoUrl);
    setReplacementId("");
    setSheetMessage(null);
    setMode("edit");
  }

  function openPending(p: PendingCoachRow) {
    setForm(toForm(p));
    setAddrQuery(p.baseAddress);
    setAddrSelected(p.baseAddress.length > 0);
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
        baseAddress: form.baseAddress,
        baseLat: Number(form.baseLat),
        baseLng: Number(form.baseLng),
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
        quote: form.quote,
        credentials: form.credentials.split(",").map((c) => c.trim()).filter(Boolean),
        baseAddress: form.baseAddress,
        baseLat: Number(form.baseLat),
        baseLng: Number(form.baseLng),
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
        baseAddress: form.baseAddress,
        baseLat: Number(form.baseLat),
        baseLng: Number(form.baseLng),
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

  async function uploadPhoto(file: File) {
    const id = editId;
    if (!id) return;
    setUploadingPhoto(true);
    setSheetMessage(null);
    try {
      const fd = new FormData();
      fd.set("photo", file);
      const r = await generateCoachPhoto(id, fd);
      // Ignore a late result if we've since moved to a different coach.
      if (id !== editId) return;
      if (r.ok && r.photoUrl) setPhotoUrl(r.photoUrl);
      else setSheetMessage(r.error ?? "Couldn't update the photo.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  function submitDelete() {
    if (!editId) return;
    startTransition(async () => {
      // Empty replacement = remove without handing classes over; their upcoming
      // sessions simply become unassigned.
      const r = await deleteCoach(editId, replacementId);
      if (r.ok) {
        const moved = r.changed ?? 0;
        const left = r.skipped ?? 0;
        setMessage(
          replacementId
            ? `Coach removed. ${moved} upcoming session${moved === 1 ? "" : "s"} reassigned` +
                (left ? `, ${left} couldn't be moved — check the schedule.` : ".")
            : "Coach removed. Their upcoming sessions are now unassigned — reassign them from the schedule."
        );
        close();
      } else {
        setSheetMessage(r.error ?? "Couldn't remove the coach.");
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
                <p className="text-sm text-fg-2">{c.email}</p>
              </button>
              <div className="flex flex-col items-end gap-1.5">
                <Badge tone={c.active ? "ok" : "err"}>{c.active ? "working" : "paused"}</Badge>
                <button
                  onClick={() =>
                    startTransition(async () => {
                      const ok = await viewAsCoach(c.id);
                      // Hard navigation: the preview cookie is set httpOnly by the
                      // server action, so a soft router.push would re-render /coach
                      // from the client cache without it. A full load re-reads it.
                      if (ok) window.location.assign("/coach");
                      else setMessage("Preview unavailable — only founders can view as coach.");
                    })
                  }
                  disabled={isPending}
                  className="text-sm text-ember hover:underline disabled:opacity-50"
                >
                  View as {c.name}
                </button>
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
            <DetailFields form={form} onChange={patch} emailMode="edit" addrQuery={addrQuery} addrSelected={addrSelected} onAddrQueryChange={changeAddrQuery} onAddrSelect={pickAddress} />
            <Button onClick={submitAdd} disabled={isPending} className="w-full">
              {isPending ? <Spinner /> : "Add coach"}
            </Button>
            {sheetMessage && <p className="text-sm text-err">{sheetMessage}</p>}
          </div>
        )}
      </Sheet>

      {/* ── Edit coach ── */}
      <Sheet open={mode === "edit"} onClose={close} title={form.name}>
        <div className="space-y-7">
          <div className="flex items-center gap-2">
            <Badge tone={editActive ? "ok" : "err"}>{editActive ? "working" : "paused"}</Badge>
            <span className="text-sm text-fg-2">{form.email}</span>
          </div>

          {/* ── What clients see on the website ── */}
          <section className="space-y-4">
            <div>
              <p className="label">Public profile</p>
              <p className="text-xs text-fg-2">Shown on the coaches page of the website.</p>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-[10px] border border-line bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl || "/images/empty-ink.jpg"}
                  alt="Coach portrait"
                  className="h-full w-full object-cover"
                />
                {uploadingPhoto && (
                  <div className="absolute inset-0 grid place-items-center bg-bg/60">
                    <Spinner />
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <label
                  className={`inline-block text-sm ${uploadingPhoto ? "text-fg-2" : "cursor-pointer text-ember hover:underline"}`}
                >
                  {uploadingPhoto ? "Standardizing…" : photoUrl ? "Replace photo" : "Upload photo"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingPhoto}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadPhoto(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                <p className="text-xs text-fg-2">
                  Any headshot is auto-restyled to match the other coach portraits.
                </p>
              </div>
            </div>

            <Input
              label="Bio"
              value={form.bio}
              onChange={(e) => patch({ bio: e.target.value })}
              placeholder="A line or two shown to clients"
            />
            <Input
              label="Quote"
              hint="Shown in italics under their bio."
              value={form.quote}
              onChange={(e) => patch({ quote: e.target.value })}
              placeholder="Their coaching philosophy in a line"
            />
            <Input
              label="Credentials"
              hint="Comma-separated pills, e.g. 7+ years coaching, ITTF certified."
              value={form.credentials}
              onChange={(e) => patch({ credentials: e.target.value })}
              placeholder="7+ years coaching, ITTF certified"
            />
          </section>

          {/* ── Internal: reaching them + matching them to sessions ── */}
          <section className="space-y-4">
            <div>
              <p className="label">Contact & assignment</p>
              <p className="text-xs text-fg-2">Used to reach them and match sessions. Not public.</p>
            </div>

            <Input
              label="Full name"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Coach's name"
            />
            <Input
              label="Phone"
              hint="Lets them use the WhatsApp assistant from this number."
              value={form.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              placeholder="+91…"
            />
            <AddressSearch
              label="Base location"
              placeholder="e.g. Indiranagar, Bengaluru"
              query={addrQuery}
              selected={addrSelected}
              onQueryChange={changeAddrQuery}
              onSelect={pickAddress}
            />
            {addrSelected && (
              <div>
                <p className="label mb-2">Drag the pin to fine-tune their base</p>
                <LocationPinMap
                  lat={form.baseLat}
                  lng={form.baseLng}
                  onMove={(lat, lng) => patch({ baseLat: lat, baseLng: lng })}
                />
              </div>
            )}
          </section>

          <Button onClick={submitEdit} disabled={isPending || uploadingPhoto} className="w-full">
            {isPending ? <Spinner /> : "Save changes"}
          </Button>

          {/* ── Lifecycle actions ── */}
          <section className="space-y-3 border-t border-line pt-5">
            <p className="label">Manage</p>
            <Button
              variant="ghost"
              disabled={isPending || uploadingPhoto}
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

            <div className="space-y-3 rounded-[10px] border border-err/40 bg-err/5 p-3">
              <p className="text-sm text-fg-2">
                Removing turns their login back into a normal client account. Optionally hand
                their upcoming classes to another coach — otherwise those sessions become
                unassigned.
              </p>
              <Select
                label="Give their upcoming classes to"
                value={replacementId}
                onChange={(e) => setReplacementId(e.target.value)}
              >
                <option value="">Leave unassigned</option>
                {coaches
                  .filter((c) => c.id !== editId && c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
              <Button
                variant="destructive"
                disabled={isPending || uploadingPhoto}
                className="w-full"
                onClick={() => {
                  const to = coaches.find((c) => c.id === replacementId)?.name;
                  const msg = to
                    ? `Remove this coach and move their upcoming classes to ${to}?`
                    : "Remove this coach? Their upcoming classes will be left unassigned.";
                  if (!window.confirm(msg)) return;
                  submitDelete();
                }}
              >
                {isPending ? <Spinner /> : "Remove coach"}
              </Button>
            </div>
          </section>

          {sheetMessage && <p className="text-sm text-err">{sheetMessage}</p>}
        </div>
      </Sheet>

      {/* ── Edit pending invite ── */}
      <Sheet open={mode === "pending"} onClose={close} title="Edit invite">
        <div className="space-y-4">
          <p className="text-sm text-fg-2">
            They haven’t signed up yet. These details apply automatically when they do.
          </p>
          <DetailFields form={form} onChange={patch} emailMode="edit" addrQuery={addrQuery} addrSelected={addrSelected} onAddrQueryChange={changeAddrQuery} onAddrSelect={pickAddress} />
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
  addrQuery,
  addrSelected,
  onAddrQueryChange,
  onAddrSelect,
}: {
  form: Form;
  onChange: (patch: Partial<Form>) => void;
  emailMode: "edit" | "readonly";
  addrQuery: string;
  addrSelected: boolean;
  onAddrQueryChange: (q: string) => void;
  onAddrSelect: (hit: GeocodeHit) => void;
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
      <AddressSearch
        label="Base location"
        placeholder="e.g. Indiranagar, Bengaluru"
        query={addrQuery}
        selected={addrSelected}
        onQueryChange={onAddrQueryChange}
        onSelect={onAddrSelect}
      />
      {addrSelected && (
        <div>
          <p className="label mb-2">Drag the pin to fine-tune their base</p>
          <LocationPinMap
            lat={form.baseLat}
            lng={form.baseLng}
            onMove={(lat, lng) => onChange({ baseLat: lat, baseLng: lng })}
          />
        </div>
      )}
    </>
  );
}
